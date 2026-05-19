import type { WorkflowGraph, AgentStep } from "@aistudio/shared";
import {
  buildExecutionGraph,
  getReadyNodes,
  resolveNodeInputs,
  type ExecutionGraph,
  type NodeExecutionStatus,
} from "./executionGraph.js";

// ── Run state ──

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "partial_failure"
  | "cancelled"
  | "budget_exceeded";

export interface NodeState {
  nodeId: string;
  status: NodeExecutionStatus;
  /** Outputs produced by this node (port id → value) */
  outputs: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Actual cost incurred */
  cost?: number;
  /** Execution duration in ms */
  durationMs?: number;
  /** Attempt number (for retries) */
  attempt: number;
  /** Timestamp when queued */
  queuedAt?: number;
  /** Timestamp when execution started */
  startedAt?: number;
  /** Timestamp when completed/failed */
  completedAt?: number;
  /** Live Thought/Action/Observation trace (ReAct Agent nodes only) */
  agentSteps?: AgentStep[];
}

export interface RunState {
  /** Unique run identifier */
  runId: string;
  /** Workflow ID this run belongs to */
  workflowId: string;
  /** Overall run status */
  status: RunStatus;
  /** Per-node execution state */
  nodeStates: Map<string, NodeState>;
  /** The execution graph (immutable snapshot) */
  graph: ExecutionGraph;
  /** Total cost accumulated so far */
  totalCost: number;
  /** Budget cap in USD (undefined = no limit) */
  budgetCap?: number;
  /** Budget mode: hard_stop or pause_and_prompt */
  budgetMode: "hard_stop" | "pause_and_prompt";
  /** Timestamp when run was created */
  createdAt: number;
  /** Timestamp when run started executing */
  startedAt?: number;
  /** Timestamp when run completed */
  completedAt?: number;
}

// ── Events emitted by the coordinator ──

export type RunEvent =
  | { type: "run:started"; runId: string }
  | { type: "node:queued"; runId: string; nodeId: string }
  | { type: "node:started"; runId: string; nodeId: string }
  | { type: "node:completed"; runId: string; nodeId: string; outputs: Record<string, unknown>; cost?: number }
  | { type: "node:failed"; runId: string; nodeId: string; error: string; attempt: number }
  | { type: "run:completed"; runId: string; totalCost: number }
  | { type: "run:failed"; runId: string; error: string }
  | { type: "run:partial_failure"; runId: string }
  | { type: "run:cancelled"; runId: string }
  | { type: "run:budget_exceeded"; runId: string; totalCost: number; budgetCap: number }
  /** Emitted each time a ReAct Agent node completes one Thought/Action/Observation step */
  | { type: "agent:step"; runId: string; nodeId: string; step: AgentStep };

export type EventListener = (event: RunEvent) => void;

// ── Job dispatch callback ──

/**
 * Function signature for dispatching a node job to the queue.
 * The coordinator calls this; the actual queue integration is injected.
 */
export type DispatchJob = (job: {
  runId: string;
  nodeId: string;
  nodeType: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  attempt: number;
}) => Promise<void>;

// ── Run Coordinator ──

/**
 * Lightweight coordinator responsible for:
 * - Creating run state from a workflow graph
 * - Tracking per-node execution state
 * - Dispatching ready nodes to the job queue
 * - Handling completion/failure events
 * - Enforcing budget caps
 *
 * The coordinator does NOT execute nodes itself. It dispatches jobs
 * and reacts to completion callbacks from the worker.
 */
export class RunCoordinator {
  private runs = new Map<string, RunState>();
  private listeners: EventListener[] = [];

