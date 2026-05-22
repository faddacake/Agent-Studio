"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkflowGraph } from "@iterastudio/shared";

export interface FragmentRow {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  graph: WorkflowGraph;
}

export interface FragmentBrowserProps {
  open: boolean;
  onClose: () => void;
  onInsert: (graph: WorkflowGraph) => void;
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function FragmentBrowser({ open, onClose, onInsert }: FragmentBrowserProps) {
  const [fragments, setFragments] = useState<FragmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // per-row mutation state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // keyboard navigation
  const [focusedIdx, setFocusedIdx] = useState(0);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch + reset state on open/close
  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setConfirmingDeleteId(null);
      setFocusedIdx(0);
      return;
    }
    setLoading(true);
    setError(null);
    fetch("/api/fragments")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: FragmentRow[]) => {
        setFragments(data);
        setFocusedIdx(0);
      })
      .catch(() => setError("Failed to load fragments"))
      .finally(() => setLoading(false));
  }, [open]);

  // Focus the active row element when focusedIdx changes (keyboard nav only)
  useEffect(() => {
    if (!open || renamingId !== null) return;
    const el = rowRefs.current[focusedIdx];
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIdx, open, renamingId]);

  // Clamp focusedIdx when list shrinks (e.g. after delete)
  useEffect(() => {
    if (fragments.length > 0) {
      setFocusedIdx((i) => Math.min(i, fragments.length - 1));
    }
  }, [fragments.length]);

  // Focus the rename input when rename mode activates
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  function startRename(frag: FragmentRow) {
    setConfirmingDeleteId(null);
    setRenamingId(frag.id);
    setRenameValue(frag.name);
  }

  async function commitRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    setSavingId(id);
    try {
      const res = await fetch(`/api/fragments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFragments((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
      );
      setRenamingId(null);
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete(id: string) {
    setDeletingId(id);
    setConfirmingDeleteId(null);
    try {
      const res = await fetch(`/api/fragments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFragments((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  // Container keydown — drives all keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // While renaming: only intercept Escape (input handles Enter/other chars itself)
    if (renamingId !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        setRenamingId(null);
      }
      return;
    }

    // While confirming delete: only intercept Escape
    if (confirmingDeleteId !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmingDeleteId(null);
      }
      return;
    }

    const frag = fragments[focusedIdx] ?? null;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, fragments.length - 1));
        break;

      case "ArrowUp":
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
        break;

      case "Enter":
        // Let native button/input Enter pass through unmodified
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) break;
        if (frag && !isBusy(frag.id)) {
          e.preventDefault();
          onInsert(frag.graph);
          onClose();
        }
        break;

      case "r":
        // Skip if an input has focus (would type 'r')
        if (e.target instanceof HTMLInputElement) break;
        if (frag && !isBusy(frag.id)) {
          e.preventDefault();
          startRename(frag);
        }
        break;

      case "Delete":
      case "Backspace":
        // Skip if an input has focus (would delete characters)
        if (e.target instanceof HTMLInputElement) break;
        if (frag && !isBusy(frag.id)) {
          e.preventDefault();
          setRenamingId(null);
          setConfirmingDeleteId(frag.id);
        }
        break;

      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  if (!open) return null;

  const isBusy = (id: string) => savingId === id || deletingId === id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">Fragment Browser</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          >
            ✕
          </button>
        </div>

        {/* Keyboard hint */}
        {!loading && fragments.length > 0 && (
          <div className="border-b border-neutral-800 px-5 py-1.5 flex gap-3">
            {(["↑↓ navigate", "Enter insert", "r rename", "Del delete", "Esc close"] as const).map((hint) => (
              <span key={hint} className="text-[10px] text-neutral-600">{hint}</span>
            ))}
          </div>
        )}

        {/* Body */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="max-h-[60vh] overflow-y-auto outline-none"
          onKeyDown={handleKeyDown}
        >
          {loading && (
            <p className="px-5 py-6 text-xs text-neutral-500">Loading fragments…</p>
          )}
          {error && <p className="px-5 py-6 text-xs text-red-400">{error}</p>}
          {!loading && !error && fragments.length === 0 && (
            <p className="px-5 py-6 text-xs text-neutral-500">
              No fragments saved yet. Select nodes on the canvas and click &ldquo;Save as Fragment&rdquo;.
            </p>
          )}
          {!loading &&
            fragments.map((frag, idx) => {
              const isRenaming = renamingId === frag.id;
              const isConfirmingDelete = confirmingDeleteId === frag.id;
              const isDeleting = deletingId === frag.id;
              const isSaving = savingId === frag.id;
              const busy = isBusy(frag.id);
              const isFocused = focusedIdx === idx && renamingId === null;

              return (
                <div
                  key={frag.id}
                  ref={(el) => { rowRefs.current[idx] = el; }}
                  tabIndex={0}
                  onFocus={() => setFocusedIdx(idx)}
                  className={[
                    "flex items-center gap-3 border-b border-neutral-800 px-5 py-3 last:border-0 outline-none transition-colors",
                    isFocused
                      ? "bg-neutral-800/70 ring-1 ring-inset ring-neutral-700"
                      : "hover:bg-neutral-800/40",
                  ].join(" ")}
                >
                  {/* Name / rename input */}
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(frag.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        disabled={isSaving}
                        className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 outline-none focus:border-neutral-400 disabled:opacity-50"
                      />
                    ) : (
                      <>
                        <p className="truncate text-xs font-medium text-neutral-200">{frag.name}</p>
                        <p className="text-[11px] text-neutral-500">
                          {frag.nodeCount} {frag.nodeCount === 1 ? "node" : "nodes"} ·{" "}
                          {relativeTime(frag.createdAt)}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    {isRenaming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void commitRename(frag.id)}
                          disabled={isSaving || !renameValue.trim()}
                          className="text-xs text-neutral-300 transition-colors hover:text-neutral-100 disabled:cursor-default disabled:text-neutral-600"
                        >
                          {isSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          disabled={isSaving}
                          className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
                        >
                          Cancel
                        </button>
                      </>
                    ) : isConfirmingDelete ? (
                      <>
                        <span className="text-[11px] text-red-400">Delete?</span>
                        <button
                          type="button"
                          onClick={() => void confirmDelete(frag.id)}
                          className="text-xs text-red-400 transition-colors hover:text-red-300"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
                        >
                          No
                        </button>
                      </>
                    ) : isDeleting ? (
                      <span className="text-[11px] text-neutral-600">Deleting…</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onInsert(frag.graph);
                            onClose();
                          }}
                          disabled={busy}
                          className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100 disabled:cursor-default disabled:opacity-50"
                        >
                          Insert
                        </button>
                        <button
                          type="button"
                          onClick={() => startRename(frag)}
                          disabled={busy}
                          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300 disabled:cursor-default disabled:opacity-40"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(null);
                            setConfirmingDeleteId(frag.id);
                          }}
                          disabled={busy}
                          className="text-xs text-neutral-600 transition-colors hover:text-red-400 disabled:cursor-default disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
