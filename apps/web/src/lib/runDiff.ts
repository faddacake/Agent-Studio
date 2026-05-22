/**
 * runDiff — human-readable parameter diff between two run graph snapshots.
 *
 * Compares two WorkflowGraph snapshots (captured at dispatch time) and a pair
 * of nodeExecution arrays to produce a compact, prioritised list of changes.
 * No backend calls; pure client-side utility.
 */

import type { WorkflowGraph, WorkflowNode } from "@iterastudio/shared";

// ── Types ──────────────────────────────────────────────────────────────────

export type DiffKind =
  | "param_changed"
  | "model_changed"
  | "node_added"
  | "node_removed";

export interface DiffEntry {
  kind: DiffKind;
  /** Human-readable node label (falls back to type, then nodeId). */
  nodeLabel: string;
  /** Display name of the changed parameter (e.g. "Steps", "Prompt"). */
  key: string;
  /** Previous value as a short display string. */
  prevValue: string;
  /** Current value as a short display string. */
  currValue: string;
}

interface NodeExecutionInfo {
  nodeId: string;
  modelId?: string | null;
  providerId?: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum entries to return — keeps the compare view readable. */
const MAX_ENTRIES = 10;

/** Param keys shown first; everything else is lower priority. */
const PRIORITY_PARAMS: string[] = [
  "prompt",
  "negativePrompt", "negative_prompt",
  "modelId", "model",
  "providerId", "provider",
  "width", "height",
  "steps", "num_inference_steps",
  "cfg", "guidance_scale", "cfgScale",
  "seed",
  "strength", "denoising_strength",
  "sampler", "scheduler",
  "count",
  "format", "output_format",
];

/** Map raw param keys → readable display names. */
const KEY_DISPLAY: Record<string, string> = {
  prompt:               "Prompt",
  negativePrompt:       "Negative Prompt",
  negative_prompt:      "Negative Prompt",
  modelId:              "Model",
  model:                "Model",
  providerId:           "Provider",
  provider:             "Provider",
  width:                "Width",
  height:               "Height",
  steps:                "Steps",
  num_inference_steps:  "Steps",
  cfg:                  "CFG",
  guidance_scale:       "Guidance",
  cfgScale:             "CFG",
  seed:                 "Seed",
  strength:             "Strength",
  denoising_strength:   "Strength",
  sampler:              "Sampler",
  scheduler:            "Scheduler",
  count:                "Count",
  format:               "Format",
  output_format:        "Format",
};

// Keys that are internal/positional — never show in diff.
const IGNORE_KEYS = new Set(["__provenance", "source", "retryCount", "timeoutMs"]);

// ── Helpers ────────────────────────────────────────────────────────────────

function nodeLabel(node: WorkflowNode): string {
  return node.data.label || node.type || node.id;
}

/** Stringify a param value into a compact display string. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed.length === 0) return "(empty)";
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }
  return JSON.stringify(v).slice(0, 60);
}

function priorityOf(key: string): number {
  const idx = PRIORITY_PARAMS.indexOf(key);
  return idx === -1 ? PRIORITY_PARAMS.length : idx;
}

function paramDisplayKey(key: string): string {
  return KEY_DISPLAY[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Core diff ─────────────────────────────────────────────────────────────

export function computeRunDiff(
  currGraph: WorkflowGraph | null,
  prevGraph: WorkflowGraph | null,
  currExecutions: NodeExecutionInfo[],
  prevExecutions: NodeExecutionInfo[],
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // ── Graph-level diff (needs both snapshots) ──────────────────────────────
  if (currGraph && prevGraph) {
    const currNodeMap = new Map(currGraph.nodes.map((n) => [n.id, n]));
    const prevNodeMap = new Map(prevGraph.nodes.map((n) => [n.id, n]));

    // Added nodes (in current, not in prev)
    for (const node of currGraph.nodes) {
      if (!prevNodeMap.has(node.id)) {
        entries.push({
          kind: "node_added",
          nodeLabel: nodeLabel(node),
          key: "node",
          prevValue: "—",
          currValue: nodeLabel(node),
        });
      }
    }

    // Removed nodes (in prev, not in current)
    for (const node of prevGraph.nodes) {
      if (!currNodeMap.has(node.id)) {
        entries.push({
          kind: "node_removed",
          nodeLabel: nodeLabel(node),
          key: "node",
          prevValue: nodeLabel(node),
          currValue: "—",
        });
      }
    }

    // Changed params on nodes present in both runs
    const paramEntries: DiffEntry[] = [];
    for (const currNode of currGraph.nodes) {
      const prevNode = prevNodeMap.get(currNode.id);
      if (!prevNode) continue;

      const label = nodeLabel(currNode);
      const currParams: Record<string, unknown> = {
        ...(currNode.data.params ?? {}),
        ...(currNode.data.modelId ? { modelId: currNode.data.modelId } : {}),
        ...(currNode.data.providerId ? { providerId: currNode.data.providerId } : {}),
      };
      const prevParams: Record<string, unknown> = {
        ...(prevNode.data.params ?? {}),
        ...(prevNode.data.modelId ? { modelId: prevNode.data.modelId } : {}),
        ...(prevNode.data.providerId ? { providerId: prevNode.data.providerId } : {}),
      };

      const allKeys = new Set([...Object.keys(currParams), ...Object.keys(prevParams)]);
      for (const key of allKeys) {
        if (IGNORE_KEYS.has(key)) continue;
        const cv = currParams[key];
        const pv = prevParams[key];
        // Skip internal-looking keys (start with __)
        if (key.startsWith("__")) continue;
        // Compare by JSON equality to catch object/array changes
        if (JSON.stringify(cv) === JSON.stringify(pv)) continue;

        const kind: DiffKind =
          key === "modelId" || key === "model" ? "model_changed" : "param_changed";

        paramEntries.push({
          kind,
          nodeLabel: label,
          key: paramDisplayKey(key),
          prevValue: fmtValue(pv),
          currValue: fmtValue(cv),
        });
      }
    }

    // Sort param entries by priority then node label
    paramEntries.sort((a, b) => {
      const rawA = Object.keys(KEY_DISPLAY).find((k) => KEY_DISPLAY[k] === a.key) ?? a.key.toLowerCase();
      const rawB = Object.keys(KEY_DISPLAY).find((k) => KEY_DISPLAY[k] === b.key) ?? b.key.toLowerCase();
      const pa = priorityOf(rawA);
      const pb = priorityOf(rawB);
      if (pa !== pb) return pa - pb;
      return a.nodeLabel.localeCompare(b.nodeLabel);
    });

    entries.push(...paramEntries);
  } else {
    // ── Fallback: execution-level model diff (no graph snapshot) ────────────
    const currExecMap = new Map(currExecutions.map((e) => [e.nodeId, e]));
    for (const prev of prevExecutions) {
      const curr = currExecMap.get(prev.nodeId);
      if (!curr) continue;
      if (curr.modelId && prev.modelId && curr.modelId !== prev.modelId) {
        entries.push({
          kind: "model_changed",
          nodeLabel: prev.nodeId.slice(0, 8),
          key: "Model",
          prevValue: prev.modelId,
          currValue: curr.modelId,
        });
      }
    }
  }

  return entries.slice(0, MAX_ENTRIES);
}
