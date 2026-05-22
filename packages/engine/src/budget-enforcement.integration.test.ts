/**
 * Budget enforcement E2E orchestration test.
 *
 * Verifies that when a run has a budget cap configured:
 * - nodes dispatch and execute normally before the cap is reached
 * - once cumulative cost reaches the enforced limit, the run transitions to budget_exceeded
 * - remaining pending nodes are cancelled and never dispatched
 * - downstream nodes of uncompleted branches are cancelled
 * - work that completed before the cap was hit remains preserved
 * - final run state, node states, totalCost, and event stream match system conventions
 *
 * Graph topology:
 *
 *                         ┌── worker (cost: 0.50 → triggers cap)
 *   source (cost: 0) ─────┤
 *                         └── pricey (cost: 0.60) ── blocked
 *
 * Budget cap: $0.50 (= worker cost exactly — exercises the >= boundary).
 *
 * Execution sequence:
 *   1. source completes (totalCost: 0.00)
 *   2. worker and pricey both become ready; worker is dispatched first (loop order)
 *   3. worker completes (totalCost: 0.50 ≥ cap) → cancelPendingNodes → pricey + blocked cancelled
 *   4. outer dispatch loop skips pricey (already cancelled)
 *   5. run status → budget_exceeded; pricey and blocked never execute
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  nodeRegistry,
  NodeRuntimeKind,
  NodeCategory,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowEdge,
  type NodeExecutionContext,
} from "@iterastudio/shared";

import { RunCoordinator, type RunEvent, type DispatchJob, type RunState } from "./runCoordinator.js";
import { NodeExecutor } from "./executor.js";

// ── Constants ──

const BUDGET_CAP = 0.50;
const WORKER_COST = 0.50;  // exactly at the cap → exercises the >= boundary

// ── Node IDs (stable for assertion readability) ──

const NODE_SOURCE = crypto.randomUUID();
const NODE_WORKER = crypto.randomUUID();
const NODE_PRICEY = crypto.randomUUID();
const NODE_BLOCKED = crypto.randomUUID();

// ── Minimal node type names ──

const TYPE_SOURCE = "budget-source";
const TYPE_WORKER = "budget-worker";
const TYPE_NOOP   = "budget-noop";   // used for pricey / blocked (never actually executed)

// ── Workflow graph builder ──

function buildBudgetTestGraph(): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: NODE_SOURCE,
      type: TYPE_SOURCE,
      position: { x: 0, y: 100 },
      data: {
        label: "Source",
        params: { __nodeType: TYPE_SOURCE },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_WORKER,
      type: TYPE_WORKER,
      position: { x: 200, y: 0 },
      data: {
        label: "Worker (triggers budget cap)",
        params: { __nodeType: TYPE_WORKER },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_PRICEY,
      type: TYPE_NOOP,
      position: { x: 200, y: 200 },
      data: {
        label: "Pricey (should be cancelled — budget already exceeded)",
        params: { __nodeType: TYPE_NOOP },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_BLOCKED,
      type: TYPE_NOOP,
      position: { x: 400, y: 200 },
      data: {
        label: "Blocked (downstream of pricey — should be cancelled)",
        params: { __nodeType: TYPE_NOOP },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
  ];

  const edges: WorkflowEdge[] = [
    // Source → Worker
    { id: crypto.randomUUID(), source: NODE_SOURCE, sourceHandle: "data_out", target: NODE_WORKER, targetHandle: "data_in" },
    // Source → Pricey
    { id: crypto.randomUUID(), source: NODE_SOURCE, sourceHandle: "data_out", target: NODE_PRICEY, targetHandle: "data_in" },
    // Pricey → Blocked
    { id: crypto.randomUUID(), source: NODE_PRICEY, sourceHandle: "data_out", target: NODE_BLOCKED, targetHandle: "data_in" },
  ];

  return { version: 1, nodes, edges };
}

// ── Test suite ──

describe("Budget enforcement: cost cap → budget_exceeded → pending nodes cancelled", () => {
  let executor: NodeExecutor;
  let coordinator: RunCoordinator;
  let events: RunEvent[];
  let executionOrder: string[];
  let run: RunState;

  before(() => {
    // Register minimal node definitions for the 3 test types
    nodeRegistry.clear();

    const baseDefinition = {
      version: 1 as const,
      category: NodeCategory.Utility,
      description: "Test node",
      inputs: [],
      outputs: [],
      parameterSchema: [],
      tags: [],
      isAvailable: true,
    };

    nodeRegistry.register({
      ...baseDefinition,
      type: TYPE_SOURCE,
      label: "Budget Source",
      runtimeKind: NodeRuntimeKind.Local,
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    nodeRegistry.register({
      ...baseDefinition,
      type: TYPE_WORKER,
      label: "Budget Worker",
      runtimeKind: NodeRuntimeKind.Local,
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" as const }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    nodeRegistry.register({
      ...baseDefinition,
      type: TYPE_NOOP,
      label: "Budget Noop",
      runtimeKind: NodeRuntimeKind.Local,
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" as const }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    // Register executors
    executor = new NodeExecutor();

    executor.registerLocal(TYPE_SOURCE, async () => ({
      outputs: { data_out: { value: "source-data" } },
      cost: 0,
    }));

    executor.registerLocal(TYPE_WORKER, async (_ctx) => ({
      outputs: { data_out: { value: "worker-data" } },
      cost: WORKER_COST,
    }));

    // TYPE_NOOP handler should never be called in this test
    executor.registerLocal(TYPE_NOOP, async () => {
      throw new Error("budget-noop should never execute — it should have been cancelled");
    });

    // Set up event + execution tracking
    events = [];
    executionOrder = [];
    coordinator = new RunCoordinator();
  });

  after(() => {
    nodeRegistry.clear();
  });

  it("builds execution graph with correct topology", () => {
    const workflow = buildBudgetTestGraph();
    run = coordinator.createRun({
      runId: "budget-test-run",
      workflowId: "budget-test-workflow",
      workflow,
      budgetCap: BUDGET_CAP,
      budgetMode: "hard_stop",
    });

    const graph = run.graph;

    assert.equal(graph.nodes.size, 4, "graph should contain 4 nodes");
    assert.equal(graph.sortedIds.length, 4, "topological sort should include all 4 nodes");

    // Source has no deps and must be first
    assert.equal(graph.sortedIds[0], NODE_SOURCE, "source should be first in topological order");

    // Worker and pricey both depend on source
    const worker = graph.nodes.get(NODE_WORKER)!;
    const pricey = graph.nodes.get(NODE_PRICEY)!;
    assert.deepEqual(worker.dependencies, [NODE_SOURCE], "worker depends on source");
    assert.deepEqual(pricey.dependencies, [NODE_SOURCE], "pricey depends on source");

    // Blocked depends on pricey
    const blocked = graph.nodes.get(NODE_BLOCKED)!;
    assert.deepEqual(blocked.dependencies, [NODE_PRICEY], "blocked depends on pricey");
  });

  it("run is created with budget cap and budgetMode persisted", () => {
    assert.equal(run.budgetCap, BUDGET_CAP, "budgetCap should be stored on RunState");
    assert.equal(run.budgetMode, "hard_stop", "budgetMode should be hard_stop");
    assert.equal(run.totalCost, 0, "totalCost should start at zero");
    assert.equal(run.status, "pending", "initial run status should be pending");
  });

  it("runs pipeline and reaches budget_exceeded status", async () => {
    const unsubscribe = coordinator.on((event) => {
      events.push(event);
    });

    const dispatch: DispatchJob = async (job) => {
      executionOrder.push(job.nodeId);

      const nodeState = run.nodeStates.get(job.nodeId)!;
      nodeState.status = "running";
      nodeState.startedAt = Date.now();

      try {
        const context: NodeExecutionContext = {
          nodeId: job.nodeId,
          runId: job.runId,
          inputs: job.inputs,
          params: job.params,
          providerId: job.providerId,
          modelId: job.modelId,
          outputDir: "/tmp/aistudio-test",
        };

        const result = await executor.execute(context);

        await coordinator.onNodeCompleted(
          job.runId,
          job.nodeId,
          result.outputs,
          result.cost,
          dispatch,
        );
      } catch (err) {
        await coordinator.onNodeFailed(
          job.runId,
          job.nodeId,
          err instanceof Error ? err.message : String(err),
          dispatch,
        );
      }
    };

    await coordinator.startRun("budget-test-run", dispatch);

    assert.equal(
      run.status,
      "budget_exceeded",
      `run should be budget_exceeded (got: ${run.status})`,
    );

    unsubscribe();
  });

  it("totalCost reaches cap and budgetCap is preserved on RunState", () => {
    assert.equal(run.totalCost, BUDGET_CAP,
      `totalCost should equal the budget cap (got: ${run.totalCost})`);
    assert.equal(run.budgetCap, BUDGET_CAP,
      "budgetCap should still be stored on RunState after run ends");
    assert.ok(run.completedAt, "run should have a completedAt timestamp");
  });

  it("source and worker completed successfully before cap was hit", () => {
    const sourceState = run.nodeStates.get(NODE_SOURCE)!;
    const workerState = run.nodeStates.get(NODE_WORKER)!;

    assert.equal(sourceState.status, "completed", "source should be completed");
    assert.equal(workerState.status, "completed", "worker should be completed");

    assert.ok(sourceState.completedAt, "source should have completedAt");
    assert.ok(workerState.completedAt, "worker should have completedAt");

    assert.ok(sourceState.outputs.data_out, "source should have output");
    assert.ok(workerState.outputs.data_out, "worker should have output");

    assert.equal(workerState.cost, WORKER_COST,
      `worker cost should be ${WORKER_COST} (got: ${workerState.cost})`);
  });

  it("pricey and blocked are cancelled and never execute", () => {
    const priceyState = run.nodeStates.get(NODE_PRICEY)!;
    const blockedState = run.nodeStates.get(NODE_BLOCKED)!;

    assert.equal(priceyState.status, "cancelled",
      "pricey should be cancelled (budget already exceeded when it became ready)");
    assert.equal(blockedState.status, "cancelled",
      "blocked should be cancelled (downstream of pricey)");

    assert.ok(priceyState.completedAt, "cancelled pricey should have completedAt");
    assert.ok(blockedState.completedAt, "cancelled blocked should have completedAt");

    // Neither should appear in the execution order
    assert.ok(!executionOrder.includes(NODE_PRICEY),
      "pricey should never be dispatched");
    assert.ok(!executionOrder.includes(NODE_BLOCKED),
      "blocked should never be dispatched");
  });

  it("only source and worker are dispatched", () => {
    assert.equal(executionOrder.length, 2,
      "exactly 2 nodes should have been dispatched (source + worker)");
    assert.ok(executionOrder.includes(NODE_SOURCE), "source should be dispatched");
    assert.ok(executionOrder.includes(NODE_WORKER), "worker should be dispatched");
  });

  it("execution order respects DAG: source before worker", () => {
    const sourceIdx = executionOrder.indexOf(NODE_SOURCE);
    const workerIdx = executionOrder.indexOf(NODE_WORKER);
    assert.ok(sourceIdx < workerIdx, "source must execute before worker");
  });

  it("event stream includes run:budget_exceeded with correct payload", () => {
    // run:started must be present
    assert.ok(events.some((e) => e.type === "run:started"),
      "should emit run:started");

    // run:budget_exceeded is the terminal event (not run:completed / run:failed / run:partial_failure)
    const budgetEvent = events.find((e) => e.type === "run:budget_exceeded");
    assert.ok(budgetEvent, "should emit run:budget_exceeded");

    const be = budgetEvent as Extract<RunEvent, { type: "run:budget_exceeded" }>;
    assert.equal(be.runId, "budget-test-run", "budget event runId should match");
    assert.equal(be.totalCost, BUDGET_CAP, `budget event totalCost should be ${BUDGET_CAP}`);
    assert.equal(be.budgetCap, BUDGET_CAP, `budget event budgetCap should be ${BUDGET_CAP}`);

    // Must NOT emit any other terminal run event
    assert.ok(!events.some((e) => e.type === "run:completed"),
      "should NOT emit run:completed");
    assert.ok(!events.some((e) => e.type === "run:failed"),
      "should NOT emit run:failed");
    assert.ok(!events.some((e) => e.type === "run:partial_failure"),
      "should NOT emit run:partial_failure");
    assert.ok(!events.some((e) => e.type === "run:cancelled"),
      "should NOT emit run:cancelled");
  });

  it("node:completed events emitted for source and worker only", () => {
    const completedNodeIds = events
      .filter((e) => e.type === "node:completed")
      .map((e) => (e as Extract<RunEvent, { type: "node:completed" }>).nodeId);

    assert.ok(completedNodeIds.includes(NODE_SOURCE), "source should emit node:completed");
    assert.ok(completedNodeIds.includes(NODE_WORKER), "worker should emit node:completed");
    assert.ok(!completedNodeIds.includes(NODE_PRICEY),
      "pricey should NOT emit node:completed");
    assert.ok(!completedNodeIds.includes(NODE_BLOCKED),
      "blocked should NOT emit node:completed");
  });

  it("node state summary is consistent — no nodes left in a non-terminal state", () => {
    const statuses = [...run.nodeStates.values()].map((s) => s.status);
    const completed  = statuses.filter((s) => s === "completed");
    const cancelled  = statuses.filter((s) => s === "cancelled");
    const nonTerminal = statuses.filter(
      (s) => s === "pending" || s === "queued" || s === "running",
    );

    assert.equal(completed.length, 2, "2 nodes should be completed (source + worker)");
    assert.equal(cancelled.length, 2, "2 nodes should be cancelled (pricey + blocked)");
    assert.equal(nonTerminal.length, 0, "no nodes should remain in a non-terminal state");
  });
});
