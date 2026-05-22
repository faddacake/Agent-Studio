"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkflowGraph } from "@iterastudio/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FragmentRow {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  graph: WorkflowGraph;
}

interface RevisionRow {
  id: string;
  workflowId: string;
  label: string | null;
  createdAt: string;
  graphStats: { nodeCount: number; edgeCount: number; nodeIds: string[] };
}

interface RunRow {
  id: string;
  status: string;
  totalCost: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  graphStats: { nodeCount: number; edgeCount: number };
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  graph: WorkflowGraph;
}

interface PresetRow {
  id: string;
  name: string;
  nodeType: string;
  createdAt: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLOR: Record<string, string> = {
  completed: "#4ade80",
  failed: "#f87171",
  partial_failure: "#f87171",
  cancelled: "#737373",
  budget_exceeded: "#facc15",
  running: "#60a5fa",
  pending: "#a3a3a3",
};

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
  empty,
  loading,
}: {
  title: string;
  children?: React.ReactNode;
  empty?: string;
  loading?: boolean;
}) {
  return (
    <section className="border-b border-neutral-800 pb-8 last:border-0">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        {title}
      </h2>
      {loading ? (
        <p className="text-xs text-neutral-600">Loading…</p>
      ) : empty ? (
        <p className="text-xs text-neutral-600">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  // ── Fragments ──────────────────────────────────────────────────────────────
  const [fragments, setFragments] = useState<FragmentRow[]>([]);
  const [fragmentsLoading, setFragmentsLoading] = useState(true);
  const [fragRenamingId, setFragRenamingId] = useState<string | null>(null);
  const [fragRenameValue, setFragRenameValue] = useState("");
  const [fragSavingId, setFragSavingId] = useState<string | null>(null);
  const [fragConfirmingDeleteId, setFragConfirmingDeleteId] = useState<string | null>(null);
  const [fragDeletingId, setFragDeletingId] = useState<string | null>(null);
  const fragRenameInputRef = useRef<HTMLInputElement>(null);

  // ── Revisions ──────────────────────────────────────────────────────────────
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ── Runs ───────────────────────────────────────────────────────────────────
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);

  // ── Templates ──────────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // ── Presets ────────────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetRenamingId, setPresetRenamingId] = useState<string | null>(null);
  const [presetRenameValue, setPresetRenameValue] = useState("");
  const [presetSavingId, setPresetSavingId] = useState<string | null>(null);
  const [presetConfirmingDeleteId, setPresetConfirmingDeleteId] = useState<string | null>(null);
  const [presetDeletingId, setPresetDeletingId] = useState<string | null>(null);
  const presetRenameInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch all data in parallel ─────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/fragments")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFragments)
      .catch(() => setFragments([]))
      .finally(() => setFragmentsLoading(false));

    fetch(`/api/workflows/${id}/revisions`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRevisions)
      .catch(() => setRevisions([]))
      .finally(() => setRevisionsLoading(false));

    fetch(`/api/workflows/${id}/runs`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));

    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false));

    fetch("/api/node-presets")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPresets)
      .catch(() => setPresets([]))
      .finally(() => setPresetsLoading(false));
  }, [id]);

  // ── Restore revision ───────────────────────────────────────────────────────
  const handleRestore = useCallback(
    async (revId: string) => {
      setRestoringId(revId);
      setRestoreError(null);
      try {
        const res = await fetch(`/api/workflows/${id}/revisions/${revId}/restore`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        router.push(`/workflows/${id}`);
      } catch {
        setRestoreError("Failed to restore checkpoint.");
      } finally {
        setRestoringId(null);
      }
    },
    [id, router],
  );

  // ── Fragment rename ────────────────────────────────────────────────────────
  useEffect(() => {
    if (fragRenamingId) fragRenameInputRef.current?.focus();
  }, [fragRenamingId]);

  const handleFragRenameStart = useCallback((frag: FragmentRow) => {
    setFragConfirmingDeleteId(null);
    setFragRenamingId(frag.id);
    setFragRenameValue(frag.name);
  }, []);

  const handleFragRenameCommit = useCallback(async (fragId: string) => {
    const trimmed = fragRenameValue.trim();
    if (!trimmed) { setFragRenamingId(null); return; }
    setFragSavingId(fragId);
    try {
      const res = await fetch(`/api/fragments/${fragId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFragments((prev) => prev.map((f) => (f.id === fragId ? { ...f, name: trimmed } : f)));
      setFragRenamingId(null);
    } finally {
      setFragSavingId(null);
    }
  }, [fragRenameValue]);

  const handleFragDeleteConfirm = useCallback(async (fragId: string) => {
    setFragDeletingId(fragId);
    setFragConfirmingDeleteId(null);
    try {
      const res = await fetch(`/api/fragments/${fragId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFragments((prev) => prev.filter((f) => f.id !== fragId));
    } finally {
      setFragDeletingId(null);
    }
  }, []);

  // ── Preset rename + delete ─────────────────────────────────────────────────
  useEffect(() => {
    if (presetRenamingId) presetRenameInputRef.current?.focus();
  }, [presetRenamingId]);

  const handlePresetRenameStart = useCallback((preset: PresetRow) => {
    setPresetConfirmingDeleteId(null);
    setPresetRenamingId(preset.id);
    setPresetRenameValue(preset.name);
  }, []);

  const handlePresetRenameCommit = useCallback(async (presetId: string) => {
    const trimmed = presetRenameValue.trim();
    if (!trimmed) { setPresetRenamingId(null); return; }
    setPresetSavingId(presetId);
    try {
      const res = await fetch(`/api/node-presets/${presetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPresets((prev) => prev.map((p) => (p.id === presetId ? { ...p, name: trimmed } : p)));
      setPresetRenamingId(null);
    } finally {
      setPresetSavingId(null);
    }
  }, [presetRenameValue]);

  const handlePresetDeleteConfirm = useCallback(async (presetId: string) => {
    setPresetDeletingId(presetId);
    setPresetConfirmingDeleteId(null);
    try {
      const res = await fetch(`/api/node-presets/${presetId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
    } finally {
      setPresetDeletingId(null);
    }
  }, []);

  // ── Completed runs (with artifacts potential) ─────────────────────────────
  const completedRuns = runs.filter((r) => r.status === "completed");

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-200">
      {/* Breadcrumb */}
      <div className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950 px-6 py-3">
        <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Link href="/workflows" className="transition-colors hover:text-neutral-300">
            ← Workflows
          </Link>
          <span>·</span>
          <Link
            href={`/workflows/${id}`}
            className="transition-colors hover:text-neutral-300"
          >
            Editor
          </Link>
          <span>·</span>
          <span className="text-neutral-300">Library</span>
        </nav>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
        {/* ── Fragments ──────────────────────────────────────────────────── */}
        <Section
          title="Fragments"
          loading={fragmentsLoading}
          empty={
            fragments.length === 0
              ? 'No fragments saved yet. Select nodes on the canvas and click "Save as Fragment".'
              : undefined
          }
        >
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
            {fragments.map((frag) => {
              const isRenaming = fragRenamingId === frag.id;
              const isConfirmingDelete = fragConfirmingDeleteId === frag.id;
              const isDeleting = fragDeletingId === frag.id;
              const isSaving = fragSavingId === frag.id;
              const busy = isSaving || isDeleting;

              return (
                <div
                  key={frag.id}
                  className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 last:border-0"
                >
                  {/* Name / rename input */}
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        ref={fragRenameInputRef}
                        value={fragRenameValue}
                        onChange={(e) => setFragRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleFragRenameCommit(frag.id);
                          if (e.key === "Escape") setFragRenamingId(null);
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
                          onClick={() => void handleFragRenameCommit(frag.id)}
                          disabled={isSaving || !fragRenameValue.trim()}
                          className="text-xs text-neutral-300 transition-colors hover:text-neutral-100 disabled:cursor-default disabled:text-neutral-600"
                        >
                          {isSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setFragRenamingId(null)}
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
                          onClick={() => void handleFragDeleteConfirm(frag.id)}
                          className="text-xs text-red-400 transition-colors hover:text-red-300"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setFragConfirmingDeleteId(null)}
                          className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
                        >
                          No
                        </button>
                      </>
                    ) : isDeleting ? (
                      <span className="text-[11px] text-neutral-600">Deleting…</span>
                    ) : (
                      <>
                        <Link
                          href={`/workflows/${id}?insertFragment=${frag.id}`}
                          className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                        >
                          Insert
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleFragRenameStart(frag)}
                          disabled={busy}
                          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300 disabled:cursor-default disabled:opacity-40"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFragRenamingId(null);
                            setFragConfirmingDeleteId(frag.id);
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
        </Section>

        {/* ── Revision Checkpoints ───────────────────────────────────────── */}
        <Section
          title="Revision Checkpoints"
          loading={revisionsLoading}
          empty={
            revisions.length === 0
              ? 'No checkpoints saved yet. Click "Save Revision" in the editor to create one.'
              : undefined
          }
        >
          {restoreError && (
            <p className="mb-2 text-xs text-red-400">{restoreError}</p>
          )}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
            {revisions.map((rev) => (
              <div
                key={rev.id}
                className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-200">
                    {rev.label ?? "Unnamed checkpoint"}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {rev.graphStats.nodeCount} nodes · {rev.graphStats.edgeCount} edges ·{" "}
                    {relativeTime(rev.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(rev.id)}
                  disabled={restoringId === rev.id}
                  className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100 disabled:cursor-default disabled:text-neutral-600"
                >
                  {restoringId === rev.id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Artifacts (completed runs) ─────────────────────────────────── */}
        <Section
          title="Artifacts"
          loading={runsLoading}
          empty={
            completedRuns.length === 0
              ? "No completed runs yet. Run the workflow to generate artifacts."
              : undefined
          }
        >
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
            {completedRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-neutral-300">
                    {run.id.slice(0, 8)}…
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    <span
                      className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ backgroundColor: STATUS_COLOR[run.status] ?? "#737373" }}
                    />
                    {run.graphStats.nodeCount} nodes
                    {run.totalCost != null
                      ? ` · $${run.totalCost.toFixed(4)}`
                      : ""}
                    {" · "}
                    {relativeTime(run.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/workflows/${id}/history/${run.id}`}
                  className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                >
                  View Artifacts
                </Link>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Presets ───────────────────────────────────────────────────── */}
        <Section
          title="Presets"
          loading={presetsLoading}
          empty={
            presets.length === 0
              ? 'No presets saved yet. Use "Save as Preset" in the node inspector to create one.'
              : undefined
          }
        >
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
            {presets.map((preset) => {
              const isRenaming = presetRenamingId === preset.id;
              const isConfirmingDelete = presetConfirmingDeleteId === preset.id;
              const isDeleting = presetDeletingId === preset.id;
              const isSaving = presetSavingId === preset.id;
              const busy = isSaving || isDeleting;

              return (
                <div
                  key={preset.id}
                  className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 last:border-0"
                >
                  {/* Name / rename input */}
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        ref={presetRenameInputRef}
                        value={presetRenameValue}
                        onChange={(e) => setPresetRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handlePresetRenameCommit(preset.id);
                          if (e.key === "Escape") setPresetRenamingId(null);
                        }}
                        disabled={isSaving}
                        className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 outline-none focus:border-neutral-400 disabled:opacity-50"
                      />
                    ) : (
                      <>
                        <p className="truncate text-xs font-medium text-neutral-200">{preset.name}</p>
                        <p className="text-[11px] text-neutral-500">
                          <code className="rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">
                            {preset.nodeType}
                          </code>
                          {preset.createdAt && (
                            <> · {relativeTime(preset.createdAt)}</>
                          )}
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
                          onClick={() => void handlePresetRenameCommit(preset.id)}
                          disabled={isSaving || !presetRenameValue.trim()}
                          className="text-xs text-neutral-300 transition-colors hover:text-neutral-100 disabled:cursor-default disabled:text-neutral-600"
                        >
                          {isSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetRenamingId(null)}
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
                          onClick={() => void handlePresetDeleteConfirm(preset.id)}
                          className="text-xs text-red-400 transition-colors hover:text-red-300"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetConfirmingDeleteId(null)}
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
                          onClick={() => handlePresetRenameStart(preset)}
                          disabled={busy}
                          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300 disabled:cursor-default disabled:opacity-40"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPresetRenamingId(null);
                            setPresetConfirmingDeleteId(preset.id);
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
        </Section>

        {/* ── Templates ─────────────────────────────────────────────────── */}
        <Section
          title="Templates"
          loading={templatesLoading}
          empty={
            templates.length === 0
              ? 'No templates saved yet. Click "Save as Template" in the editor to create one.'
              : undefined
          }
        >
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-200">{tmpl.name}</p>
                  {tmpl.description && (
                    <p className="truncate text-[11px] text-neutral-500">{tmpl.description}</p>
                  )}
                  {!tmpl.description && (
                    <p className="text-[11px] text-neutral-500">{relativeTime(tmpl.createdAt)}</p>
                  )}
                </div>
                <Link
                  href={`/workflows/${tmpl.id}`}
                  className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
