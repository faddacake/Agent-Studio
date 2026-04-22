"use client";

/**
 * BudgetSettingsPanel — popover panel for viewing/editing the budget cap
 * and reviewing recent run costs for a workflow.
 *
 * Triggered by the "$" / budget icon in WorkflowCanvas toolbar.
 * Fetches GET /api/workflows/:id/runs to show the last 10 runs with costs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useBudgetSettings } from "@/hooks/useBudgetSettings";
import { formatCost } from "@/lib/formatExecution";

interface RunRecord {
  id: string;
  status: string;
  totalCost: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface BudgetSettingsPanelProps {
  workflowId: string;
  onClose: () => void;
  /** Panel anchor — used to position the panel below the trigger button */
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const RUN_STATUS_COLOR: Record<string, string> = {
  completed:       "#4ade80",
  running:         "#60a5fa",
  failed:          "#f87171",
  partial_failure: "#f87171",
  cancelled:       "#737373",
  budget_exceeded: "#facc15",
  pending:         "#facc15",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Tiny SVG sparkline for cost trend of last N runs */
function CostSparkline({ costs }: { costs: number[] }) {
  if (costs.length < 2) return null;
  const W = 120, H = 28, PAD = 2;
  const max = Math.max(...costs);
  const min = 0;
  const range = max - min || 1;
  const points = costs.map((c, i) => {
    const x = PAD + (i / (costs.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((c - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width={W} height={H} aria-hidden="true" className="opacity-70">
      <polyline
        points={points}
        fill="none"
        stroke="#60a5fa"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BudgetSettingsPanel({ workflowId, onClose, anchorRef }: BudgetSettingsPanelProps) {
  const { budgetCap, setBudgetCap } = useBudgetSettings();
  const [inputVal, setInputVal] = useState<string>(budgetCap.toFixed(2));
  const [inputError, setInputError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when budgetCap changes externally
  useEffect(() => {
    setInputVal(budgetCap.toFixed(2));
  }, [budgetCap]);

  // Fetch recent runs
  useEffect(() => {
    if (!workflowId) return;
    setLoadingRuns(true);
    fetch(`/api/workflows/${workflowId}/runs`)
      .then((r) => r.json())
      .then((data: unknown) => {
        setRuns(Array.isArray(data) ? (data as RunRecord[]).slice(0, 10) : []);
      })
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, [workflowId]);

  // Close on Escape or outside click
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, anchorRef]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = useCallback(() => {
    const parsed = parseFloat(inputVal);
    if (isNaN(parsed) || parsed <= 0) {
      setInputError("Enter a positive number");
      return;
    }
    setInputError(null);
    setBudgetCap(parsed);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, [inputVal, setBudgetCap]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSave();
    },
    [handleSave],
  );

  // Derived stats from runs
  const allRuns = runs ?? [];
  const paidRuns = allRuns.filter((r) => r.totalCost !== null && r.totalCost > 0);
  const cumulativeCost = paidRuns.reduce((s, r) => s + (r.totalCost ?? 0), 0);
  const sparklineCosts = paidRuns.map((r) => r.totalCost ?? 0).reverse();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Budget settings"
      className="absolute top-full mt-1 right-0 z-50 w-72 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      style={{ minWidth: "17rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-200">Budget Settings</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-neutral-500 hover:text-neutral-300 transition-colors"
          aria-label="Close budget settings"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Cap editor */}
      <div className="px-4 py-3 border-b border-neutral-800">
        <label className="mb-1.5 block text-xs font-medium text-neutral-400">
          Soft budget cap per run
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-400">$</span>
          <input
            ref={inputRef}
            type="number"
            min="0.01"
            step="0.50"
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              setInputError(null);
            }}
            onKeyDown={handleKeyDown}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
            aria-label="Budget cap in USD"
          />
          <button
            type="button"
            onClick={handleSave}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              savedFlash
                ? "border-emerald-600 bg-emerald-600/10 text-emerald-400"
                : "border-blue-600 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20"
            }`}
          >
            {savedFlash ? "✓ Saved" : "Save"}
          </button>
        </div>
        {inputError && (
          <p className="mt-1 text-xs text-red-400">{inputError}</p>
        )}
        <p className="mt-1.5 text-xs text-neutral-600">
          A warning appears before runs that exceed this amount. Not a hard limit.
        </p>
      </div>

      {/* Spend summary */}
      <div className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-400">
            Total spend · {allRuns.length} {allRuns.length === 1 ? "run" : "runs"}
          </span>
          <span className={`text-sm font-semibold tabular-nums ${
            cumulativeCost >= budgetCap * 2
              ? "text-red-400"
              : cumulativeCost >= budgetCap
              ? "text-amber-400"
              : "text-neutral-200"
          }`}>
            {formatCost(cumulativeCost)}
          </span>
        </div>
        {sparklineCosts.length >= 2 && (
          <div className="mt-2 flex items-center gap-2">
            <CostSparkline costs={sparklineCosts} />
            <span className="text-xs text-neutral-600">cost trend</span>
          </div>
        )}
      </div>

      {/* Recent runs list */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Recent runs
        </p>
        {loadingRuns ? (
          <p className="text-xs text-neutral-600 py-1">Loading…</p>
        ) : !runs || runs.length === 0 ? (
          <p className="text-xs text-neutral-600 py-1">No runs yet.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: RUN_STATUS_COLOR[run.status] ?? "#737373" }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-neutral-500">
                    {formatRelative(run.startedAt)}
                  </span>
                </div>
                <span className={`shrink-0 tabular-nums font-medium ${
                  run.status === "budget_exceeded"
                    ? "text-amber-400"
                    : run.status === "failed" || run.status === "partial_failure"
                    ? "text-red-400"
                    : run.totalCost !== null && run.totalCost > 0
                    ? "text-neutral-300"
                    : "text-neutral-600"
                }`}>
                  {run.totalCost !== null && run.totalCost > 0
                    ? formatCost(run.totalCost)
                    : run.status === "budget_exceeded"
                    ? "capped"
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
