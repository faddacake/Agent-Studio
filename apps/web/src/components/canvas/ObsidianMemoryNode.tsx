"use client";

/**
 * ObsidianMemoryNode — specialized React Flow canvas component for
 * the Obsidian Memory node type.
 *
 * Visual identity:
 *   - Emerald / teal accent border (distinct from violet Agent nodes)
 *   - Brain icon in the header
 *   - Vault path shown below the node label in muted text
 *   - Operation badge (WRITE / APPEND / SEARCH / READ) showing the
 *     active operation from params
 *   - Last result summary (note title written or result count) drawn
 *     from the run debug snapshot when available
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Port } from "@aistudio/shared";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useShallow } from "zustand/react/shallow";
import { isVaultConfigError } from "@/lib/missingKeyError";

// ── Port colours (shared with CustomNode + AgentNode) ────────────────────────

const PORT_COLORS: Record<string, string> = {
  image:  "#a855f7",
  video:  "#f97316",
  text:   "#22c55e",
  number: "#3b82f6",
  json:   "#eab308",
};

// ── Operation badge ──────────────────────────────────────────────────────────

const OP_STYLES: Record<string, string> = {
  write:  "bg-emerald-900/60 text-emerald-300 border-emerald-700/60",
  append: "bg-teal-900/60 text-teal-300 border-teal-700/60",
  search: "bg-cyan-900/60 text-cyan-300 border-cyan-700/60",
  read:   "bg-sky-900/60 text-sky-300 border-sky-700/60",
};

function OperationBadge({ operation }: { operation: string }) {
  const styleClass = OP_STYLES[operation] ?? "bg-neutral-800/60 text-neutral-400 border-neutral-700/60";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styleClass}`}>
      {operation}
    </span>
  );
}

// ── Brain icon ───────────────────────────────────────────────────────────────

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ObsidianMemoryNodeComponent({ id, data, selected }: NodeProps) {
  const inputs    = (data.inputs    as Port[]) ?? [];
  const outputs   = (data.outputs   as Port[]) ?? [];
  const label     = (data.label     as string) ?? "Obsidian Memory";
  const params    = (data.params    as Record<string, unknown>) ?? {};
  const operation = (params.operation as string | undefined) ?? "search";
  const vaultPath = (params.vaultPath as string | undefined)?.trim() || "/app/memory";

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
    ? "border-emerald-400/70 ring-1 ring-emerald-400/20"
    : selected
    ? "border-emerald-500 ring-1 ring-emerald-500/30"
    : "border-emerald-800/70 hover:border-emerald-700/80";

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
          {isRunning   && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Running" />}
          {isCompleted && <span className="h-2 w-2 rounded-full bg-emerald-400" title="Completed" />}
          {isFailed    && <span className="h-2 w-2 rounded-full bg-red-400" title="Failed" />}

          <span className="text-emerald-400"><BrainIcon /></span>

          <span className="flex-1 truncate text-sm font-medium text-neutral-100">{label}</span>

          <OperationBadge operation={operation} />
        </div>

        {/* Vault path */}
        <p className="mt-0.5 truncate text-[9px] text-neutral-600" title={vaultPath}>
          {vaultPath}
        </p>
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
          <p className="text-[10px] text-emerald-400 animate-pulse">Working…</p>
        </div>
      )}

      {/* Error strip — two tiers of actionability:
          1. Vault config error (ENOENT / EACCES / bad path) → actionable hint
          2. Generic failure                                  → raw error, truncated */}
      {isFailed && (
        <div
          className="border-t border-red-900/40 bg-red-950/30 px-3 py-1.5"
          title={runError ?? undefined}
        >
          {isVaultConfigError(runError) ? (
            <p className="text-[10px] leading-tight text-red-300">
              <span aria-hidden="true">⚠</span>{" "}Vault path error — verify path in node settings
            </p>
          ) : (
            <p className="line-clamp-2 text-[10px] leading-tight text-red-300">
              {runError ?? "Memory node failed"}
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

export const ObsidianMemoryNode = memo(ObsidianMemoryNodeComponent);
