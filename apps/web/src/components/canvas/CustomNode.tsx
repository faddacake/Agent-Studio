"use client";

import { memo, useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Port } from "@aistudio/shared";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useShallow } from "zustand/react/shallow";
import { formatDuration, formatCost, formatElapsed } from "@/lib/formatExecution";
import { NODE_STATE_DOT } from "@/lib/nodeRunState";
import { canRetry } from "@/lib/retryRun";

// ── Port color palette (matches InspectorPanel PortDot) ──

const PORT_COLORS: Record<string, string> = {
  image: "#a855f7",   // purple-500
  video: "#f97316",   // orange-500
  text: "#22c55e",    // green-500
  number: "#3b82f6",  // blue-500
  json: "#eab308",    // yellow-500
};

const RUNTIME_BADGE: Record<string, { label: string; className: string }> = {
  provider: { label: "AI", className: "bg-blue-500/20 text-blue-400" },
  local: { label: "Local", className: "bg-green-500/20 text-green-400" },
  virtual: { label: "Virtual", className: "bg-neutral-500/20 text-neutral-400" },
  capability: { label: "Cap", className: "bg-amber-500/20 text-amber-400" },
};

// ── Run status dot ──

const STATUS_DOT: Record<string, { color: string; pulse: boolean; label: string }> = {
  pending:   { color: "#a3a3a3", pulse: false, label: "Pending" },
  queued:    { color: "#facc15", pulse: false, label: "Queued" },
  running:   { color: "#60a5fa", pulse: true,  label: "Running" },
  completed: { color: "#4ade80", pulse: false, label: "Completed" },
  failed:    { color: "#f87171", pulse: false, label: "Failed" },
  cancelled: { color: "#737373", pulse: false, label: "Cancelled" },
};

// ── Component ──

