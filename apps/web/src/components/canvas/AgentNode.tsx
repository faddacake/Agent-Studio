"use client";

/**
 * AgentNode — specialized React Flow node component for ReAct Agent nodes.
 *
 * Renders the standard node chrome (header, ports, status dot) plus a live
 * Thought/Action/Observation trace that updates in real time via SSE snapshots.
 * Shows the last 3 steps collapsed, expandable to all steps.
 */

import { memo, useState } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Port } from "@aistudio/shared";
import type { AgentStep } from "@aistudio/shared";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useShallow } from "zustand/react/shallow";
import { isMissingKeyError } from "@/lib/missingKeyError";

// ── Port colours (shared with CustomNode) ──

const PORT_COLORS: Record<string, string> = {
  image:  "#a855f7",
  video:  "#f97316",
  text:   "#22c55e",
  number: "#3b82f6",
  json:   "#eab308",
};

// ── Step badge ──

function StepBadge({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);

  const label = step.isFinal
    ? "Final"
    : step.action
    ? `Action: ${step.action.tool}`
    : "Thought";

  const badgeClass = step.isFinal
    ? "bg-green-900/50 border-green-700/60 text-green-300"
    : step.action
    ? "bg-blue-900/50 border-blue-700/60 text-blue-300"
    : "bg-neutral-800/80 border-neutral-700/60 text-neutral-400";

  return (
    <div
      className={`mt-1 rounded border px-1.5 py-1 text-[10px] leading-tight cursor-pointer ${badgeClass}`}
      onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
      title="Click to expand"
    >
      {/* Step header row */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium opacity-80">{`#${step.index + 1}`}</span>
        <span className="flex-1 truncate">{label}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Thought preview (always visible) */}
      {!expanded && (
        <p className="mt-0.5 line-clamp-2 text-[9px] opacity-70 leading-tight">
          {step.thought}
        </p>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-1 space-y-1">
          <div>
            <span className="font-semibold opacity-60">Thought</span>
            <p className="mt-0.5 whitespace-pre-wrap text-[9px] leading-tight opacity-80">
              {step.thought}
            </p>
          </div>

          {step.action && (
            <div>
              <span className="font-semibold opacity-60">
                Action: <span className="font-mono">{step.action.tool}</span>
              </span>
              <p className="mt-0.5 font-mono text-[9px] leading-tight opacity-70 break-all">
                {JSON.stringify(step.action.params)}
              </p>
            </div>
          )}

          {step.observation !== undefined && (
            <div>
              <span className="font-semibold opacity-60">Observation</span>
              <p className="mt-0.5 line-clamp-4 text-[9px] leading-tight opacity-70 whitespace-pre-wrap">
                {step.observation}
              </p>
            </div>
          )}

          {step.isFinal && step.answer && (
            <div>
              <span className="font-semibold opacity-60 text-green-300">Answer</span>
              <p className="mt-0.5 line-clamp-4 text-[9px] leading-tight text-green-200 whitespace-pre-wrap">
                {step.answer}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

function AgentNodeComponent({ id, data, selected }: NodeProps) {
  const inputs  = (data.inputs  as Port[]) ?? [];
  const outputs = (data.outputs as Port[]) ?? [];
  const label   = (data.label   as string) ?? "Agent";

  const [showAllSteps, setShowAllSteps] = useState(false);

  // Pull run state + agent steps + error from the Zustand snapshot.
  // NodeDebugInfo.agentSteps is populated by buildDebugSnapshot from NodeState.
  const { runStatus, agentSteps, runError } = useWorkflowStore(useShallow((state) => {
    if (!state.debugSnapshot) return { runStatus: null as string | null, agentSteps: null as AgentStep[] | null, runError: null as string | null };
    const node = state.debugSnapshot.nodes.find((n) => n.nodeId === id);
    return {
      runStatus:  node?.status ?? null,
      agentSteps: node?.agentSteps ?? null,
      runError:   node?.error ?? null,
    };
  }));

  const isRunning   = runStatus === "running";
  const isCompleted = runStatus === "completed";
  const isFailed    = runStatus === "failed";

  const stepsToShow = agentSteps
    ? (showAllSteps ? agentSteps : agentSteps.slice(-3))
    : null;

  // Border colour mirrors CustomNode
  const borderClass = isFailed
    ? "border-red-500 ring-1 ring-red-500/30"
    : isRunning
    ? "border-blue-400/70 ring-1 ring-blue-400/20"
    : selected
    ? "border-blue-500 ring-1 ring-blue-500/30"
    : "border-violet-700/70 hover:border-violet-600/80";

  return (
    <div
      className={`relative min-w-[200px] max-w-[280px] rounded-lg border bg-neutral-900 shadow-lg transition-colors ${borderClass}`}
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

      {/* Header */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-1.5">
          {/* Status dot */}
          {runStatus === "running" && (
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" title="Running" />
          )}
          {runStatus === "completed" && (
            <span className="inline-block h-2 w-2 rounded-full bg-green-400" title="Completed" />
          )}
          {runStatus === "failed" && (
            <span className="inline-block h-2 w-2 rounded-full bg-red-400" title="Failed" />
          )}

          {/* Robot icon */}
          <span className="text-violet-400" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="16" x2="8" y2="16" />
              <line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          </span>

          <span className="flex-1 truncate text-sm font-medium text-neutral-100">{label}</span>

          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-violet-500/20 text-violet-400">
            Agent
          </span>
        </div>

        {/* Port summary */}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-500">
          {inputs.length  > 0 && <span>{inputs.length} in</span>}
          {outputs.length > 0 && <span>{outputs.length} out</span>}
        </div>
      </div>

      {/* Live step trace */}
      {stepsToShow && stepsToShow.length > 0 && (
        <div className="border-t border-neutral-800 px-2 pb-2">
          {/* Show-more toggle */}
          {agentSteps && agentSteps.length > 3 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowAllSteps((v) => !v); }}
              className="mt-1.5 w-full rounded text-[9px] text-neutral-500 hover:text-neutral-300 transition-colors text-center"
            >
              {showAllSteps
                ? `▲ Show fewer (${agentSteps.length} total)`
                : `▼ +${agentSteps.length - 3} earlier steps`}
            </button>
          )}

          {stepsToShow.map((step) => (
            <StepBadge key={step.index} step={step} />
          ))}
        </div>
      )}

      {/* Thinking indicator when running with no steps yet */}
      {isRunning && (!agentSteps || agentSteps.length === 0) && (
        <div className="border-t border-neutral-800 px-3 py-2">
          <p className="text-[10px] text-blue-400 animate-pulse">Thinking…</p>
        </div>
      )}

      {/* Completion summary */}
      {isCompleted && agentSteps && agentSteps.length > 0 && (
        <div className="border-t border-neutral-800 px-3 py-1">
          <p className="text-[10px] text-neutral-500">
            {agentSteps.length} step{agentSteps.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* Error strip — key-related failures show actionable badge; other failures
          show the raw message (fixes the previous gap where AgentNode showed no
          error text at all, only a red border). */}
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
              {runError ?? "Agent failed"}
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
          title={`${port.name} (${port.type})`}
        />
      ))}
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
