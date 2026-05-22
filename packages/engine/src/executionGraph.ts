import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from "@iterastudio/shared";

// ── Types ──

export interface ExecutionNode {
  /** The node ID from the workflow graph */
  id: string;
  /** The node type (used to look up NodeDefinition in registry) */
  type: string;
  /** Node data including params, provider/model references */
  data: WorkflowNode["data"];
  /** IDs of nodes this node depends on (must complete first) */
  dependencies: string[];
  /** IDs of nodes that depend on this node */
  dependents: string[];
}

export interface ExecutionGraph {
  /** All nodes in execution order metadata */
  nodes: Map<string, ExecutionNode>;
  /** Original edges for data flow resolution */
  edges: WorkflowEdge[];
  /** Node IDs grouped by execution tier (tier 0 = no deps, tier 1 = depends on tier 0, etc.) */
  tiers: string[][];
  /** Topologically sorted node IDs */
  sortedIds: string[];
}

// ── Graph builder ──

/**
 * Build an ExecutionGraph from a WorkflowGraph JSON.
 *
 * Parses nodes/edges into a dependency map, validates the DAG (no cycles),
 * and computes execution tiers for parallel scheduling.
 *
 * Throws if the graph contains cycles.
 */
export function buildExecutionGraph(workflow: WorkflowGraph): ExecutionGraph {
  const nodes = new Map<string, ExecutionNode>();

  // Initialize nodes
  for (const wfNode of workflow.nodes) {
    nodes.set(wfNode.id, {
      id: wfNode.id,
      type: wfNode.type,
      data: wfNode.data,
      dependencies: [],
      dependents: [],
    });
  }

  // Build dependency edges (edge.source → edge.target means target depends on source)
  for (const edge of workflow.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;

    if (!target.dependencies.includes(source.id)) {
      target.dependencies.push(source.id);
    }
    if (!source.dependents.includes(target.id)) {
      source.dependents.push(target.id);
    }
  }

  // Topological sort with cycle detection
  const sortedIds = topologicalSort(nodes);

  // Compute execution tiers
  const tiers = computeTiers(nodes, sortedIds);

  return {
    nodes,
    edges: workflow.edges,
    tiers,
    sortedIds,
  };
}

// ── Topological sort (Kahn's algorithm) ──

/**
 * Topological sort using Kahn's algorithm.
 * Returns node IDs in valid execution order.
 * Throws if a cycle is detected.
 */
export function topologicalSort(nodes: Map<string, ExecutionNode>): string[] {
  // Compute in-degree for each node
  const inDegree = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegree.set(id, node.dependencies.length);
  }

  // Start with nodes that have no dependencies
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);

    const node = nodes.get(id)!;
    for (const depId of node.dependents) {
      const newDeg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) {
        queue.push(depId);
      }
    }
  }

  if (sorted.length !== nodes.size) {
    const remaining = [...nodes.keys()].filter((id) => !sorted.includes(id));
    throw new Error(
      `Cycle detected in workflow graph. Nodes involved: ${remaining.join(", ")}`,
    );
  }

  return sorted;
}

// ── Tier computation ──

/**
 * Group nodes into execution tiers based on dependency depth.
 * Nodes in the same tier can execute in parallel.
 *
 * Tier 0: nodes with no dependencies
 * Tier N: nodes whose deepest dependency is in tier N-1
 */
function computeTiers(
  nodes: Map<string, ExecutionNode>,
  sortedIds: string[],
): string[][] {
  const tierMap = new Map<string, number>();

  for (const id of sortedIds) {
    const node = nodes.get(id)!;
    if (node.dependencies.length === 0) {
      tierMap.set(id, 0);
    } else {
      let maxDepTier = 0;
      for (const depId of node.dependencies) {
        const depTier = tierMap.get(depId) ?? 0;
        if (depTier >= maxDepTier) maxDepTier = depTier + 1;
      }
      tierMap.set(id, maxDepTier);
    }
  }

  // Group by tier
  const maxTier = Math.max(...tierMap.values(), 0);
  const tiers: string[][] = [];
  for (let t = 0; t <= maxTier; t++) {
    tiers.push([]);
  }
  for (const [id, tier] of tierMap) {
    tiers[tier].push(id);
  }

  return tiers;
}

// ── Ready node detection ──

/**
 * Given the current execution state, return node IDs that are ready to run.
 * A node is ready if:
 * 1. Its status is "pending"
 * 2. All its dependencies have status "completed"
 */
export function getReadyNodes(
  graph: ExecutionGraph,
  nodeStates: Map<string, NodeExecutionStatus>,
): string[] {
  const ready: string[] = [];

  for (const [id, node] of graph.nodes) {
    const status = nodeStates.get(id);
    if (status !== "pending") continue;

    const allDepsCompleted = node.dependencies.every(
      (depId) => nodeStates.get(depId) === "completed",
    );

    if (allDepsCompleted) {
      ready.push(id);
    }
  }

  return ready;
}

/**
 * Resolve the input values for a node based on completed upstream outputs.
 * Maps edge connections to find which output port feeds each input port.
 */
export function resolveNodeInputs(
  graph: ExecutionGraph,
  nodeId: string,
  nodeOutputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue;

    const sourceOutputs = nodeOutputs.get(edge.source);
    if (sourceOutputs && edge.sourceHandle in sourceOutputs) {
      inputs[edge.targetHandle] = sourceOutputs[edge.sourceHandle];
    }
  }

  return inputs;
}

// Re-export the status type used by getReadyNodes
export type NodeExecutionStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