function CustomNodeComponent({ id, data, selected }: NodeProps) {
  const inputs = (data.inputs as Port[]) ?? [];
  const outputs = (data.outputs as Port[]) ?? [];
  const label = (data.label as string) ?? "Node";
  const runtimeKind = (data.runtimeKind as string) ?? "";
  const modelId = (data.modelId as string | undefined) ?? null;
  const badge = RUNTIME_BADGE[runtimeKind];

  // Stale indicator — amber dot when params/graph changed since last run
  const isStale = useWorkflowStore((state) => state.staleNodeIds[id] === true);

  // Persisted run state — shown when no live debugSnapshot is active
  const persistedRunState = useWorkflowStore((state) =>
    state.debugSnapshot ? null : (state.nodeRunStatesById[id] ?? null),
  );

  // Per-node run status + error + blocked reason — re-renders only when these fields change.
  // useShallow prevents "getSnapshot should be cached" warnings by doing shallow equality
  // on the returned object instead of reference equality, avoiding infinite re-renders.
  const { runStatus, runError, durationMs, cost, attempt, startedAt, isBlockedByUpstream, blockedByLabel } = useWorkflowStore(useShallow((state) => {
    if (!state.debugSnapshot) return { runStatus: null, runError: null, durationMs: null, cost: null, attempt: null, startedAt: null, isBlockedByUpstream: false, blockedByLabel: null };
    const nodes = state.debugSnapshot.nodes;
    const node = nodes.find((n) => n.nodeId === id);
    const reason = node?.blockedReason?.kind === "failed_upstream" ? node.blockedReason : null;
    let blockedByLabel: string | null = null;
    if (reason) {
      const labelMap = new Map(nodes.map((n) => [n.nodeId, n.label]));
      const names = reason.failedDeps.map((depId) => labelMap.get(depId) ?? depId);
      blockedByLabel = names.join(", ");
    }
    return {
      runStatus: node?.status ?? null,
      runError: node?.error ?? null,
      durationMs: node?.durationMs ?? null,
      cost: node?.cost ?? null,
      attempt: node?.attempt ?? null,
      startedAt: node?.startedAt ?? null,
      isBlockedByUpstream: reason !== null,
      blockedByLabel,
    };
  }));

  // Retry eligibility — only when not already running and a workflow is loaded
  const canShowRetry = useWorkflowStore((s) => !s.isRunning && !!s.meta);

  // Live snapshot dot takes priority; fall back to persisted state between runs.
  // When stale AND previously succeeded (no live run), suppress the success dot —
  // the amber stale indicator is the only signal that matters for re-run decisions.
  // Failed state always shows even when stale: the error context remains actionable.
  const dot = runStatus
    ? (STATUS_DOT[runStatus] ?? null)
    : persistedRunState && persistedRunState !== "idle" && !(isStale && persistedRunState === "success")
      ? NODE_STATE_DOT[persistedRunState]
      : null;
  const isFailed = runStatus === "failed" || (!runStatus && persistedRunState === "failed");
  // Only show blocked annotation when not actually failed (failed takes priority)
  const isBlocked = isBlockedByUpstream && !isFailed;

  // Live elapsed time — ticks every second while this node is running
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  useEffect(() => {
    if (runStatus !== "running" || startedAt === null) {
      setElapsedSec(null);
      return;
    }
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runStatus, startedAt]);

  return (
    <div
      className={`relative min-w-[160px] rounded-lg border bg-neutral-900 shadow-lg transition-colors ${
        isFailed
          ? "border-red-500 ring-1 ring-red-500/30"
          : isBlocked
          ? "border-amber-600/70 ring-1 ring-amber-600/20"
          : runStatus === "running"
          ? "border-blue-400/70 ring-1 ring-blue-400/20"
          : selected
          ? "border-blue-500 ring-1 ring-blue-500/30"
          : "border-neutral-700 hover:border-neutral-600"
      }`}
    >
      {/* Input handles */}
      {inputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{
            top: `${((i + 1) / (inputs.length + 1)) * 100}%`,
            background: PORT_COLORS[port.type] ?? "#737373",
            width: 10,
            height: 10,
            border: "2px solid #171717",
          }}
          title={`${port.name} (${port.type})`}
        />
      ))}

      {/* Node body */}
      <div className="px-3 py-2">
        {/* Header row */}
        <div className="group/header flex items-center gap-1.5">
          {/* Run status dot — only visible when a run snapshot is active */}
          {dot && (
            <span className="flex shrink-0 items-center gap-0.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${dot.pulse ? "animate-pulse" : ""}`}
                style={{ backgroundColor: dot.color }}
                title={dot.label}
              />
              {runStatus === "running" && attempt !== null && attempt > 1 && (
                <span className="text-[9px] leading-none text-neutral-500">×{attempt}</span>
              )}
              {elapsedSec !== null && (
                <>
                  {attempt !== null && attempt > 1 && (
                    <span className="text-[9px] leading-none text-neutral-500">·</span>
                  )}
                  <span className="text-[9px] leading-none text-neutral-500">{formatElapsed(elapsedSec)}</span>
                </>
              )}
            </span>
          )}
          <span className="flex-1 truncate text-sm font-medium text-neutral-100">
            {label}
          </span>
          {/* Duplicate button — visible on hover or when selected */}
          <button
            type="button"
            title="Duplicate node (⌘D)"
            aria-label="Duplicate node"
            onClick={(e) => {
              e.stopPropagation();
              useWorkflowStore.getState().duplicateNode(id);
            }}
            className={`shrink-0 rounded p-0.5 text-neutral-500 transition-opacity hover:bg-neutral-700 hover:text-neutral-300 ${
              selected ? "opacity-100" : "opacity-0 group-hover/header:opacity-100"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
              <path d="M1.5 7.5V2a.5.5 0 0 1 .5-.5h5.5" />
            </svg>
          </button>
          {badge && (
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
          {isStale && runStatus === null && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/75"
              title="Stale — params or graph changed since last run"
            />
          )}
        </div>

        {/* Port summary */}
        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
            {inputs.length > 0 && <span>{inputs.length} in</span>}
            {outputs.length > 0 && <span>{outputs.length} out</span>}
          </div>
        )}

        {/* Execution metadata row — duration · cost · retry count */}
        {(runStatus === "completed" || runStatus === "failed") && (durationMs !== null || (cost !== null && cost > 0)) && (
          <div
            className="mt-1 flex items-center gap-1 text-[10px] text-neutral-500"
            title={modelId ?? undefined}
          >
            {durationMs !== null && <span>{formatDuration(durationMs)}</span>}
            {durationMs !== null && cost !== null && cost > 0 && <span>·</span>}
            {cost !== null && cost > 0 && <span>{formatCost(cost)}</span>}
            {attempt !== null && attempt > 1 && <span>· ×{attempt}</span>}
          </div>
        )}

        {/* Inline error strip — shown only when this node failed */}
        {isFailed && (
          <div
            className="mt-1.5 rounded border border-red-900/60 bg-red-950/40 px-1.5 py-1"
            title={runError ?? undefined}
          >
            <div className="flex items-start justify-between gap-1">
              <p className="flex-1 line-clamp-2 text-[10px] leading-tight text-red-300">
                {runError ?? "Node failed"}
              </p>
              {canShowRetry && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void useWorkflowStore.getState().runWorkflow();
                  }}
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium text-red-300 transition-colors hover:bg-red-900/50 hover:text-red-200"
                  title="Retry — re-runs the full workflow"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Blocked strip — shown when an upstream node failed and this node was skipped */}
        {isBlocked && (
          <div
            className="mt-1.5 rounded border border-amber-900/50 bg-amber-950/30 px-1.5 py-1"
            title={blockedByLabel ? `Failed upstream: ${blockedByLabel}` : undefined}
          >
            <p className="text-[10px] leading-tight text-amber-400/80">
              Blocked: upstream failed
            </p>
          </div>
        )}
      </div>

      {/* Output handles */}
      {outputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{
            top: `${((i + 1) / (outputs.length + 1)) * 100}%`,
            background: PORT_COLORS[port.type] ?? "#737373",
            width: 10,
            height: 10,
            border: "2px solid #171717",
          }}
          title={`${port.name} (${port.type})`}
        />
      ))}
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
