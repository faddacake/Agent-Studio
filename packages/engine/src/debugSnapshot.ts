import { nodeRegistry } from "@aistudio/shared";
import type { AgentStep } from "@aistudio/shared";
import type { RunState, NodeState } from "./runCoordinator.js";
import type { ExecutionGraph, ExecutionNode, NodeExecutionStatus } from "./executionGraph.js";

// ── Blocked reason types ──

export type BlockedReason =
  | { kind: "waiting_on_dependency"; pendingDeps: string[] }
  | { kind: "failed_upstream"; failedDeps: string[] }
  | { kind: "cancelled_upstream" }
  | { kind: "budget_exceeded" }
  | { kind: "validation_error"; message: string }
  | { kind: "run_cancelled" };

// ── Per-node debug info ──

export interface NodeDebugInfo {
  /** Node ID */
  nodeId: string;
  /** Human-readable label from workflow data */
  label: string;
  /** Node type (registry key) */
  type: string;
  /** Runtime kind from registry (provider / local / virtual / capability), or "unknown" */
  runtimeKind: string;
  /** Current execution status */
  status: NodeExecutionStatus;
  /** Execution tier (parallel scheduling level) */
  tier: number;
  /** Topological order index */
  topoIndex: number;
  /** IDs of nodes this node depends on */
  dependencies: string[];
  /** IDs of nodes that depend on this node */
  dependents: string[];
  /** Attempt counter */
  attempt: number;
  /** Duration in ms if completed */
  durationMs?: number;
  /** Cost if available */
  cost?: number;
  /** Error message if failed */
  error?: string;
  /** Timestamps */
  queuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  /** Why this node is blocked (computed from state + graph) */
  blockedReason?: BlockedReason;
  /** Output keys (not full values — just the port names that have data) */
  outputKeys: string[];
  /** Input port names from the execution graph edges */
  inputKeys: string[];
  /** Provider ID if this is a provider node */
  providerId?: string;
  /** Model ID if this is a provider node */
  modelId?: string;
  /** Live Thought/Action/Observation steps (ReAct Agent nodes only) */
  agentSteps?: AgentStep[];
}

// ── Run-level debug snapshot ──

