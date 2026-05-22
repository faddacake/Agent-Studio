"use client";

/**
 * SubAgentNode — specialized React Flow canvas component for Sub-Agent nodes.
 *
 * Visual identity:
 *   - Indigo accent border (distinct from violet Agent + emerald Memory nodes)
 *   - Users icon in the header
 *   - Role text shown below the label in muted text
 *   - Depth badge when agent is nested (__agentDepth > 0)
 *   - Last result summary from the run debug snapshot
 */

import { memo } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Port } from "@aistudio/shared";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useShallow } from "zustand/react/shallow";
import { isMissingKeyError } from "@/lib/missingKeyError";

// ── Port colours (shared with other node types) ──────────────────────────────

const PORT_COLORS: Record<string, string> = {
  image:  "#a855f7",
  video:  "#f97316",
  text:   "#22c55e",
  number: "#3b82f6",
  json:   "#eab308",
};

// ── Users / network icon ─────────────────────────────────────────────────────

function UsersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function SubAgentNodeComponent({ id, data, selected }: NodeProps) {
  const inputs  = (data.inputs  as Port[]) ?? [];
  const outputs = (data.outputs as Port[]) ?? [];
  const label   = (data.label   as string) ?? "Sub-Agent";
  const params  = (data.params  as Record<string, unknown>) ?? {};
  const role    = (params.role  as string | undefined)?.trim() ?? "";
  const depth   = Number(params.__agentDepth ?? 0);

  // Pull run status + error from debug snapshot; pull last result from latestOutputsByNode
  const { runStatus, runError, lastResult } = useWorkflowStore(useShallow((state) => {
    const debugNode = state.debugSnapshot?.nodes.find((n) => n.nodeId === id);
    const latest = state.latestOutputsByNode?.[id];
    return {
      runStatus:  debugNode?.status ?? null,
      runError:   debugNode?.error ?? null,
      lastResult: latest?.textSnippet?.split("\n")[0].slice(0, 80) ?? latest?.summary?.slice(0, 80) ?? null,
    };
  }));

  const isRunning   = runStatus === "running";
  const isCompleted = runStatus === "completed";
  const isFailed    = runStatus === "failed";

  const borderClass = isFailed
    ? "border-red-500 ring-1 ring-red-500/30"
    : isRunning
    ? "border-indigo-400/70 ring-1 ring-indigo-400/20"
    : selected
    ? "border-indigo-500 ring-1 ring-indigo-500/30"
    : "border-indigo-800/70 hover:border-indigo-700/80";

  return (
    <div
      className={`relative min-w-[200px] max-w-[260px] rounded-lg border bg-neutral-900 shadow-lg transition-colors ${borderClass}`}
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
          title={`${port.id} (${port.type})`}
        />
      ))}

      {/* Header */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="flex items-center gap-1.5">
          {/* Status dot */}
          {isRunning   && <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" title="Running" />}
          {isCompleted && <span className="h-2 w-2 rounded-full bg-indigo-400" title="Completed" />}
          {isFailed    && <span className="h-2 w-2 rounded-full bg-red-400" title="Failed" />}

          <span className="text-indigo-400"><UsersIcon /></span>

          <span className="flex-1 truncate text-sm font-medium text-neutral-100">{label}</span>

          {/* Depth badge — only shown when nested */}
          {depth > 0 && (
            <span className="shrink-0 rounded border border-indigo-700/60 bg-indigo-900/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-300">
              depth {depth}
            </span>
          )}
        </div>

        {/* Role */}
        {role && (
          <p className="mt-0.5 truncate text-[9px] text-neutral-600" title={role}>
            {role}
          </p>
        )}
      </div>

      {/* Last result summary */}
      {lastResult && !isRunning && (
        <div className="border-t border-neutral-800 px-3 py-1.5">
          <p className="truncate text-[10px] text-neutral-400">{lastResult}</p>
        </div>
      )}

      {/* Running indicator */}
      {isRunning && (
        <div className="border-t border-neutral-800 px-3 py-1.5">
          <p className="text-[10px] text-indigo-400 animate-pulse">Working…</p>
        </div>
      )}

      {/* Error strip — key-related failures show actionable badge; other failures
          show the raw message (mirrors AgentNode pattern). */}
      {isFailed && (
        <div className="border-t border-red-900/40 bg-red-950/30 px-3 py-1.5">
          {isMissingKeyError(runError) ? (
            <p className="flex flex-wrap items-center gap-x-1 text-[10px] leading-tight text-red-300">
              <span aria-hidden="true">⚠</span>
              <span>No API Key —</span>
              <Link
                href="/settings/providers"
                className="underline underline-offset-2 transition-colors hover:text-red-200"
                onClick={(e) => e.stopPropagation()}
              >
                Settings → Providers
              </Link>
            </p>
          ) : (
            <p className="line-clamp-2 text-[10px] leading-tight text-red-300">
              {runError ?? "Sub-agent failed"}
            </p>
          )}
        </div>
      )}

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
          title={`${port.id} (${port.type})`}
        />
      ))}
    </div>
  );
}

export const SubAgentNode = memo(SubAgentNodeComponent);
