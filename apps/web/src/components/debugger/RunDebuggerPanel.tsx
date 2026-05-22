"use client";

import { useState, useMemo } from "react";
import type { RunDebugSnapshot, NodeDebugInfo, BlockedReason } from "@iterastudio/engine";

// ── Status colors ──

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: "bg-neutral-800",    text: "text-neutral-400", label: "Pending" },
  queued:    { bg: "bg-yellow-900/40",  text: "text-yellow-400",  label: "Queued" },
  running:   { bg: "bg-blue-900/40",    text: "text-blue-400",    label: "Running" },
  completed: { bg: "bg-green-900/40",   text: "text-green-400",   label: "Completed" },
  failed:    { bg: "bg-red-900/40",     text: "text-red-400",     label: "Failed" },
  cancelled: { bg: "bg-neutral-800/60", text: "text-neutral-500", label: "Cancelled" },
};

const RUN_STATUS_STYLES: Record<string, { text: string; label: string }> = {
  pending:         { text: "text-neutral-400", label: "Pending" },
  running:         { text: "text-blue-400",    label: "Running" },
  completed:       { text: "text-green-400",   label: "Completed" },
  failed:          { text: "text-red-400",     label: "Failed" },
  partial_failure: { text: "text-orange-400",  label: "Partial Failure" },
  cancelled:       { text: "text-neutral-500", label: "Cancelled" },
  budget_exceeded: { text: "text-yellow-400",  label: "Budget Exceeded" },
};

const RUNTIME_LABELS: Record<string, string> = {
  provider:   "Provider",
  local:      "Local",
  virtual:    "Virtual",
  capability: "Capability",
  unknown:    "Unknown",
};

// ── Props ──

export interface RunDebuggerPanelProps {
  /** The debug snapshot to display. */
  snapshot: RunDebugSnapshot;
  /** View mode: by tier grouping or flat topological order. */
  defaultView?: "tiers" | "flat";
  /** Called when a node row is clicked (for canvas highlighting, etc.). */
  onNodeClick?: (nodeId: string) => void;
  /** Workflow ID — required for the Human-in-the-Loop approval API call */
  workflowId?: string;
}

// ── Main component ──

