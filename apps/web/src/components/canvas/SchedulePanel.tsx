"use client";

/**
 * SchedulePanel — popover for viewing and editing the workflow cron schedule.
 *
 * Triggered by the "Schedule" button in WorkflowCanvas toolbar.
 * Reads/writes GET|POST|DELETE /api/workflows/:id/schedule.
 *
 * Styled to match BudgetSettingsPanel exactly (Tailwind, same close behaviour).
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface ScheduleRecord {
  cron: string;
  enabled: boolean;
  updatedAt: string;
}

interface SchedulePanelProps {
  workflowId: string;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  /** Called whenever the schedule is created, updated, or removed. */
  onScheduleChange?: (active: boolean) => void;
}

const PRESETS: { label: string; cron: string }[] = [
  { label: "Hourly",        cron: "0 * * * *"    },
  { label: "Daily 9am",     cron: "0 9 * * *"    },
  { label: "Mon 9am",       cron: "0 9 * * 1"    },
  { label: "Every 30 min",  cron: "*/30 * * * *"  },
];

function formatRelative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SchedulePanel({ workflowId, onClose, anchorRef, onScheduleChange }: SchedulePanelProps) {
  const [cronInput, setCronInput]   = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [schedule, setSchedule]     = useState<ScheduleRecord | null>(null);
  const [loading, setLoading]       = useState(true);
  const panelRef  = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Fetch existing schedule on mount
  useEffect(() => {
    fetch(`/api/workflows/${workflowId}/schedule`)
      .then((r) => r.ok ? (r.json() as Promise<{ schedule: ScheduleRecord | null }>) : { schedule: null })
      .then((data) => {
        setSchedule(data.schedule);
        if (data.schedule) setCronInput(data.schedule.cron);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workflowId]);

  // Close on Escape or outside click
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, anchorRef]);

  // Focus input on open
  useEffect(() => { inputRef.current?.focus(); }, []);

  const persistSchedule = useCallback(async (cron: string, enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron, enabled }),
      });
      const data = await res.json() as { ok?: boolean; schedule?: ScheduleRecord; message?: string };
      if (!res.ok) {
        setInputError(data.message ?? "Failed to save schedule");
        return;
      }
      setSchedule(data.schedule ?? null);
      if (data.schedule) setCronInput(data.schedule.cron);
      onScheduleChange?.(data.schedule?.enabled === true);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch {
      setInputError("Network error — could not save schedule");
    } finally {
      setSaving(false);
    }
  }, [workflowId]);

  const handleSave = useCallback(() => {
    const trimmed = cronInput.trim();
    if (trimmed.split(/\s+/).length !== 5) {
      setInputError("Enter a valid 5-field cron expression (e.g. 0 9 * * *)");
      return;
    }
    setInputError(null);
    void persistSchedule(trimmed, true);
  }, [cronInput, persistSchedule]);

  const handleToggleEnabled = useCallback(() => {
    if (!schedule) return;
    void persistSchedule(schedule.cron, !schedule.enabled);
  }, [schedule, persistSchedule]);

  const handleRemove = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/workflows/${workflowId}/schedule`, { method: "DELETE" });
      setSchedule(null);
      setCronInput("");
      onScheduleChange?.(false);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }, [workflowId]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Schedule run"
      className="absolute top-full mt-1 right-0 z-50 w-72 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      style={{ minWidth: "17rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-200">Schedule Run</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-neutral-500 hover:text-neutral-300 transition-colors"
          aria-label="Close schedule panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Cron input */}
      <div className="px-4 py-3 border-b border-neutral-800">
        <label className="mb-1.5 block text-xs font-medium text-neutral-400">
          Cron expression
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={cronInput}
            onChange={(e) => { setCronInput(e.target.value); setInputError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder="0 9 * * *"
            spellCheck={false}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 font-mono text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
            aria-label="Cron expression"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !cronInput.trim()}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              savedFlash
                ? "border-emerald-600 bg-emerald-600/10 text-emerald-400"
                : saving || !cronInput.trim()
                ? "border-neutral-700 bg-neutral-900 text-neutral-600 cursor-default"
                : "border-blue-600 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20"
            }`}
          >
            {savedFlash ? "✓ Saved" : saving ? "…" : "Save"}
          </button>
        </div>
        {inputError && (
          <p className="mt-1 text-xs text-red-400">{inputError}</p>
        )}
        <p className="mt-1.5 text-xs text-neutral-600">
          Fields: minute · hour · day · month · weekday
        </p>

        {/* Quick presets */}
        <div className="mt-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => { setCronInput(p.cron); setInputError(null); }}
              className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-300"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current schedule status */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Current schedule
        </p>
        {loading ? (
          <p className="text-xs text-neutral-600">Loading…</p>
        ) : !schedule ? (
          <p className="text-xs text-neutral-600">No schedule set.</p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-neutral-300">{schedule.cron}</p>
              <p className="mt-0.5 text-[10px] text-neutral-600">
                Updated {formatRelative(schedule.updatedAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className={`text-[10px] font-semibold ${schedule.enabled ? "text-emerald-400" : "text-neutral-600"}`}>
                {schedule.enabled ? "Active" : "Paused"}
              </span>
              <button
                type="button"
                onClick={handleToggleEnabled}
                disabled={saving}
                className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-300 disabled:cursor-default"
              >
                {schedule.enabled ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={saving}
                title="Remove schedule"
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-600 transition-colors hover:border-red-800 hover:text-red-400 disabled:cursor-default"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-neutral-700">
          Stored schedule executes when a scheduler process is running.
        </p>
      </div>
    </div>
  );
}
