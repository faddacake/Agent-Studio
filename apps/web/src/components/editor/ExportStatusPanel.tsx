"use client";

/**
 * ExportStatusPanel — export trigger (Preview + Full) and status display.
 *
 * Renders inside the EditorToolbar. Shows:
 *   idle        → "Preview" + "Export" buttons (Preview is secondary style)
 *   triggering  → mode label + "Exporting…" static label (POST in flight)
 *   fetching    → progress bar + stage badge + ETR + projected cost
 *                   pending  → stage "Queued"
 *                   running  → stage "Rendering" → "Encoding" (progress-based)
 *   done        → "✓ Preview done" / "✓ Export done" + sceneCount + duration + dismiss
 *   error       → error message + "Retry" button
 *
 * Progress and ETR are estimated from elapsed time vs a render-speed heuristic:
 *   preview → ~1.5× real-time   full → ~5× real-time
 *
 * Cost is a rough estimate (preview: $0.001/s, full: $0.004/s of video).
 *
 * Accessibility:
 *   A single `role="status"` live region is always mounted inside a
 *   `display: contents` wrapper. The wrapper uses `display: contents` so
 *   neither it nor the off-screen live region affects the toolbar's flex layout.
 */

import type { CSSProperties } from "react";
import { useState, useEffect, useRef } from "react";
import { formatDurationMs, hasRenderResult } from "@/lib/exportJobStatus";
import type { ExportJobStatusResponse } from "@/lib/exportJobStatus";
import type { ExportJobHookState, ExportMode } from "@/hooks/useExportJob";
import { useBudgetSettings } from "@/hooks/useBudgetSettings";
import { formatCost } from "@/lib/formatExecution";

// ── Pulse animation ────────────────────────────────────────────────────────────

const PULSE_KEYFRAMES = "@keyframes esp-pulse{0%,100%{opacity:.25}50%{opacity:1}}";