export function RunDebuggerPanel({
  snapshot,
  defaultView = "tiers",
  onNodeClick,
  workflowId,
}: RunDebuggerPanelProps) {
  const [view, setView] = useState<"tiers" | "flat">(defaultView);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    if (!statusFilter) return snapshot.nodes;
    return snapshot.nodes.filter((n: NodeDebugInfo) => n.status === statusFilter);
  }, [snapshot.nodes, statusFilter]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, NodeDebugInfo>();
    for (const n of snapshot.nodes) {
      map.set(n.nodeId, n);
    }
    return map;
  }, [snapshot.nodes]);

  const handleToggleNode = (nodeId: string) => {
    setExpandedNode((prev) => (prev === nodeId ? null : nodeId));
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-200">
      {/* ── Run header ── */}
      <div className="border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">Run Debugger</h3>
            <p className="mt-0.5 text-[11px] text-neutral-500 font-mono">{snapshot.runId}</p>
          </div>
          <RunStatusBadge status={snapshot.status} />
        </div>

        {/* Summary bar */}
        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px]">
          <SummaryPill
            label="Total"
            count={snapshot.summary.total}
            active={!statusFilter}
            onClick={() => setStatusFilter(null)}
          />
          {snapshot.summary.completed > 0 && (
            <SummaryPill
              label="Completed"
              count={snapshot.summary.completed}
              color="text-green-400"
              active={statusFilter === "completed"}
              onClick={() => setStatusFilter(statusFilter === "completed" ? null : "completed")}
            />
          )}
          {snapshot.summary.running > 0 && (
            <SummaryPill
              label="Running"
              count={snapshot.summary.running}
              color="text-blue-400"
              active={statusFilter === "running"}
              onClick={() => setStatusFilter(statusFilter === "running" ? null : "running")}
            />
          )}
          {snapshot.summary.queued > 0 && (
            <SummaryPill
              label="Queued"
              count={snapshot.summary.queued}
              color="text-yellow-400"
              active={statusFilter === "queued"}
              onClick={() => setStatusFilter(statusFilter === "queued" ? null : "queued")}
            />
          )}
          {snapshot.summary.pending > 0 && (
            <SummaryPill
              label="Pending"
              count={snapshot.summary.pending}
              color="text-neutral-400"
              active={statusFilter === "pending"}
              onClick={() => setStatusFilter(statusFilter === "pending" ? null : "pending")}
            />
          )}
          {snapshot.summary.failed > 0 && (
            <SummaryPill
              label="Failed"
              count={snapshot.summary.failed}
              color="text-red-400"
              active={statusFilter === "failed"}
              onClick={() => setStatusFilter(statusFilter === "failed" ? null : "failed")}
            />
          )}
          {snapshot.summary.cancelled > 0 && (
            <SummaryPill
              label="Cancelled"
              count={snapshot.summary.cancelled}
              color="text-neutral-500"
              active={statusFilter === "cancelled"}
              onClick={() => setStatusFilter(statusFilter === "cancelled" ? null : "cancelled")}
            />
          )}
        </div>

        {/* Cost + timing */}
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-neutral-500">
          {snapshot.totalCost > 0 && (
            <span>Cost: <span className="text-neutral-300">${snapshot.totalCost.toFixed(4)}</span></span>
          )}
          {snapshot.budgetCap !== undefined && (
            <span>Budget: <span className="text-neutral-300">${snapshot.budgetCap.toFixed(2)}</span> ({snapshot.budgetMode})</span>
          )}
          {snapshot.startedAt && snapshot.completedAt && (
            <span>Duration: <span className="text-neutral-300">{formatDuration(snapshot.completedAt - snapshot.startedAt)}</span></span>
          )}
          <span>Tiers: <span className="text-neutral-300">{snapshot.tiers.length}</span></span>
        </div>

        {/* View toggle */}
        <div className="mt-2.5 flex gap-1">
          <ViewToggle label="Tiers" active={view === "tiers"} onClick={() => setView("tiers")} />
          <ViewToggle label="Flat" active={view === "flat"} onClick={() => setView("flat")} />
        </div>
      </div>

      {/* ── Human-in-the-Loop approval banner ── */}
      {(() => {
        if (!workflowId) return null;
        // Find first running node that has a step awaiting approval
        const awaitingNode = snapshot.nodes.find((n) =>
          n.status === "running" &&
          n.agentSteps?.some((s) => s.requiresApproval && !s.isFinal),
        );
        if (!awaitingNode) return null;
        const pendingStep = awaitingNode.agentSteps!.find((s) => s.requiresApproval && !s.isFinal);
        if (!pendingStep?.answer) return null;

        return (
          <ApprovalBanner
            workflowId={workflowId}
            runId={snapshot.runId}
            nodeId={awaitingNode.nodeId}
            nodeLabel={awaitingNode.label}
            pendingAnswer={pendingStep.answer}
          />
        );
      })()}

      {/* ── Node list ── */}
      <div className="flex-1 overflow-y-auto">
        {view === "tiers" ? (
          <TierView
            tiers={snapshot.tiers}
            nodeMap={nodeMap}
            filteredNodes={filteredNodes}
            expandedNode={expandedNode}
            onToggle={handleToggleNode}
            onNodeClick={onNodeClick}
          />
        ) : (
          <FlatView
            nodes={filteredNodes}
            nodeMap={nodeMap}
            expandedNode={expandedNode}
            onToggle={handleToggleNode}
            onNodeClick={onNodeClick}
          />
        )}
      </div>
    </div>
  );
}

// ── Tier view ──