  /** Subscribe to run events */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: RunEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[RunCoordinator] Event listener error:", err);
      }
    }
  }

  /**
   * Initialize a new run from a workflow graph.
   * Takes an immutable snapshot of the graph at this point.
   */
  createRun(opts: {
    runId: string;
    workflowId: string;
    workflow: WorkflowGraph;
    budgetCap?: number;
    budgetMode?: "hard_stop" | "pause_and_prompt";
  }): RunState {
    const graph = buildExecutionGraph(opts.workflow);

    const nodeStates = new Map<string, NodeState>();
    for (const [id] of graph.nodes) {
      nodeStates.set(id, {
        nodeId: id,
        status: "pending",
        outputs: {},
        attempt: 0,
      });
    }

    const run: RunState = {
      runId: opts.runId,
      workflowId: opts.workflowId,
      status: "pending",
      nodeStates,
      graph,
      totalCost: 0,
      budgetCap: opts.budgetCap,
      budgetMode: opts.budgetMode ?? "hard_stop",
      createdAt: Date.now(),
    };

    this.runs.set(opts.runId, run);
    return run;
  }

  /**
   * Start execution of a run.
   * Finds all ready nodes (no dependencies) and dispatches them.
   */
  async startRun(runId: string, dispatch: DispatchJob): Promise<void> {
    const run = this.getRun(runId);
    run.status = "running";
    run.startedAt = Date.now();
    this.emit({ type: "run:started", runId });

    await this.dispatchReadyNodes(run, dispatch);
  }

  /**
   * Handle a node completing successfully.
   * Updates state, resolves downstream inputs, and dispatches newly ready nodes.
   */
  async onNodeCompleted(
    runId: string,
    nodeId: string,
    outputs: Record<string, unknown>,
    cost: number | undefined,
    dispatch: DispatchJob,
  ): Promise<void> {
    const run = this.getRun(runId);
    const nodeState = this.getNodeState(run, nodeId);

    nodeState.status = "completed";
    nodeState.outputs = outputs;
    nodeState.cost = cost;
    nodeState.completedAt = Date.now();

    if (cost) {
      run.totalCost += cost;
    }

    this.emit({
      type: "node:completed",
      runId,
      nodeId,
      outputs,
      cost,
    });

    // Check if run is done
    if (this.isRunComplete(run)) {
      this.finalizeRun(run);
      return;
    }

    // Budget check before dispatching more nodes
    if (run.budgetCap !== undefined && run.totalCost >= run.budgetCap) {
      run.status = "budget_exceeded";
      run.completedAt = Date.now();
      this.cancelPendingNodes(run);
      this.emit({
        type: "run:budget_exceeded",
        runId,
        totalCost: run.totalCost,
        budgetCap: run.budgetCap,
      });
      return;
    }

    // Dispatch newly ready nodes
    await this.dispatchReadyNodes(run, dispatch);
  }

  /**
   * Handle a node failing.
   * Marks downstream nodes as cancelled. Checks if run is done.
   */
  async onNodeFailed(
    runId: string,
    nodeId: string,
    error: string,
    dispatch: DispatchJob,
  ): Promise<void> {
    const run = this.getRun(runId);
    const nodeState = this.getNodeState(run, nodeId);

    nodeState.status = "failed";
    nodeState.error = error;
    nodeState.completedAt = Date.now();

    this.emit({
      type: "node:failed",
      runId,
      nodeId,
      error,
      attempt: nodeState.attempt,
    });

    // Cancel all downstream nodes in this branch
    this.cancelDownstream(run, nodeId);

    // Check if run is done
    if (this.isRunComplete(run)) {
      this.finalizeRun(run);
      return;
    }

    // Other branches may still have ready nodes
    await this.dispatchReadyNodes(run, dispatch);
  }

  /**
   * Record an agent reasoning step for a running ReAct Agent node.
   *
   * Called by the capability executor on each Thought/Action/Observation cycle.
   * Appends the step to NodeState.agentSteps and emits an `agent:step` event,
   * which triggers an SSE snapshot rebuild so the Run Debugger updates in real time.
   */
  onAgentStep(runId: string, nodeId: string, step: AgentStep): void {
    const run = this.getRun(runId);
    const nodeState = this.getNodeState(run, nodeId);
    if (!nodeState.agentSteps) nodeState.agentSteps = [];
    nodeState.agentSteps.push(step);
    this.emit({ type: "agent:step", runId, nodeId, step });
  }

  /**
   * Cancel a running run.
   */
  cancelRun(runId: string): void {
    const run = this.getRun(runId);
    run.status = "cancelled";
    run.completedAt = Date.now();
    this.cancelPendingNodes(run);
    this.emit({ type: "run:cancelled", runId });
  }

  /** Get a run state by ID */
  getRun(runId: string): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  /** Check if a run exists */
  hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  // ── Private helpers ──

  private getNodeState(run: RunState, nodeId: string): NodeState {
    const state = run.nodeStates.get(nodeId);
    if (!state) throw new Error(`Node state not found: ${nodeId} in run ${run.runId}`);
    return state;
  }

  /**
   * Find all ready nodes and dispatch them to the queue.
   */
  private async dispatchReadyNodes(run: RunState, dispatch: DispatchJob): Promise<void> {
    const statusMap = new Map<string, NodeExecutionStatus>();
    for (const [id, state] of run.nodeStates) {
      statusMap.set(id, state.status);
    }

    const readyIds = getReadyNodes(run.graph, statusMap);

    // Collect outputs from completed nodes for input resolution
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    for (const [id, state] of run.nodeStates) {
      if (state.status === "completed") {
        nodeOutputs.set(id, state.outputs);
      }
    }

    for (const nodeId of readyIds) {
      const nodeState = this.getNodeState(run, nodeId);

      // Guard against reentrancy: if a prior dispatch in this loop triggered
      // a recursive dispatchReadyNodes that already moved this node past pending,
      // skip it to avoid double-dispatch.
      if (nodeState.status !== "pending") continue;

      const execNode = run.graph.nodes.get(nodeId)!;

      // Resolve inputs from upstream outputs
      const inputs = resolveNodeInputs(run.graph, nodeId, nodeOutputs);

      // Mark as queued
      nodeState.status = "queued";
      nodeState.attempt += 1;
      nodeState.queuedAt = Date.now();

      this.emit({ type: "node:queued", runId: run.runId, nodeId });

      // Dispatch to queue
      await dispatch({
        runId: run.runId,
        nodeId,
        nodeType: execNode.type,
        inputs,
        params: execNode.data.params,
        // params.providerId/modelId (set by the InspectorPanel picker) take
        // precedence over data-level values (set by the node definition default).
        providerId:
          (execNode.data.params.providerId as string | undefined) ??
          execNode.data.providerId,
        modelId:
          (execNode.data.params.modelId as string | undefined) ??
          execNode.data.modelId,
        attempt: nodeState.attempt,
      });
    }
  }

  /**
   * Check if all nodes are in a terminal state.
   */
  private isRunComplete(run: RunState): boolean {
    for (const [, state] of run.nodeStates) {
      if (
        state.status === "pending" ||
        state.status === "queued" ||
        state.status === "running"
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Determine final run status and emit completion event.
   */
  private finalizeRun(run: RunState): void {
    const statuses = [...run.nodeStates.values()].map((s) => s.status);
    const hasFailed = statuses.includes("failed");
    const hasCompleted = statuses.includes("completed");

    if (hasFailed && hasCompleted) {
      run.status = "partial_failure";
      this.emit({ type: "run:partial_failure", runId: run.runId });
    } else if (hasFailed) {
      run.status = "failed";
      const failedNodes = [...run.nodeStates.values()]
        .filter((s) => s.status === "failed")
        .map((s) => s.error ?? "Unknown error");
      this.emit({ type: "run:failed", runId: run.runId, error: failedNodes.join("; ") });
    } else {
      run.status = "completed";
      this.emit({ type: "run:completed", runId: run.runId, totalCost: run.totalCost });
    }

    run.completedAt = Date.now();
  }

  /**
   * Cancel all downstream nodes reachable from a failed node.
   */
  private cancelDownstream(run: RunState, failedNodeId: string): void {
    const visited = new Set<string>();
    const queue = [failedNodeId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const execNode = run.graph.nodes.get(id);
      if (!execNode) continue;

      for (const depId of execNode.dependents) {
        if (visited.has(depId)) continue;
        visited.add(depId);

        const state = run.nodeStates.get(depId);
        if (state && (state.status === "pending" || state.status === "queued")) {
          state.status = "cancelled";
          state.completedAt = Date.now();
        }

        queue.push(depId);
      }
    }
  }

  /**
   * Cancel all pending/queued nodes in a run.
   */
  private cancelPendingNodes(run: RunState): void {
    for (const [, state] of run.nodeStates) {
      if (state.status === "pending" || state.status === "queued") {
        state.status = "cancelled";
        state.completedAt = Date.now();
      }
    }
  }
}
