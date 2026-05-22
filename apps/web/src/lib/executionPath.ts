/**
 * executionPath — derives which nodes and edges are part of the live execution
 * path so WorkflowCanvas can apply real-time visual emphasis.
 *
 * Inputs: the `nodes` array from a live RunDebugSnapshot + the React Flow
 * edge list already held in the store. No new data sources required.
 *
 * Edge classification (mutually exclusive, priority order):
 *   activeFeedEdgeIds    — source is completed, target is running
 *                         (data actively flowing into the current node)
 *   completedPathEdgeIds — source is completed, target is completed
 *                         (path already traversed this run)
 *   All other edges are treated as unreached/pending.
 */

import type { NodeDebugInfo } from "@iterastudio/engine";
import type { Edge } from "@xyflow/react";

export interface ExecutionPathSummary {
  /** Node IDs currently executing. */
  runningNodeIds: Set<string>;
  /** Node IDs that completed successfully this run. */
  completedNodeIds: Set<string>;
  /** Node IDs that failed this run. */
  failedNodeIds: Set<string>;
  /** Edge IDs feeding into a currently-running node from a completed source. */
  activeFeedEdgeIds: Set<string>;
  /** Edge IDs where both source and target have completed. */
  completedPathEdgeIds: Set<string>;
}

export function deriveExecutionPath(
  snapshotNodes: NodeDebugInfo[],
  edges: Edge[],
): ExecutionPathSummary {
  const runningNodeIds = new Set<string>();
  const completedNodeIds = new Set<string>();
  const failedNodeIds = new Set<string>();

  for (const n of snapshotNodes) {
    if (n.status === "running")   runningNodeIds.add(n.nodeId);
    else if (n.status === "completed") completedNodeIds.add(n.nodeId);
    else if (n.status === "failed" || n.status === "cancelled") failedNodeIds.add(n.nodeId);
  }

  const activeFeedEdgeIds = new Set<string>();
  const completedPathEdgeIds = new Set<string>();

  for (const edge of edges) {
    if (completedNodeIds.has(edge.source) && runningNodeIds.has(edge.target)) {
      activeFeedEdgeIds.add(edge.id);
    } else if (completedNodeIds.has(edge.source) && completedNodeIds.has(edge.target)) {
      completedPathEdgeIds.add(edge.id);
    }
  }

  return {
    runningNodeIds,
    completedNodeIds,
    failedNodeIds,
    activeFeedEdgeIds,
    completedPathEdgeIds,
  };
}
