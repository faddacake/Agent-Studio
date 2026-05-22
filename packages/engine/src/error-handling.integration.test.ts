/**
 * Error-handling E2E orchestration test.
 *
 * Verifies that when one node fails during graph-driven execution:
 * - downstream dependent nodes are cancelled and never execute
 * - independent branch nodes still complete successfully
 * - run status becomes partial_failure
 * - event stream includes expected failure/cancellation events
 * - execution order still respects DAG dependencies
 *
 * Graph topology:
 *
 *                ┌── ok-branch ── ok-leaf
 *   root ────────┤
 *                └── fail-node ── downstream (cancelled)
 *
 * 5 nodes, 4 edges. Two independent branches from a shared root.
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

const SIMULATED_ERROR = "Simulated provider failure: rate limit exceeded";

// ── Node IDs (stable for assertion readability) ──

const NODE_ROOT = crypto.randomUUID();
const NODE_OK_BRANCH = crypto.randomUUID();
const NODE_OK_LEAF = crypto.randomUUID();
const NODE_FAIL = crypto.randomUUID();
const NODE_DOWNSTREAM = crypto.randomUUID();

// ── Minimal node type names ──

const TYPE_SOURCE = "test-source";
const TYPE_PASSTHROUGH = "test-passthrough";
const TYPE_FAILING = "test-failing";

// ── Workflow graph builder ──

function buildErrorTestGraph(): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: NODE_ROOT,
      type: TYPE_SOURCE,
      position: { x: 0, y: 100 },
      data: {
        label: "Root",
        params: { __nodeType: TYPE_SOURCE },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_OK_BRANCH,
      type: TYPE_PASSTHROUGH,
      position: { x: 200, y: 0 },
      data: {
        label: "OK Branch",
        params: { __nodeType: TYPE_PASSTHROUGH },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_OK_LEAF,
      type: TYPE_PASSTHROUGH,
      position: { x: 400, y: 0 },
      data: {
        label: "OK Leaf",
        params: { __nodeType: TYPE_PASSTHROUGH },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_FAIL,
      type: TYPE_FAILING,
      position: { x: 200, y: 200 },
      data: {
        label: "Fail Node",
        params: { __nodeType: TYPE_FAILING },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
    {
      id: NODE_DOWNSTREAM,
      type: TYPE_PASSTHROUGH,
      position: { x: 400, y: 200 },
      data: {
        label: "Downstream (should be cancelled)",
        params: { __nodeType: TYPE_PASSTHROUGH },
        retryCount: 0,
        timeoutMs: 10000,
      },
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" }],
    },
  ];

  const edges: WorkflowEdge[] = [
    // Root → OK Branch
    { id: crypto.randomUUID(), source: NODE_ROOT, sourceHandle: "data_out", target: NODE_OK_BRANCH, targetHandle: "data_in" },
    // OK Branch → OK Leaf
    { id: crypto.randomUUID(), source: NODE_OK_BRANCH, sourceHandle: "data_out", target: NODE_OK_LEAF, targetHandle: "data_in" },
    // Root → Fail Node
    { id: crypto.randomUUID(), source: NODE_ROOT, sourceHandle: "data_out", target: NODE_FAIL, targetHandle: "data_in" },
    // Fail Node → Downstream
    { id: crypto.randomUUID(), source: NODE_FAIL, sourceHandle: "data_out", target: NODE_DOWNSTREAM, targetHandle: "data_in" },
  ];

  return { version: 1, nodes, edges };
}

// ── Test suite ──

describe("Error handling: node failure → downstream cancellation → partial_failure", () => {
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
      label: "Test Source",
      runtimeKind: NodeRuntimeKind.Local,
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    nodeRegistry.register({
      ...baseDefinition,
      type: TYPE_PASSTHROUGH,
      label: "Test Passthrough",
      runtimeKind: NodeRuntimeKind.Local,
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" as const }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    nodeRegistry.register({
      ...baseDefinition,
      type: TYPE_FAILING,
      label: "Test Failing",
      runtimeKind: NodeRuntimeKind.Local,
      inputs: [{ id: "data_in", name: "Data", type: "json", direction: "input" as const }],
      outputs: [{ id: "data_out", name: "Data", type: "json", direction: "output" as const }],
    });

    // Create executor with handlers
    executor = new NodeExecutor();

    executor.registerLocal(TYPE_SOURCE, async () => ({
      outputs: { data_out: { value: "root-data" } },
      cost: 0,
    }));

    executor.registerLocal(TYPE_PASSTHROUGH, async (_ctx) => ({
      outputs: { data_out: _ctx.inputs.data_in ?? { value: "passthrough" } },
      cost: 0,
    }));

    executor.registerLocal(TYPE_FAILING, async () => {
      throw new Error(SIMULATED_ERROR);
    });

    // Set up event tracking
    events = [];
    executionOrder = [];
    coordinator = new RunCoordinator();
  });

  after(() => {
    nodeRegistry.clear();
  });

  it("builds execution graph with correct topology", () => {
    const workflow = buildErrorTestGraph();
    run = coordinator.createRun({
      runId: "error-test-run",
      workflowId: "error-test-workflow",
      workflow,
    });

    const graph = run.graph;

    assert.equal(graph.nodes.size, 5, "graph should contain 5 nodes");
    assert.equal(graph.sortedIds.length, 5, "topological sort should include all 5 nodes");

    // Root is first (no deps)
    assert.equal(graph.sortedIds[0], NODE_ROOT, "root should be first in topological order");

    // Verify branching: ok-branch and fail-node both depend on root
    const okBranch = graph.nodes.get(NODE_OK_BRANCH)!;
    const failNode = graph.nodes.get(NODE_FAIL)!;
    assert.deepEqual(okBranch.dependencies, [NODE_ROOT], "ok-branch depends on root");
    assert.deepEqual(failNode.dependencies, [NODE_ROOT], "fail-node depends on root");

    // Verify downstream depends on fail-node
    const downstream = graph.nodes.get(NODE_DOWNSTREAM)!;
    assert.deepEqual(downstream.dependencies, [NODE_FAIL], "downstream depends on fail-node");

    // Verify ok-leaf depends on ok-branch
    const okLeaf = graph.nodes.get(NODE_OK_LEAF)!;
    assert.deepEqual(okLeaf.dependencies, [NODE_OK_BRANCH], "ok-leaf depends on ok-branch");
  });

  it("runs pipeline and reaches partial_failure status", async () => {
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

    await coordinator.startRun("error-test-run", dispatch);

    assert.equal(run.status, "partial_failure",
      `run should be partial_failure (got: ${run.status})`);

    unsubscribe();
  });

  it("failing node reaches failed status with error message", () => {
    const failState = run.nodeStates.get(NODE_FAIL)!;
    assert.equal(failState.status, "failed", "fail-node should be failed");
    assert.ok(failState.error, "fail-node should have error message");
    assert.ok(failState.error!.includes(SIMULATED_ERROR),
      `error should contain simulated message (got: ${failState.error})`);
    assert.ok(failState.completedAt, "fail-node should have completedAt timestamp");
  });

  it("downstream dependent node is cancelled and never executes", () => {
    const downstreamState = run.nodeStates.get(NODE_DOWNSTREAM)!;
    assert.equal(downstreamState.status, "cancelled",
      "downstream node should be cancelled");
    assert.ok(downstreamState.completedAt,
      "cancelled node should have completedAt timestamp");

    // Verify it never actually executed
    const executed = executionOrder.includes(NODE_DOWNSTREAM);
    assert.equal(executed, false,
      "downstream node should NOT appear in execution order");
  });

  it("independent branch nodes still complete successfully", () => {
    const rootState = run.nodeStates.get(NODE_ROOT)!;
    const okBranchState = run.nodeStates.get(NODE_OK_BRANCH)!;
    const okLeafState = run.nodeStates.get(NODE_OK_LEAF)!;

    assert.equal(rootState.status, "completed", "root should be completed");
    assert.equal(okBranchState.status, "completed", "ok-branch should be completed");
    assert.equal(okLeafState.status, "completed", "ok-leaf should be completed");

    // All should have completedAt timestamps
    assert.ok(rootState.completedAt, "root should have completedAt");
    assert.ok(okBranchState.completedAt, "ok-branch should have completedAt");
    assert.ok(okLeafState.completedAt, "ok-leaf should have completedAt");

    // All should have outputs
    assert.ok(rootState.outputs.data_out, "root should have output");
    assert.ok(okBranchState.outputs.data_out, "ok-branch should have output");
    assert.ok(okLeafState.outputs.data_out, "ok-leaf should have output");
  });

  it("execution order respects DAG dependencies", () => {
    const orderIndex = (nodeId: string) => executionOrder.indexOf(nodeId);

    // Root must execute before both branches
    assert.ok(orderIndex(NODE_ROOT) < orderIndex(NODE_OK_BRANCH),
      "root should execute before ok-branch");
    assert.ok(orderIndex(NODE_ROOT) < orderIndex(NODE_FAIL),
      "root should execute before fail-node");

    // OK branch must execute before OK leaf
    assert.ok(orderIndex(NODE_OK_BRANCH) < orderIndex(NODE_OK_LEAF),
      "ok-branch should execute before ok-leaf");
  });

  it("event stream includes expected failure and completion events", () => {
    // run:started
    assert.ok(events.some((e) => e.type === "run:started"),
      "should emit run:started");

    // run:partial_failure (not run:completed or run:failed)
    assert.ok(events.some((e) => e.type === "run:partial_failure"),
      "should emit run:partial_failure");
    assert.ok(!events.some((e) => e.type === "run:completed"),
      "should NOT emit run:completed");
    assert.ok(!events.some((e) => e.type === "run:failed"),
      "should NOT emit run:failed");

    // node:failed for the failing node
    const failEvent = events.find(
      (e) => e.type === "node:failed" && e.nodeId === NODE_FAIL,
    );
    assert.ok(failEvent, "should emit node:failed for fail-node");
    assert.equal(
      (failEvent as Extract<RunEvent, { type: "node:failed" }>).error,
      SIMULATED_ERROR,
      "node:failed event should contain the error message",
    );

    // node:completed for successful nodes
    const completedNodeIds = events
      .filter((e) => e.type === "node:completed")
      .map((e) => (e as Extract<RunEvent, { type: "node:completed" }>).nodeId);
    assert.ok(completedNodeIds.includes(NODE_ROOT), "root should emit node:completed");
    assert.ok(completedNodeIds.includes(NODE_OK_BRANCH), "ok-branch should emit node:completed");
    assert.ok(completedNodeIds.includes(NODE_OK_LEAF), "ok-leaf should emit node:completed");

    // No node:completed for the failing or cancelled nodes
    assert.ok(!completedNodeIds.includes(NODE_FAIL),
      "fail-node should NOT emit node:completed");
    assert.ok(!completedNodeIds.includes(NODE_DOWNSTREAM),
      "downstream should NOT emit node:completed");
  });

  it("no cancelled node executes", () => {
    // Only 4 nodes should have been dispatched (root, ok-branch, ok-leaf, fail-node)
    // The downstream node should never appear
    assert.equal(executionOrder.length, 4,
      "exactly 4 nodes should have been dispatched");
    assert.ok(!executionOrder.includes(NODE_DOWNSTREAM),
      "cancelled downstream node should never be dispatched");
  });

  it("node state summary is consistent", () => {
    const statuses = [...run.nodeStates.values()].map((s) => s.status);
    const completed = statuses.filter((s) => s === "completed");
    const failed = statuses.filter((s) => s === "failed");
    const cancelled = statuses.filter((s) => s === "cancelled");
    const pending = statuses.filter((s) => s === "pending" || s === "queued" || s === "running");

    assert.equal(completed.length, 3, "3 nodes should be completed");
    assert.equal(failed.length, 1, "1 node should be failed");
    assert.equal(cancelled.length, 1, "1 node should be cancelled");
    assert.equal(pending.length, 0, "no nodes should be in a non-terminal state");
  });
});
