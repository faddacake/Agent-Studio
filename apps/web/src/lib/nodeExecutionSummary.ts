/**
 * nodeExecutionSummary — helpers that normalize a NodeDebugInfo record into a
 * compact, UI-friendly summary for the Inspector "Last Run" section.
 */

import type { NodeDebugInfo } from "@iterastudio/engine";

const MAX_ERROR_LEN = 200;

export type ExecutionStatus = "success" | "failed" | "running" | "queued" | "idle";

export interface NodeExecutionSummary {
  nodeId: string;
  runId: string;
  status: ExecutionStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  modelId?: string;
  providerId?: string;
  cost?: number;
  shortError?: string;
}

function normalizeStatus(raw: string): ExecutionStatus {
  if (raw === "completed") return "success";
  if (raw === "failed" || raw === "cancelled" || raw === "skipped") return "failed";
  if (raw === "running") return "running";
  if (raw === "queued") return "queued";
  return "idle";
}

export function summarizeNode(info: NodeDebugInfo, runId: string): NodeExecutionSummary {
  const status = normalizeStatus(info.status);
  const shortError =
    info.error
      ? info.error.length > MAX_ERROR_LEN
        ? info.error.slice(0, MAX_ERROR_LEN) + "…"
        : info.error
      : undefined;
  return {
    nodeId: info.nodeId,
    runId,
    status,
    startedAt: info.startedAt,
    completedAt: info.completedAt,
    durationMs: info.durationMs,
    modelId: info.modelId,
    providerId: info.providerId,
    cost: info.cost,
    shortError,
  };
}

/** Build a map of nodeId → NodeExecutionSummary from a snapshot's node list.
 *  Only nodes with a non-idle status are included. */
export function buildExecutionSummaryMap(
  nodes: NodeDebugInfo[],
  runId: string,
): Record<string, NodeExecutionSummary> {
  const result: Record<string, NodeExecutionSummary> = {};
  for (const n of nodes) {
    const summary = summarizeNode(n, runId);
    if (summary.status !== "idle") {
      result[n.nodeId] = summary;
    }
  }
  return result;
}