export interface RunDebugSnapshot {
  /** Run ID */
  runId: string;
  /** Workflow ID */
  workflowId: string;
  /** Overall run status */
  status: string;
  /** Total cost so far */
  totalCost: number;
  /** Budget cap if set */
  budgetCap?: number;
  /** Budget mode */
  budgetMode: string;
  /** Timestamps */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Execution tiers — arrays of node IDs per tier */
  tiers: string[][];
  /** Topologically sorted node IDs */
  executionOrder: string[];
  /** Per-node debug info, ordered by topological sort */
  nodes: NodeDebugInfo[];
  /** Summary counts */
  summary: {
    total: number;
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
}

// ── Snapshot builder ──

/**
 * Build a serializable debug snapshot from a RunState.
 *
 * This is the single shaping function that the debugger UI consumes.
 * It projects the RunState + ExecutionGraph into a flat structure
 * with computed fields like blockedReason and tier assignments.
 */
export function buildDebugSnapshot(run: RunState): RunDebugSnapshot {
  const graph = run.graph;

  // Pre-compute tier map for O(1) lookup
  const tierMap = new Map<string, number>();
  for (let t = 0; t < graph.tiers.length; t++) {
    for (const id of graph.tiers[t]) {
      tierMap.set(id, t);
    }
  }

  // Pre-compute topo-index map
  const topoMap = new Map<string, number>();
  for (let i = 0; i < graph.sortedIds.length; i++) {
    topoMap.set(graph.sortedIds[i], i);
  }

  // Build per-node debug info in topological order
  const nodes: NodeDebugInfo[] = graph.sortedIds.map((nodeId) => {
    const execNode = graph.nodes.get(nodeId)!;
    const state = run.nodeStates.get(nodeId);
    const definition = nodeRegistry.get(execNode.type);

    // Compute input keys from edges targeting this node
    const inputKeys = graph.edges
      .filter((e) => e.target === nodeId)
      .map((e) => e.targetHandle);

    return {
      nodeId,
      label: execNode.data.label,
      type: execNode.type,
      runtimeKind: definition?.runtimeKind ?? "unknown",
      status: state?.status ?? "pending",
      tier: tierMap.get(nodeId) ?? 0,
      topoIndex: topoMap.get(nodeId) ?? 0,
      dependencies: execNode.dependencies,
      dependents: execNode.dependents,
      attempt: state?.attempt ?? 0,
      durationMs: state?.durationMs,
      cost: state?.cost,
      error: state?.error,
      queuedAt: state?.queuedAt,
      startedAt: state?.startedAt,
      completedAt: state?.completedAt,
      blockedReason: computeBlockedReason(nodeId, execNode, state, run),
      outputKeys: state ? Object.keys(state.outputs) : [],
      inputKeys,
      providerId: execNode.data.providerId,
      modelId: execNode.data.modelId,
      agentSteps: state?.agentSteps,
    };
  });

  // Summary counts
  const summary = {
    total: nodes.length,
    pending: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const n of nodes) {
    const key = n.status as keyof typeof summary;
    if (key in summary && key !== "total") {
      summary[key]++;
    }
  }

  return {
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    totalCost: run.totalCost,
    budgetCap: run.budgetCap,
    budgetMode: run.budgetMode,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    tiers: graph.tiers,
    executionOrder: graph.sortedIds,
    nodes,
    summary,
  };
}

// ── Blocked reason computation ──

function computeBlockedReason(
  nodeId: string,
  execNode: ExecutionNode,
  state: NodeState | undefined,
  run: RunState,
): BlockedReason | undefined {
  const status = state?.status ?? "pending";

  // Only compute blocked reasons for non-terminal, non-active states
  if (status === "completed" || status === "running" || status === "queued") {
    return undefined;
  }

  // Cancelled nodes
  if (status === "cancelled") {
    // Check if run was cancelled
    if (run.status === "cancelled") {
      return { kind: "run_cancelled" };
    }
    if (run.status === "budget_exceeded") {
      return { kind: "budget_exceeded" };
    }
    // Check if any upstream failed
    const failedDeps = execNode.dependencies.filter((depId) => {
      const depState = run.nodeStates.get(depId);
      return depState?.status === "failed";
    });
    if (failedDeps.length > 0) {
      return { kind: "failed_upstream", failedDeps };
    }
    return { kind: "cancelled_upstream" };
  }

  // Pending nodes
  if (status === "pending") {
    // Check for failed upstream dependencies (transitive)
    const failedDeps: string[] = [];
    const pendingDeps: string[] = [];

    for (const depId of execNode.dependencies) {
      const depState = run.nodeStates.get(depId);
      if (!depState) continue;
      if (depState.status === "failed") failedDeps.push(depId);
      if (depState.status !== "completed") pendingDeps.push(depId);
    }

    if (failedDeps.length > 0) {
      return { kind: "failed_upstream", failedDeps };
    }

    if (pendingDeps.length > 0) {
      return { kind: "waiting_on_dependency", pendingDeps };
    }
  }

  // Failed nodes — check for validation errors
  if (status === "failed" && state?.error) {
    if (state.error.includes("Validation failed")) {
      return { kind: "validation_error", message: state.error };
    }
  }

  return undefined;
}

/**
 * Build a debug snapshot from just a workflow graph (no run state).
 * Useful for previewing execution order / tiers before a run starts.
 */
export function buildGraphPreview(graph: ExecutionGraph): Pick<
  RunDebugSnapshot,
  "tiers" | "executionOrder" | "nodes"
> {
  const tierMap = new Map<string, number>();
  for (let t = 0; t < graph.tiers.length; t++) {
    for (const id of graph.tiers[t]) {
      tierMap.set(id, t);
    }
  }

  const topoMap = new Map<string, number>();
  for (let i = 0; i < graph.sortedIds.length; i++) {
    topoMap.set(graph.sortedIds[i], i);
  }

  const nodes: NodeDebugInfo[] = graph.sortedIds.map((nodeId) => {
    const execNode = graph.nodes.get(nodeId)!;
    const definition = nodeRegistry.get(execNode.type);
    const inputKeys = graph.edges
      .filter((e) => e.target === nodeId)
      .map((e) => e.targetHandle);

    return {
      nodeId,
      label: execNode.data.label,
      type: execNode.type,
      runtimeKind: definition?.runtimeKind ?? "unknown",
      status: "pending" as const,
      tier: tierMap.get(nodeId) ?? 0,
      topoIndex: topoMap.get(nodeId) ?? 0,
      dependencies: execNode.dependencies,
      dependents: execNode.dependents,
      attempt: 0,
      outputKeys: [],
      inputKeys,
      providerId: execNode.data.providerId,
      modelId: execNode.data.modelId,
    };
  });

  return {
    tiers: graph.tiers,
    executionOrder: graph.sortedIds,
    nodes,
  };
}