/** Inject the esp-pulse keyframe rule once per document (idempotent). */
function useEspPulse() {
  const injected = useRef(false);
  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const existing = document.getElementById("esp-pulse-style");
    if (existing) return;
    const el = document.createElement("style");
    el.id = "esp-pulse-style";
    el.textContent = PULSE_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

// ── Platform ───────────────────────────────────────────────────────────────────

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const EXPORT_SHORTCUT_HINT   = isMac ? "Export (⌘E)"        : "Export (Ctrl+E)";
const RETRY_SHORTCUT_HINT    = isMac ? "Retry (⌘E)"         : "Retry (Ctrl+E)";
const PREVIEW_SHORTCUT_HINT  = isMac ? "Quick Preview (⌘⇧E)" : "Quick Preview (Ctrl+Shift+E)";

// ── Render-speed heuristics ────────────────────────────────────────────────────

/** Estimated render time relative to video duration (preview is faster / lower res). */
const RENDER_FACTOR: Record<ExportMode, number> = {
  preview: 1.5,  // ~1.5× real-time
  full:    5,    // ~5× real-time
};

/** Projected cost per second of output video (USD). */
const COST_PER_SECOND: Record<ExportMode, number> = {
  preview: 0.001,
  full:    0.004,
};

// ── Error humanization (export-specific) ──────────────────────────────────────

function humanizeExportError(raw: string | null): { message: string; suggestion?: string } {
  if (!raw) return { message: "Export failed" };
  const s = raw.toLowerCase();
  if (s.includes("429") || s.includes("rate limit")) {
    return { message: "Rate limit reached", suggestion: "Wait a moment then retry" };
  }
  if (s.includes("401") || s.includes("403") || s.includes("unauthorized")) {
    return { message: "Authentication failed", suggestion: "Check your API key in Settings" };
  }
  if (s.includes("timeout") || s.includes("timed out")) {
    return { message: "Render timed out", suggestion: "Try a shorter export or retry" };
  }
  if (s.includes("ffmpeg") || s.includes("render")) {
    return { message: "Render engine error", suggestion: "Retry — if it persists, check export settings" };
  }
  if (s.includes("500") || s.includes("502") || s.includes("503")) {
    return { message: "Server error", suggestion: "Retry in a moment" };
  }
  if (s.includes("status read failed")) {
    return { message: "Connection lost during export", suggestion: "Check your network and retry" };
  }
  const msg = raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
  return { message: msg, suggestion: "Retry or check the console for details" };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

function formatEtr(ms: number): string {
  if (ms <= 0) return "<1s";
  if (ms < 60_000) return `~${Math.ceil(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.ceil((ms % 60_000) / 1000);
  return `~${m}m ${s}s`;
}

function deriveStage(
  status: ExportJobStatusResponse["status"] | undefined,
  progress: number,
): string {
  if (!status || status === "pending") return "Queued";
  if (status === "running") return progress >= 0.78 ? "Encoding" : "Rendering";
  return "Rendering";
}

function liveAnnouncement(
  state: ExportJobHookState,
  jobStatus: ExportJobStatusResponse | null,
  hasResult: boolean,
  mode: ExportMode | null,
): string {
  const label = mode === "preview" ? "Preview" : "Export";
  switch (state) {
    case "triggering": return `${label} starting`;
    case "fetching":
      if (jobStatus?.status === "running") return `${label} rendering`;
      if (jobStatus?.status === "pending") return `${label} queued`;
      return `${label} exporting`;
    case "error":   return `${label} failed`;
    case "done":    return hasResult ? `${label} done` : `${label} queued successfully`;
    default:        return "";
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ExportStatusPanelProps {
  state: ExportJobHookState;
  jobStatus: ExportJobStatusResponse | null;
  error: string | null;
  exportMode: ExportMode | null;
  startedAt: number | null;
  onExport: () => void;
  onPreview: () => void;
  onReset: () => void;
  /**
   * Total project duration in ms — used to show a pre-export cost estimate
   * and warn if it would exceed the user's budget cap.
   * Optional; if omitted the cost warning is suppressed in the idle state.
   */
  projectDurationMs?: number;
}

export function ExportStatusPanel({
  state,
  jobStatus,
  error,
  exportMode,
  startedAt,
  onExport,
  onPreview,
  onReset,
  projectDurationMs,
}: ExportStatusPanelProps) {
  useEspPulse();
  const { budgetCap } = useBudgetSettings();

  // Pending inline budget confirmation: set when user clicks Export/Preview
  // but the estimated cost exceeds the budget cap.
  const [pendingExport, setPendingExport] = useState<{
    mode: ExportMode;
    estimatedCost: number;
  } | null>(null);

  // Ticking elapsed-time counter — drives progress bar and ETR.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (state !== "fetching" || startedAt === null) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - startedAt);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [state, startedAt]);

  // Budget-aware click handlers: show inline confirmation when pre-export
  // estimate would exceed the cap (only when projectDurationMs is provided).
  function handleExportClick() {
    if (projectDurationMs && projectDurationMs > 0) {
      const cost = (projectDurationMs / 1000) * COST_PER_SECOND["full"];
      if (cost > budgetCap) {
        setPendingExport({ mode: "full", estimatedCost: cost });
        return;
      }
    }
    onExport();
  }

  function handlePreviewClick() {
    if (projectDurationMs && projectDurationMs > 0) {
      const cost = (projectDurationMs / 1000) * COST_PER_SECOND["preview"];
      if (cost > budgetCap) {
        setPendingExport({ mode: "preview", estimatedCost: cost });
        return;
      }
    }
    onPreview();
  }

  const hasResult = jobStatus !== null && hasRenderResult(jobStatus);
  const announcement = liveAnnouncement(state, jobStatus, hasResult, exportMode);

  // ── Derived progress metrics (only meaningful while fetching) ───────────────
  const totalDurationMs = jobStatus?.totalDurationMs ?? 0;
  const mode = exportMode ?? "full";
  const estimatedRenderMs = totalDurationMs * RENDER_FACTOR[mode];
  const progress = estimatedRenderMs > 0
    ? Math.min(0.95, elapsedMs / estimatedRenderMs)
    : 0;
  const etrMs = Math.max(0, estimatedRenderMs - elapsedMs);
  const estimatedCost = (totalDurationMs / 1000) * COST_PER_SECOND[mode];
  const stage = deriveStage(jobStatus?.status, progress);
  const modeLabel = mode === "preview" ? "Preview" : "Export";

  return (
    <span style={{ display: "contents" }}>

      {/* Persistent live region */}
      <span role="status" aria-live="polite" aria-atomic="true" style={srOnly}>
        {announcement}
      </span>

      {/* ── Idle: show Preview + Export buttons (or inline budget warning) ─── */}
      {state === "idle" && !pendingExport && (
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handlePreviewClick}
            title={PREVIEW_SHORTCUT_HINT}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              backgroundColor: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            Quick Preview
          </button>
          <button
            type="button"
            onClick={handleExportClick}
            title={EXPORT_SHORTCUT_HINT}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              backgroundColor: "transparent",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            Export
          </button>
        </span>
      )}

      {/* ── Idle + over budget: inline confirmation ──────────────────────────── */}
      {state === "idle" && pendingExport && (
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexShrink: 0,
            minWidth: 200,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--color-warning, #f59e0b)", fontWeight: 600 }}>
            ⚠ ~{formatCost(pendingExport.estimatedCost)} estimated · cap {formatCost(budgetCap)}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.4 }}>
            This {pendingExport.mode} may exceed your budget. The engine will hard-stop at{" "}
            {formatCost(budgetCap)}.
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                setPendingExport(null);
                if (pendingExport.mode === "preview") onPreview();
                else onExport();
              }}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid var(--color-warning, #f59e0b)",
                background: "transparent",
                color: "var(--color-warning, #f59e0b)",
                cursor: "pointer",
              }}
            >
              Proceed
            </button>
            <button
              type="button"
              onClick={() => setPendingExport(null)}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid var(--color-border)",
                background: "transparent",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </span>
        </span>
      )}

      {/* ── Triggering ─────────────────────────────────────────────────────── */}
      {state === "triggering" && (
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-muted)", flexShrink: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: mode === "preview" ? "var(--color-accent, #6366f1)" : "var(--color-success, #22c55e)",
              display: "inline-block",
              animation: "esp-pulse 1.4s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          {modeLabel} starting…
        </span>
      )}

      {/* ── Fetching: progress bar + stage + ETR + cost ─────────────────────── */}
      {state === "fetching" && (
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexShrink: 0,
            minWidth: 160,
          }}
        >
          {/* Top row: pulsing dot + stage badge + mode + ETR */}
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: mode === "preview" ? "var(--color-accent, #6366f1)" : "var(--color-success, #22c55e)",
                display: "inline-block",
                animation: "esp-pulse 1.4s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 5px",
              borderRadius: 3,
              backgroundColor: "var(--color-border)",
              color: "var(--color-text-secondary)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              {stage}
            </span>
            <span>{modeLabel}</span>
            {totalDurationMs > 0 && (
              <span style={{ color: "var(--color-text-muted)", marginLeft: "auto", fontSize: 11 }}>
                {formatEtr(etrMs)} left
              </span>
            )}
          </span>

          {/* Progress bar */}
          <span
            style={{
              position: "relative",
              height: 3,
              borderRadius: 2,
              backgroundColor: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${Math.round(progress * 100)}%`,
                borderRadius: 2,
                backgroundColor: mode === "preview" ? "var(--color-accent, #6366f1)" : "var(--color-success, #22c55e)",
                transition: "width 500ms linear",
              }}
            />
          </span>

          {/* Cost estimate with budget-aware colouring */}
          {estimatedCost > 0 && (() => {
            const overBudget  = estimatedCost >= budgetCap;
            const nearBudget  = !overBudget && estimatedCost >= budgetCap * 0.8;
            const color = overBudget
              ? "var(--color-error, #ef4444)"
              : nearBudget
              ? "var(--color-warning, #f59e0b)"
              : "var(--color-text-muted)";
            return (
              <span style={{ fontSize: 10, color, display: "flex", alignItems: "center", gap: 3 }}>
                {overBudget && <span aria-label="Over budget">⚠</span>}
                {nearBudget && <span aria-label="Approaching budget">!</span>}
                Cost: ~{formatCost(estimatedCost)}
                {overBudget && ` — over ${formatCost(budgetCap)} cap`}
                {nearBudget && ` of ${formatCost(budgetCap)} cap`}
              </span>
            );
          })()}
        </span>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {state === "error" && (() => {
        const { message: errMsg, suggestion } = humanizeExportError(error);
        return (
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              flexShrink: 0,
              maxWidth: 220,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-error)" }}>
              {modeLabel} failed — {errMsg}
              <button
                type="button"
                onClick={onReset}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--color-error)",
                  background: "transparent",
                  color: "var(--color-error)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                title={RETRY_SHORTCUT_HINT}
              >
                Retry
              </button>
            </span>
            {suggestion && (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {suggestion}
              </span>
            )}
          </span>
        );
      })()}

      {/* ── Done ───────────────────────────────────────────────────────────── */}
      {state === "done" && (
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-success, #22c55e)", flexShrink: 0 }}>
          ✓ {modeLabel}{hasResult ? " done" : " queued"}
          {hasResult && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
              {jobStatus.renderResult.sceneCount} scenes ·{" "}
              {formatDurationMs(jobStatus.renderResult.totalDurationMs)}
            </span>
          )}
          <button
            type="button"
            onClick={onReset}
            aria-label={`Dismiss ${modeLabel.toLowerCase()} status`}
            title="Dismiss (Esc)"
            style={{
              fontSize: 11,
              lineHeight: 1,
              padding: "2px 5px",
              borderRadius: 4,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </span>
      )}

    </span>
  );
}
