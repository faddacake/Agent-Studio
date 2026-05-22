"use client";

import { useState, useCallback, useEffect } from "react";
import type { WorkflowGraph } from "@iterastudio/shared";

// ── Props ──

export interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Returns the current WorkflowGraph from the store */
  getGraph: () => WorkflowGraph;
  /** Default name pre-filled from workflow meta */
  defaultName?: string;
  /** Called after a successful DB save so callers can refresh template lists */
  onSaved?: () => void;
}

// ── Component ──

export function SaveAsTemplateDialog({
  open,
  onClose,
  getGraph,
  defaultName = "",
  onSaved,
}: SaveAsTemplateDialogProps) {
  const [name, setName] = useState(defaultName || "My Template");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setName(defaultName || "My Template");
      setDescription("");
      setTagsInput("");
      setSaving(false);
      setSaved(false);
      setError(null);
    }
  }, [open, defaultName]);

  const handleSave = useCallback(async () => {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Template name is required");
      return;
    }

    const graph = getGraph();
    if (graph.nodes.length === 0) {
      setError("Cannot save an empty workflow as a template");
      return;
    }

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
          graph,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message || "Failed to save template");
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
  }, [name, description, tagsInput, getGraph, onClose]);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="mx-4 w-full max-w-md overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">
            Save as Template
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
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">
              Name <span className="text-red-400">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Pipeline"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !saving) handleSave(); }}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              rows={2}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none resize-none"
            />
          </label>

          {/* Tags */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">
              Tags
              <span className="ml-1 text-neutral-600">(comma-separated)</span>
            </span>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="image, social, video"
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Success */}
          {saved && (
            <p className="text-xs text-emerald-400">✓ Template saved</p>
          )}
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
            disabled={saving || saved || !name.trim()}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              saved
                ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-400"
                : saving || !name.trim()
                ? "border-neutral-700 bg-neutral-800 text-neutral-600 cursor-default"
                : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
            }`}
          >
            {saved ? "Saved!" : saving ? "Saving…" : "Save Template"}
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