function TierView({
  tiers,
  nodeMap,
  filteredNodes,
  expandedNode,
  onToggle,
  onNodeClick,
}: {
  tiers: string[][];
  nodeMap: Map<string, NodeDebugInfo>;
  filteredNodes: NodeDebugInfo[];
  expandedNode: string | null;
  onToggle: (id: string) => void;
  onNodeClick?: (id: string) => void;
}) {
  const filteredIds = new Set(filteredNodes.map((n) => n.nodeId));

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {tiers.map((tierIds, tierIndex) => {
        const visibleIds = tierIds.filter((id) => filteredIds.has(id));
        if (visibleIds.length === 0) return null;

        return (
          <div key={tierIndex}>
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                Tier {tierIndex}
              </span>
              <span className="text-[10px] text-neutral-700">
                ({visibleIds.length} node{visibleIds.length !== 1 ? "s" : ""})
              </span>
              {tierIndex === 0 && (
                <span className="text-[9px] text-neutral-600 italic">— no dependencies</span>
              )}
            </div>
            {visibleIds.map((nodeId) => {
              const info = nodeMap.get(nodeId);
              if (!info) return null;
              return (
                <NodeRow
                  key={nodeId}
                  info={info}
                  expanded={expandedNode === nodeId}
                  onToggle={() => onToggle(nodeId)}
                  onNodeClick={onNodeClick}
                  nodeMap={nodeMap}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Flat view ──

function FlatView({
  nodes,
  nodeMap,
  expandedNode,
  onToggle,
  onNodeClick,
}: {
  nodes: NodeDebugInfo[];
  nodeMap: Map<string, NodeDebugInfo>;
  expandedNode: string | null;
  onToggle: (id: string) => void;
  onNodeClick?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 p-2">
      {nodes.map((info) => (
        <NodeRow
          key={info.nodeId}
          info={info}
          expanded={expandedNode === info.nodeId}
          onToggle={() => onToggle(info.nodeId)}
          onNodeClick={onNodeClick}
          nodeMap={nodeMap}
        />
      ))}
    </div>
  );
}

// ── Node row ──

function NodeRow({
  info,
  expanded,
  onToggle,
  onNodeClick,
  nodeMap,
}: {
  info: NodeDebugInfo;
  expanded: boolean;
  onToggle: () => void;
  onNodeClick?: (id: string) => void;
  nodeMap: Map<string, NodeDebugInfo>;
}) {
  const styles = STATUS_STYLES[info.status] ?? STATUS_STYLES.pending;
  const runtimeLabel = RUNTIME_LABELS[info.runtimeKind] ?? info.runtimeKind;

  return (
    <div className={`rounded-md border border-neutral-800/50 ${expanded ? "bg-neutral-900/60" : ""}`}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => {
          onToggle();
          onNodeClick?.(info.nodeId);
        }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-neutral-800/40"
      >
        {/* Status dot */}
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${styles.bg.replace("/40", "").replace("/60", "")} ${info.status === "running" ? "animate-pulse" : ""}`}
          style={{
            backgroundColor:
              info.status === "completed" ? "rgb(74 222 128)" :
              info.status === "failed" ? "rgb(248 113 113)" :
              info.status === "running" ? "rgb(96 165 250)" :
              info.status === "queued" ? "rgb(250 204 21)" :
              info.status === "cancelled" ? "rgb(115 115 115)" :
              "rgb(163 163 163)",
          }}
        />

        {/* Label */}
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">
          {info.label}
        </span>

        {/* Runtime badge */}
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500">
          {runtimeLabel}
        </span>

        {/* Status */}
        <span className={`shrink-0 text-[10px] font-medium ${styles.text}`}>
          {styles.label}
        </span>

        {/* Duration */}
        {info.durationMs !== undefined && (
          <span className="shrink-0 text-[10px] text-neutral-600 tabular-nums">
            {formatDuration(info.durationMs)}
          </span>
        )}

        {/* Expand chevron */}
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <NodeDetail info={info} nodeMap={nodeMap} />
      )}
    </div>
  );
}

// ── Node detail (expanded) ──

function NodeDetail({
  info,
  nodeMap,
}: {
  info: NodeDebugInfo;
  nodeMap: Map<string, NodeDebugInfo>;
}) {
  return (
    <div className="border-t border-neutral-800/50 px-3 py-2 text-[11px]">
      {/* Identity */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-500">
        <span>Type</span>
        <span className="text-neutral-300 font-mono">{info.type}</span>

        <span>Node ID</span>
        <span className="text-neutral-400 font-mono truncate">{info.nodeId}</span>

        <span>Runtime</span>
        <span className="text-neutral-300">{RUNTIME_LABELS[info.runtimeKind] ?? info.runtimeKind}</span>

        <span>Tier</span>
        <span className="text-neutral-300">{info.tier}</span>

        <span>Topo Order</span>
        <span className="text-neutral-300">#{info.topoIndex}</span>

        <span>Attempts</span>
        <span className="text-neutral-300">{info.attempt}</span>

        {info.providerId && (
          <>
            <span>Provider</span>
            <span className="text-neutral-300">{info.providerId}</span>
          </>
        )}

        {info.modelId && (
          <>
            <span>Model</span>
            <span className="text-neutral-300 truncate">{info.modelId}</span>
          </>
        )}

        {info.cost !== undefined && info.cost > 0 && (
          <>
            <span>Cost</span>
            <span className="text-neutral-300">${info.cost.toFixed(4)}</span>
          </>
        )}
      </div>

      {/* Timestamps */}
      {(info.queuedAt || info.startedAt || info.completedAt) && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-1">Timing</h5>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-neutral-500">
            {info.queuedAt && (
              <>
                <span>Queued</span>
                <span className="text-neutral-400 tabular-nums">{formatTimestamp(info.queuedAt)}</span>
              </>
            )}
            {info.startedAt && (
              <>
                <span>Started</span>
                <span className="text-neutral-400 tabular-nums">{formatTimestamp(info.startedAt)}</span>
              </>
            )}
            {info.completedAt && (
              <>
                <span>Finished</span>
                <span className="text-neutral-400 tabular-nums">{formatTimestamp(info.completedAt)}</span>
              </>
            )}
            {info.durationMs !== undefined && (
              <>
                <span>Duration</span>
                <span className="text-neutral-300 tabular-nums">{formatDuration(info.durationMs)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {info.dependencies.length > 0 && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-1">
            Dependencies ({info.dependencies.length})
          </h5>
          <div className="flex flex-col gap-0.5">
            {info.dependencies.map((depId: string) => {
              const dep = nodeMap.get(depId);
              const depStyles = STATUS_STYLES[dep?.status ?? "pending"];
              return (
                <div key={depId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        dep?.status === "completed" ? "rgb(74 222 128)" :
                        dep?.status === "failed" ? "rgb(248 113 113)" :
                        "rgb(163 163 163)",
                    }}
                  />
                  <span className="text-neutral-400 truncate">
                    {dep?.label ?? depId}
                  </span>
                  <span className={`text-[10px] ${depStyles.text}`}>
                    {depStyles.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dependents */}
      {info.dependents.length > 0 && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-1">
            Dependents ({info.dependents.length})
          </h5>
          <div className="flex flex-col gap-0.5">
            {info.dependents.map((depId: string) => {
              const dep = nodeMap.get(depId);
              const depStyles = STATUS_STYLES[dep?.status ?? "pending"];
              return (
                <div key={depId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        dep?.status === "completed" ? "rgb(74 222 128)" :
                        dep?.status === "failed" ? "rgb(248 113 113)" :
                        "rgb(163 163 163)",
                    }}
                  />
                  <span className="text-neutral-400 truncate">
                    {dep?.label ?? depId}
                  </span>
                  <span className={`text-[10px] ${depStyles.text}`}>
                    {depStyles.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* I/O summary */}
      {(info.inputKeys.length > 0 || info.outputKeys.length > 0) && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-1">Data Flow</h5>
          {info.inputKeys.length > 0 && (
            <div className="text-neutral-500">
              Inputs: <span className="text-neutral-400">{info.inputKeys.join(", ")}</span>
            </div>
          )}
          {info.outputKeys.length > 0 && (
            <div className="text-neutral-500">
              Outputs: <span className="text-neutral-400">{info.outputKeys.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Blocked reason */}
      {info.blockedReason && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <BlockedReasonBadge reason={info.blockedReason} nodeMap={nodeMap} />
        </div>
      )}

      {/* Error */}
      {info.error && (
        <div className="mt-2 border-t border-neutral-800/40 pt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-red-500/70 mb-1">Error</h5>
          <pre className="whitespace-pre-wrap break-words rounded bg-red-950/30 p-2 text-[10px] text-red-300 font-mono">
            {info.error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Blocked reason badge ──

function BlockedReasonBadge({
  reason,
  nodeMap,
}: {
  reason: BlockedReason;
  nodeMap: Map<string, NodeDebugInfo>;
}) {
  const { message, color } = getBlockedReasonDisplay(reason, nodeMap);

  return (
    <div className={`rounded px-2 py-1.5 text-[10px] font-medium ${color}`}>
      {message}
    </div>
  );
}

function getBlockedReasonDisplay(
  reason: BlockedReason,
  nodeMap: Map<string, NodeDebugInfo>,
): { message: string; color: string } {
  switch (reason.kind) {
    case "waiting_on_dependency": {
      const labels = reason.pendingDeps
        .map((id: string) => nodeMap.get(id)?.label ?? id)
        .join(", ");
      return { message: `Waiting on: ${labels}`, color: "text-yellow-400 bg-yellow-950/30" };
    }
    case "failed_upstream": {
      const labels = reason.failedDeps
        .map((id: string) => nodeMap.get(id)?.label ?? id)
        .join(", ");
      return { message: `Blocked by failure: ${labels}`, color: "text-red-400 bg-red-950/30" };
    }
    case "cancelled_upstream":
      return { message: "Cancelled due to upstream cancellation", color: "text-neutral-400 bg-neutral-800/50" };
    case "budget_exceeded":
      return { message: "Cancelled — budget cap exceeded", color: "text-yellow-400 bg-yellow-950/30" };
    case "validation_error":
      return { message: reason.message, color: "text-orange-400 bg-orange-950/30" };
    case "run_cancelled":
      return { message: "Run was cancelled by user", color: "text-neutral-400 bg-neutral-800/50" };
  }
}

// ── Small UI elements ──

function RunStatusBadge({ status }: { status: string }) {
  const style = RUN_STATUS_STYLES[status] ?? { text: "text-neutral-400", label: status };
  return (
    <span className={`rounded-full border border-neutral-700 px-2.5 py-0.5 text-[11px] font-semibold ${style.text}`}>
      {style.label}
    </span>
  );
}

function SummaryPill({
  label,
  count,
  color = "text-neutral-300",
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-neutral-700 text-neutral-100"
          : "bg-neutral-800/60 hover:bg-neutral-800"
      } ${color}`}
    >
      {label} {count}
    </button>
  );
}

function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-neutral-700 text-neutral-100"
          : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label}
    </button>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-neutral-600 transition-transform ${expanded ? "" : "-rotate-90"}`}
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

// ── Formatters ──

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Human-in-the-Loop Approval Banner ──

function ApprovalBanner({
  workflowId,
  runId,
  nodeLabel,
  pendingAnswer,
}: {
  workflowId: string;
  runId: string;
  nodeId: string;
  nodeLabel: string;
  pendingAnswer: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const resolve = async (approved: boolean) => {
    setSubmitting(true);
    try {
      await fetch(`/api/workflows/${workflowId}/runs/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, feedback: approved ? undefined : feedback }),
      });
    } finally {
      setSubmitting(false);
      setFeedback("");
      setShowFeedback(false);
    }
  };

  return (
    <div className="border-b border-amber-700/40 bg-amber-950/20 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true">&#9646;</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-300">
            {nodeLabel} is waiting for your approval
          </p>
          <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-neutral-300 whitespace-pre-wrap">
            {pendingAnswer}
          </p>

          {showFeedback && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Optional: explain what needs improvement&#8230;"
              rows={2}
              className="mt-2 w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void resolve(true)}
              className="rounded border border-emerald-600 bg-emerald-600/10 px-3 py-1 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20 disabled:cursor-default disabled:opacity-50"
            >
              {submitting ? "Sending…" : "✓ Approve"}
            </button>
            {!showFeedback ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowFeedback(true)}
                className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:cursor-default disabled:opacity-50"
              >
                &#x2717; Reject
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void resolve(false)}
                className="rounded border border-red-700 bg-red-900/20 px-3 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-900/30 disabled:cursor-default disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send Rejection"}
              </button>
            )}
            {showFeedback && (
              <button
                type="button"
                onClick={() => { setShowFeedback(false); setFeedback(""); }}
                className="text-[11px] text-neutral-600 hover:text-neutral-400"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
