"use client";

import { useState, useCallback, useEffect } from "react";
import type { WorkflowGraph } from "@iterastudio/shared";

// ── Props ──

export interface SaveRevisionDialogProps {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  /** Returns the current WorkflowGraph from the store */
  getGraph: () => WorkflowGraph;
  /** Called after a successful save */
  onSaved?: () => void;
}

// ── Component ──

export function SaveRevisionDialog({
  open,
  onClose,
  workflowId,
  getGraph,
  onSaved,
}: SaveRevisionDialogProps) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setSaving(false);
      setSaved(false);
      setError(null);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const graph = getGraph();
      const res = await fetch(`/api/workflows/${workflowId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          graph,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message || "Failed to save revision");
        return;
      }

      setSaved(true);
      onSaved?.();
      setTimeout(() => { onClose(); }, 1200);
    } catch {
      setError("Connection error — please try again");
    } finally {
      setSaving(false);
    }
  }, [label, workflowId, getGraph, onClose, onSaved]);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="mx-4 w-full max-w-sm overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Save Revision Checkpoint
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            <XIcon />
          </button>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">
              Label
              <span className="ml-1 text-neutral-600">(optional — auto-generated if blank)</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Before adding clip scoring"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {saved && <p className="text-xs text-emerald-400">✓ Revision saved</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || saved}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              saved
                ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-400"
                : saving
                ? "border-neutral-700 bg-neutral-800 text-neutral-600 cursor-default"
                : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
            }`}
          >
            {saved ? "Saved!" : saving ? "Saving…" : "Save Checkpoint"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Icons ──

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}
