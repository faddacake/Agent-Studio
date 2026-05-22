"use client";

import { useEffect, useRef, useState, use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkflowGraph } from "@iterastudio/shared";
import { computeRunDiff } from "@/lib/runDiff";
import { isArtifactRef } from "@iterastudio/shared";
import type { ArtifactRef } from "@iterastudio/shared";
import { extractImageRefs, extractVideoRefs } from "@/lib/artifactRefs";
import { ArtifactPreviewPanel } from "@/components/prompt/ArtifactPreviewPanel";
import type { ArtifactPreviewable } from "@/components/prompt/ArtifactPreviewPanel";

// ── Types ──────────────────────────────────────────────────────────────────

interface RunDetail {
  id: string;
  workflowId: string;
  status: string;
  totalCost: number | null;
  error: string | null;
  budgetCap: number | null;
  budgetMode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface NodeExecutionRow {
  id: string;
  nodeId: string;
  status: string;
  attempt: number | null;
  cost: number | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  providerId: string | null;
  modelId: string | null;
}

interface NodeOutputEntry {
  nodeId: string;
  outputs: Record<string, unknown>;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  completed:       "#4ade80",
  failed:          "#f87171",
  partial_failure: "#f87171",
  cancelled:       "#737373",
  budget_exceeded: "#facc15",
  running:         "#60a5fa",
  pending:         "#a3a3a3",
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  completed:       "#4ade80",
  failed:          "#f87171",
  partial_failure: "#f87171",
  cancelled:       "#737373",
  budget_exceeded: "#facc15",
  running:         "#60a5fa",
  pending:         "#a3a3a3",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function durationLabel(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id: workflowId, runId } = use(params);
  const router = useRouter();

  const [run, setRun] = useState<RunDetail | null>(null);
  const [nodeExecutions, setNodeExecutions] = useState<NodeExecutionRow[]>([]);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string>>({});
  const [outputs, setOutputs] = useState<NodeOutputEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedArtifactIdx, setSelectedArtifactIdx] = useState(0);
  const [bundleState, setBundleState] = useState<"idle" | "downloading" | "error">("idle");
  const [sendingToEditor, setSendingToEditor] = useState(false);
  const [sendAspectRatio, setSendAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [copiedRunId, setCopiedRunId] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareNoPrev, setCompareNoPrev] = useState(false);
  const [compareRun, setCompareRun] = useState<{
    run: RunDetail;
    nodeExecutions: NodeExecutionRow[];
    nodeLabels: Record<string, string>;
    graph: WorkflowGraph | null;
  } | null>(null);
  const [currentRunGraph, setCurrentRunGraph] = useState<WorkflowGraph | null>(null);
  /**
   * null  = all artifact files are selected (initial / "all" state)
   * Set   = explicit set of artifact filesystem paths; empty = nothing selected
   *
   * Keyed by artifact path so multi-output nodes can be cherry-picked at the
   * individual file level rather than at the coarser node level.
   */
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => { setSelectedArtifactIdx(0); setSelectedPaths(null); }, [runId]);

  // Ref keeps the current artifact count readable inside the keyboard effect without re-registering.
  const previewCountRef = useRef(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (previewCountRef.current < 2) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        setSelectedArtifactIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setSelectedArtifactIdx((i) => Math.min(previewCountRef.current - 1, i + 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // Fetch run detail + node executions
    const runFetch = fetch(`/api/workflows/${workflowId}/runs/${runId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<{
          run: RunDetail;
          nodeExecutions: NodeExecutionRow[];
          nodeLabels: Record<string, string>;
        }>;
      })
      .then((data) => {
        setRun(data.run);
        setNodeExecutions(data.nodeExecutions);
        setNodeLabels(data.nodeLabels);
      });

    // Fetch node outputs
    const outputFetch = fetch(`/api/workflows/${workflowId}/runs/${runId}/outputs`)
      .then((r) => (r.ok ? r.json() : { outputs: [] }))
      .then((data: { outputs: NodeOutputEntry[] }) => setOutputs(data.outputs ?? []))
      .catch(() => {});

    Promise.all([runFetch, outputFetch])
      .catch(() => setError("Failed to load run details"))
      .finally(() => setLoading(false));
  }, [workflowId, runId]);

  function isPathSelected(p: string): boolean {
    return selectedPaths === null || selectedPaths.has(p);
  }

  function togglePath(p: string): void {
    setSelectedPaths((prev) => {
      // null → treat as "all selected"; materialise to an explicit Set first
      const allPaths = previewArtifacts.map((a) => a.artifactPath);
      const base = prev ?? new Set(allPaths);
      const next = new Set(base);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/runs`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      router.push(`/workflows/${workflowId}/history`);
    } catch {
      setRerunError("Failed to start run — please try again");
      setRerunning(false);
    }
  }

  async function handleBundleDownload() {
    setBundleState("downloading");
    try {
      // POST carries the optional paths filter; when null the server includes
      // all artifacts (same behaviour as the legacy GET endpoint).
      const paths = selectedPaths !== null ? [...selectedPaths] : undefined;
      const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}/bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `run-${runId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setBundleState("idle");
    } catch {
      setBundleState("error");
    }
  }

  async function handleSendToEditor() {
    if (sendingToEditor) return;
    const effectiveArtifacts =
      selectedPaths === null
        ? previewArtifacts
        : previewArtifacts.filter((a) => selectedPaths.has(a.artifactPath));
    if (effectiveArtifacts.length === 0) return;

    setSendingToEditor(true);
    try {
      const scenes = effectiveArtifacts.map((a) => {
        const isVideo = a.mimeType?.startsWith("video/") ?? false;
        return {
          id: crypto.randomUUID(),
          type: isVideo ? "video" as const : "image" as const,
          src: a.artifactPath,
          duration: isVideo ? 10 : 5,
        };
      });
      const res = await fetch("/api/editor-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Run ${runId.slice(0, 8)}`,
          aspectRatio: sendAspectRatio,
          scenes,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const project = (await res.json()) as { id: string };
      router.push(`/editor/${project.id}`);
    } catch {
      setSendingToEditor(false);
    }
  }

  async function handleCompare() {
    if (compareLoading) return;
    // Toggle off if already open
    if (compareOpen) { setCompareOpen(false); return; }
    // If we already loaded it, just toggle open
    if (compareRun) { setCompareOpen(true); return; }
    setCompareLoading(true);
    try {
      const listRes = await fetch(`/api/workflows/${workflowId}/runs`);
      if (!listRes.ok) throw new Error(`${listRes.status}`);
      const list: Array<{ id: string; createdAt: string }> = await listRes.json();
      const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const currentIdx = sorted.findIndex((r) => r.id === runId);
      if (currentIdx <= 0) {
        // No previous run — show brief label so the button gives feedback.
        setCompareNoPrev(true);
        setTimeout(() => setCompareNoPrev(false), 2000);
        return;
      }
      const prevId = sorted[currentIdx - 1].id;

      // Fetch prev run detail + both graph snapshots in parallel
      const [detailRes, currGraphRes, prevGraphRes] = await Promise.all([
        fetch(`/api/workflows/${workflowId}/runs/${prevId}`),
        fetch(`/api/workflows/${workflowId}/runs/${runId}/graph`),
        fetch(`/api/workflows/${workflowId}/runs/${prevId}/graph`),
      ]);
      if (!detailRes.ok) throw new Error(`${detailRes.status}`);
      const data = await detailRes.json() as {
        run: RunDetail;
        nodeExecutions: NodeExecutionRow[];
        nodeLabels: Record<string, string>;
      };
      const currGraph: WorkflowGraph | null = currGraphRes.ok ? await currGraphRes.json() : null;
      const prevGraph: WorkflowGraph | null = prevGraphRes.ok ? await prevGraphRes.json() : null;

      setCurrentRunGraph(currGraph);
      setCompareRun({ ...data, graph: prevGraph });
      setCompareOpen(true);
    } catch {
      // non-fatal
    } finally {
      setCompareLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "28px 32px" }}>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div style={{ padding: "28px 32px" }}>
        <p style={{ fontSize: 13, color: "var(--color-error)" }}>{error ?? "Run not found"}</p>
      </div>
    );
  }

  const outputMap = new Map<string, Record<string, unknown>>(
    outputs.map((o) => [o.nodeId, o.outputs]),
  );

  // One entry per artifact file — covers both image and video outputs.
  // Multi-output nodes produce multiple entries.
  // artifactPath is the raw filesystem path used as the selection key.
  type PreviewArtifact = ArtifactPreviewable & { artifactPath: string; nodeId: string; nodeLabel: string };
  const previewArtifacts: PreviewArtifact[] = nodeExecutions.flatMap((ne) => {
    if (ne.status !== "completed") return [];
    const nodeOutputs = outputMap.get(ne.nodeId);
    if (!nodeOutputs) return [];
    const vals = Object.values(nodeOutputs);
    const imageRefs = vals.flatMap((v) => extractImageRefs(v));
    const videoRefs = vals.flatMap((v) => extractVideoRefs(v));
    const allRefs = [...imageRefs, ...videoRefs];
    if (allRefs.length === 0) return [];
    const nodeLabel = nodeLabels[ne.nodeId] ?? ne.nodeId;
    const durationMs =
      ne.startedAt && ne.completedAt
        ? new Date(ne.completedAt).getTime() - new Date(ne.startedAt).getTime()
        : undefined;
    return allRefs.map((ref, i) => ({
      // ArtifactPreviewable contract
      modelId: `${ne.nodeId}:${i}`,
      modelName: allRefs.length > 1 ? `${nodeLabel} #${i + 1}` : nodeLabel,
      outputUrl: `/api/artifacts?path=${encodeURIComponent(ref.path)}`,
      filename: ref.filename,
      mimeType: ref.mimeType,
      // Attribute cost/duration only to the first artifact so we don't double-count
      cost: i === 0 ? (ne.cost ?? undefined) : undefined,
      durationMs: i === 0 ? durationMs : undefined,
      sizeBytes: ref.sizeBytes,
      // File-level selection key
      artifactPath: ref.path,
      // Grouping metadata
      nodeId: ne.nodeId,
      nodeLabel,
    }));
  });
  previewCountRef.current = previewArtifacts.length;
  const previewArtifact = previewArtifacts[selectedArtifactIdx] ?? previewArtifacts[0] ?? null;

  // Group artifacts by node — preserves order from nodeExecutions
  type ArtifactGroup = { nodeId: string; nodeLabel: string; artifacts: PreviewArtifact[] };
  const artifactGroups: ArtifactGroup[] = [];
  for (const a of previewArtifacts) {
    const last = artifactGroups[artifactGroups.length - 1];
    if (last && last.nodeId === a.nodeId) {
      last.artifacts.push(a);
    } else {
      artifactGroups.push({ nodeId: a.nodeId, nodeLabel: a.nodeLabel, artifacts: [a] });
    }
  }
  const showGroupHeaders = artifactGroups.length > 1;

  // ── Per-group selection helpers ────────────────────────────────────────────

  function groupSelectedCount(group: ArtifactGroup): number {
    if (selectedPaths === null) return group.artifacts.length;
    return group.artifacts.filter((a) => selectedPaths.has(a.artifactPath)).length;
  }

  function selectGroupAll(group: ArtifactGroup): void {
    setSelectedPaths((prev) => {
      if (prev === null) return null; // already globally all-selected
      const next = new Set(prev);
      for (const a of group.artifacts) next.add(a.artifactPath);
      return next;
    });
  }

  function clearGroup(group: ArtifactGroup): void {
    setSelectedPaths((prev) => {
      const allPaths = previewArtifacts.map((a) => a.artifactPath);
      const base = prev ?? new Set(allPaths);
      const next = new Set(base);
      for (const a of group.artifacts) next.delete(a.artifactPath);
      return next;
    });
  }

  const selectedCount =
    selectedPaths === null ? previewArtifacts.length : selectedPaths.size;
  const noArtifactsSelected =
    previewArtifacts.length > 0 && selectedPaths !== null && selectedPaths.size === 0;

  const statusDot = STATUS_COLOR[run.status] ?? "#737373";
  const statusColor = STATUS_TEXT_COLOR[run.status] ?? "var(--color-text-muted)";

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860 }}>
      {/* ── Breadcrumb ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        <Link href="/workflows" style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "none" }}>
          ← Workflows
        </Link>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <Link href={`/workflows/${workflowId}`} style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "none" }}>
          Editor
        </Link>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <Link href={`/workflows/${workflowId}/history`} style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "none" }}>
          Run History
        </Link>
        <span style={{ color: "var(--color-border)" }}>·</span>
        <code style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{runId.slice(0, 8)}</code>
      </div>

      {/* ── Run header ── */}
      <div style={{
        padding: "18px 20px",
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        marginBottom: 24,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{
            display: "inline-block", width: 10, height: 10,
            borderRadius: "50%", backgroundColor: statusDot, flexShrink: 0,
          }} />
          <span style={{ fontSize: 18, fontWeight: 700, color: statusColor, textTransform: "capitalize" }}>
            {statusLabel(run.status)}
          </span>
          <code style={{ fontSize: 12, color: "var(--color-text-muted)", marginLeft: 4 }}>
            {run.id}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(run.id).then(() => {
                setCopiedRunId(true);
                setTimeout(() => setCopiedRunId(false), 1500);
              }).catch(() => {});
            }}
            title={copiedRunId ? "Copied run ID" : "Copy run ID"}
            aria-label={copiedRunId ? "Copied run ID" : "Copy run ID"}
            style={{
              fontSize: 11,
              background: "none",
              border: "none",
              padding: "0 4px",
              color: copiedRunId ? "#4ade80" : "var(--color-text-muted)",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            {copiedRunId ? "copied" : "copy"}
          </button>
        </div>

        {(run.status === "failed" || run.status === "partial_failure") && run.error && (
          <div
            title={run.error}
            style={{
              marginBottom: 12,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(239,68,68,0.25)",
              background: "rgba(127,29,29,0.25)",
              fontSize: 12,
              color: "#fca5a5",
              lineHeight: 1.5,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {run.error}
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "8px 24px",
        }}>
          <MetaField label="Created" value={new Date(run.createdAt).toLocaleString()} />
          {run.startedAt && <MetaField label="Started" value={new Date(run.startedAt).toLocaleString()} />}
          {run.completedAt && <MetaField label="Completed" value={new Date(run.completedAt).toLocaleString()} />}
          <MetaField label="Duration" value={durationLabel(run.startedAt, run.completedAt)} />
          {run.totalCost != null && run.totalCost > 0 && (
            <MetaField label="Total cost" value={`$${run.totalCost.toFixed(4)}`} />
          )}
          {run.budgetCap != null && (
            <MetaField label="Budget" value={`$${run.budgetCap.toFixed(2)} (${run.budgetMode ?? "hard_stop"})`} />
          )}
        </div>

        {/* Run actions — shown for completed/partial runs */}
        {(run.status === "completed" || run.status === "partial_failure") && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => router.push(`/workflows/${workflowId}?replay=${runId}`)}
              title="Load this run's graph into the canvas editor — then edit or run as new"
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--color-accent, #3b82f6)",
                backgroundColor: "transparent",
                color: "var(--color-accent, #3b82f6)",
                cursor: "pointer",
              }}
            >
              Open in Editor
            </button>
            <button
              type="button"
              onClick={handleRerun}
              disabled={rerunning}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                backgroundColor: "transparent",
                color: rerunning ? "var(--color-text-muted)" : "var(--color-text-secondary)",
                cursor: rerunning ? "default" : "pointer",
              }}
            >
              {rerunning ? "Starting…" : "Run Again"}
            </button>
            <button
              type="button"
              onClick={handleBundleDownload}
              disabled={bundleState === "downloading" || noArtifactsSelected}
              title={noArtifactsSelected ? "Select at least one artifact to export" : undefined}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 6,
                border: `1px solid ${bundleState === "error" ? "var(--color-error)" : "var(--color-border)"}`,
                backgroundColor: "transparent",
                color: bundleState === "downloading" || noArtifactsSelected
                  ? "var(--color-text-muted)"
                  : bundleState === "error"
                  ? "var(--color-error)"
                  : "var(--color-text-secondary)",
                cursor: bundleState === "downloading" || noArtifactsSelected ? "default" : "pointer",
              }}
            >
              {bundleState === "downloading"
                ? "Exporting…"
                : bundleState === "error"
                ? "Export failed — Retry"
                : previewArtifacts.length > 1 && selectedPaths !== null
                ? `Export Bundle (${selectedCount})`
                : "Export Bundle"}
            </button>
            <button
              type="button"
              onClick={handleCompare}
              disabled={compareLoading}
              title={compareNoPrev ? "This is the first run — no previous run to compare" : "Compare this run with the previous run"}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 6,
                border: `1px solid ${compareOpen ? "#a78bfa" : compareNoPrev ? "var(--color-border)" : "var(--color-border)"}`,
                backgroundColor: compareOpen ? "rgba(167,139,250,0.08)" : "transparent",
                color: compareLoading ? "var(--color-text-muted)" : compareNoPrev ? "var(--color-text-muted)" : compareOpen ? "#a78bfa" : "var(--color-text-secondary)",
                cursor: compareLoading ? "default" : "pointer",
              }}
            >
              {compareLoading ? "Loading…" : compareOpen ? "Hide Comparison" : compareNoPrev ? "No prev run" : "Compare ↑ Prev"}
            </button>

            {previewArtifacts.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <select
                  value={sendAspectRatio}
                  onChange={(e) => setSendAspectRatio(e.target.value as "16:9" | "9:16" | "1:1")}
                  disabled={sendingToEditor}
                  title="Aspect ratio for the new Video Editor project"
                  style={{
                    fontSize: 11,
                    padding: "4px 6px",
                    background: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 5,
                    color: "var(--color-text-muted)",
                    cursor: sendingToEditor ? "default" : "pointer",
                    outline: "none",
                  }}
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
                <button
                  type="button"
                  onClick={handleSendToEditor}
                  disabled={sendingToEditor || noArtifactsSelected}
                  title={noArtifactsSelected ? "Select at least one artifact to send" : "Create a new Video Editor project from selected artifacts"}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                    backgroundColor: "transparent",
                    color: sendingToEditor || noArtifactsSelected
                      ? "var(--color-text-muted)"
                      : "var(--color-text-secondary)",
                    cursor: sendingToEditor || noArtifactsSelected ? "default" : "pointer",
                  }}
                >
                  {sendingToEditor ? "Sending…" : "Send to Video Editor"}
                </button>
              </div>
            )}

            {bundleState === "error" && (
              <span style={{ fontSize: 11, color: "var(--color-error)" }}>
                Could not download bundle
              </span>
            )}
            {noArtifactsSelected && (
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                Select at least one artifact above
              </span>
            )}
            {rerunError && (
              <span style={{ fontSize: 11, color: "var(--color-error)" }}>
                {rerunError}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Compare panel ── */}
      {compareOpen && compareRun && (
        <RunComparePanel
          current={run}
          currentNodes={nodeExecutions}
          currentLabels={nodeLabels}
          currentGraph={currentRunGraph}
          prev={compareRun.run}
          prevNodes={compareRun.nodeExecutions}
          prevLabels={compareRun.nodeLabels}
          prevGraph={compareRun.graph}
        />
      )}

      {/* ── Artifact preview ── */}
      {previewArtifacts.length > 0 && (
        <>
          {previewArtifacts.length > 1 && (
            <>
              {/* Selection controls — only shown when there are multiple artifacts */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span
                  aria-live="polite"
                  aria-atomic="true"
                  style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                >
                  {selectedCount} of {previewArtifacts.length} selected for export
                </span>
                <button
                  type="button"
                  aria-label="Select all artifacts"
                  onClick={() => setSelectedPaths(null)}
                  style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                >
                  All
                </button>
                <button
                  type="button"
                  aria-label="Deselect all artifacts"
                  onClick={() => setSelectedPaths(new Set())}
                  style={{ fontSize: 11, color: "var(--color-text-muted)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                >
                  None
                </button>
              </div>

              <div role="group" aria-label="Artifact outputs" aria-keyshortcuts="ArrowLeft ArrowRight" style={{ marginBottom: 10 }}>
                {artifactGroups.map((group) => (
                  <div key={group.nodeId}>
                    {showGroupHeaders && (
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        marginTop: 8,
                      }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--color-text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}>
                          {group.nodeLabel}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                          {groupSelectedCount(group)}/{group.artifacts.length}
                        </span>
                        <div style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
                        <button
                          type="button"
                          aria-label={`Select all from ${group.nodeLabel}`}
                          onClick={() => selectGroupAll(group)}
                          disabled={groupSelectedCount(group) === group.artifacts.length}
                          style={{
                            fontSize: 10,
                            color: "var(--color-accent)",
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: groupSelectedCount(group) === group.artifacts.length ? "default" : "pointer",
                            opacity: groupSelectedCount(group) === group.artifacts.length ? 0.35 : 1,
                          }}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          aria-label={`Clear ${group.nodeLabel} selection`}
                          onClick={() => clearGroup(group)}
                          disabled={groupSelectedCount(group) === 0}
                          style={{
                            fontSize: 10,
                            color: "var(--color-text-muted)",
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: groupSelectedCount(group) === 0 ? "default" : "pointer",
                            opacity: groupSelectedCount(group) === 0 ? 0.35 : 1,
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {group.artifacts.map((a) => {
                        const idx = previewArtifacts.indexOf(a);
                        return (
                          <div key={a.modelId} style={{ position: "relative" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedArtifactIdx(idx)}
                              title={a.modelName}
                              aria-label={`Preview artifact from ${a.modelName} (${idx + 1} of ${previewArtifacts.length})`}
                              aria-pressed={idx === selectedArtifactIdx}
                              style={{
                                padding: 3,
                                borderRadius: 8,
                                border: `2px solid ${idx === selectedArtifactIdx ? "var(--color-accent)" : "var(--color-border)"}`,
                                backgroundColor: "var(--color-surface)",
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              {a.mimeType?.startsWith("video/") ? (
                                <video
                                  src={a.outputUrl}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 5, display: "block", opacity: isPathSelected(a.artifactPath) ? 1 : 0.4 }}
                                />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.outputUrl}
                                  alt={a.modelName}
                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 5, display: "block", opacity: isPathSelected(a.artifactPath) ? 1 : 0.4 }}
                                />
                              )}
                              <span style={{
                                fontSize: 10,
                                color: idx === selectedArtifactIdx ? "var(--color-accent)" : "var(--color-text-muted)",
                                fontWeight: idx === selectedArtifactIdx ? 700 : 400,
                                maxWidth: 64,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}>
                                {a.modelName}
                              </span>
                            </button>
                            {/* Export inclusion checkbox — keyed by file path, independent of preview selection */}
                            <input
                              type="checkbox"
                              checked={isPathSelected(a.artifactPath)}
                              onChange={() => togglePath(a.artifactPath)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Include ${a.modelName} in export`}
                              style={{ position: "absolute", top: 5, right: 5, cursor: "pointer" }}
                            />
                            {/* Use in Canvas — only for image artifacts (no canvas Video Input node yet) */}
                            {!a.mimeType?.startsWith("video/") && (
                              <button
                                type="button"
                                onClick={() => router.push(`/workflows/${workflowId}?insertArtifact=${encodeURIComponent(a.artifactPath)}&insertRunId=${encodeURIComponent(runId)}`)}
                                title={`Use ${a.modelName} as an input node in the canvas editor`}
                                aria-label={`Use ${a.modelName} in canvas`}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  marginTop: 3,
                                  fontSize: 9,
                                  color: "var(--color-accent)",
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  textAlign: "center",
                                  lineHeight: 1.4,
                                }}
                              >
                                Use in Canvas
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {previewArtifact && <ArtifactPreviewPanel result={previewArtifact} label="Artifact output" highlighted={false} />}
        </>
      )}

      {/* ── Per-node cost breakdown ── */}
      <NodeCostBreakdown
        nodeExecutions={nodeExecutions}
        nodeLabels={nodeLabels}
        totalCost={run.totalCost}
      />

      {/* ── Execution timeline ── */}
      <NodeTimeline nodeExecutions={nodeExecutions} nodeLabels={nodeLabels} />

      {/* ── Nodes ── */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 12 }}>
        Nodes
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
          {nodeExecutions.length} executed
        </span>
      </h2>

      {nodeExecutions.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 24 }}>
          No node execution records for this run.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 28 }}>
          {nodeExecutions.map((ne) => (
            <NodeExecutionCard
              key={ne.id}
              ne={ne}
              label={nodeLabels[ne.nodeId] ?? ne.nodeId}
            />
          ))}
        </div>
      )}

      {/* ── Outputs ── */}
      {outputs.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 12 }}>
            Outputs
          </h2>
          <div style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}>
            {nodeExecutions
              .filter((ne) => outputMap.has(ne.nodeId))
              .map((ne, idx) => (
                <NodeOutputBlock
                  key={ne.nodeId}
                  label={nodeLabels[ne.nodeId] ?? ne.nodeId}
                  outputs={outputMap.get(ne.nodeId)!}
                  last={idx === nodeExecutions.filter((n) => outputMap.has(n.nodeId)).length - 1}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Run comparison panel ────────────────────────────────────────────────────

function deltaSign(val: number): string {
  if (val > 0) return "+";
  if (val < 0) return "−";
  return "";
}

function RunComparePanel({
  current, currentNodes, currentLabels, currentGraph,
  prev, prevNodes, prevLabels, prevGraph,
}: {
  current: RunDetail;
  currentNodes: NodeExecutionRow[];
  currentLabels: Record<string, string>;
  currentGraph: WorkflowGraph | null;
  prev: RunDetail;
  prevNodes: NodeExecutionRow[];
  prevLabels: Record<string, string>;
  prevGraph: WorkflowGraph | null;
}) {
  const currDuration = current.startedAt && current.completedAt
    ? new Date(current.completedAt).getTime() - new Date(current.startedAt).getTime()
    : null;
  const prevDuration = prev.startedAt && prev.completedAt
    ? new Date(prev.completedAt).getTime() - new Date(prev.startedAt).getTime()
    : null;
  const costDelta = current.totalCost != null && prev.totalCost != null
    ? current.totalCost - prev.totalCost : null;
  const durationDelta = currDuration != null && prevDuration != null
    ? currDuration - prevDuration : null;

  // Build a per-node comparison keyed by nodeId
  const prevNodeMap = new Map(prevNodes.map((n) => [n.nodeId, n]));
  const nodeIds = Array.from(new Set([
    ...currentNodes.map((n) => n.nodeId),
    ...prevNodes.map((n) => n.nodeId),
  ]));

  // ── Parameter diff ────────────────────────────────────────────────────────
  const diffEntries = useMemo(
    () => computeRunDiff(currentGraph, prevGraph, currentNodes, prevNodes),
    [currentGraph, prevGraph, currentNodes, prevNodes],
  );

  return (
    <div style={{
      marginBottom: 20,
      padding: "16px 20px",
      backgroundColor: "var(--color-surface)",
      border: "1px solid rgba(167,139,250,0.3)",
      borderRadius: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>Comparison</span>
        <code style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          vs. {prev.id.slice(0, 8)} ({new Date(prev.createdAt).toLocaleDateString()})
        </code>
      </div>

      {/* ── What Changed ─────────────────────────────────────────────────── */}
      {diffEntries.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: "10px 14px",
          backgroundColor: "rgba(167,139,250,0.05)",
          border: "1px solid rgba(167,139,250,0.15)",
          borderRadius: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
            What Changed
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {diffEntries.map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12, lineHeight: 1.4 }}>
                {/* Kind indicator */}
                {entry.kind === "node_added" && (
                  <span style={{ color: "#4ade80", fontWeight: 700, flexShrink: 0 }}>+</span>
                )}
                {entry.kind === "node_removed" && (
                  <span style={{ color: "#f87171", fontWeight: 700, flexShrink: 0 }}>−</span>
                )}
                {(entry.kind === "param_changed" || entry.kind === "model_changed") && (
                  <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>·</span>
                )}

                {/* Label */}
                {entry.kind === "node_added" && (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Added node: <strong style={{ color: "#4ade80" }}>{entry.currValue}</strong>
                  </span>
                )}
                {entry.kind === "node_removed" && (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Removed node: <strong style={{ color: "#f87171" }}>{entry.prevValue}</strong>
                  </span>
                )}
                {(entry.kind === "param_changed" || entry.kind === "model_changed") && (
                  <span style={{ color: "var(--color-text-secondary)", minWidth: 0 }}>
                    <span style={{ color: "var(--color-text-muted)" }}>{entry.nodeLabel} — </span>
                    <span style={{ fontWeight: 600 }}>{entry.key}</span>
                    {": "}
                    <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>{entry.prevValue}</span>
                    <span style={{ color: "var(--color-text-muted)", margin: "0 4px" }}>→</span>
                    <span style={{ color: "var(--color-text-primary, #e5e5e5)", fontStyle: entry.kind === "param_changed" && entry.key === "Prompt" ? "italic" : "normal" }}>
                      {entry.currValue}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
        {costDelta !== null && (
          <div>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block" }}>Cost delta</span>
            <span style={{
              fontSize: 14, fontWeight: 600,
              color: costDelta > 0 ? "#f87171" : costDelta < 0 ? "#4ade80" : "var(--color-text-secondary)",
            }}>
              {deltaSign(costDelta)}${Math.abs(costDelta).toFixed(4)}
            </span>
          </div>
        )}
        {durationDelta !== null && (
          <div>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block" }}>Duration delta</span>
            <span style={{
              fontSize: 14, fontWeight: 600,
              color: durationDelta > 0 ? "#f87171" : durationDelta < 0 ? "#4ade80" : "var(--color-text-secondary)",
            }}>
              {deltaSign(durationDelta)}{`${(Math.abs(durationDelta) / 1000).toFixed(1)}s`}
            </span>
          </div>
        )}
        <div>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block" }}>Status</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: STATUS_TEXT_COLOR[prev.status] ?? "var(--color-text-muted)" }}>
            {statusLabel(prev.status)}
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}> → </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: STATUS_TEXT_COLOR[current.status] ?? "var(--color-text-muted)" }}>
            {statusLabel(current.status)}
          </span>
        </div>
      </div>

      {/* Per-node execution status table */}
      {nodeIds.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px 4px 0", color: "var(--color-text-muted)", fontWeight: 600 }}>Node</th>
              <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--color-text-muted)", fontWeight: 600 }}>Prev</th>
              <th style={{ textAlign: "left", padding: "4px 0 4px 8px", color: "var(--color-text-muted)", fontWeight: 600 }}>Current</th>
            </tr>
          </thead>
          <tbody>
            {nodeIds.map((nodeId) => {
              const curr = currentNodes.find((n) => n.nodeId === nodeId);
              const prv = prevNodeMap.get(nodeId);
              const label = currentLabels[nodeId] ?? prevLabels[nodeId] ?? nodeId;
              const changed = curr?.status !== prv?.status;
              return (
                <tr key={nodeId} style={{ borderBottom: "1px solid var(--color-border)", opacity: changed ? 1 : 0.6 }}>
                  <td style={{ padding: "5px 8px 5px 0", color: "var(--color-text-secondary)" }}>{label}</td>
                  <td style={{ padding: "5px 8px", color: STATUS_TEXT_COLOR[prv?.status ?? ""] ?? "var(--color-text-muted)" }}>
                    {prv ? statusLabel(prv.status) : "—"}
                  </td>
                  <td style={{ padding: "5px 0 5px 8px", color: STATUS_TEXT_COLOR[curr?.status ?? ""] ?? "var(--color-text-muted)" }}>
                    {curr ? statusLabel(curr.status) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

type BreakdownSortMode = "desc" | "asc" | "alpha";
type BreakdownViewMode = "cost" | "duration";

function msToLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function NodeCostBreakdown({
  nodeExecutions,
  nodeLabels,
  totalCost,
}: {
  nodeExecutions: NodeExecutionRow[];
  nodeLabels: Record<string, string>;
  totalCost: number | null;
}) {
  const [view, setView] = useState<BreakdownViewMode>("cost");
  const [sort, setSort] = useState<BreakdownSortMode>("desc");

  const costRows = nodeExecutions
    .filter((ne): ne is NodeExecutionRow & { cost: number } => ne.cost != null && ne.cost > 0)
    .map((ne) => ({ label: nodeLabels[ne.nodeId] ?? ne.nodeId, value: ne.cost }));

  const durationRows = nodeExecutions
    .filter((ne) => ne.startedAt != null && ne.completedAt != null)
    .map((ne) => ({
      label: nodeLabels[ne.nodeId] ?? ne.nodeId,
      value: new Date(ne.completedAt!).getTime() - new Date(ne.startedAt!).getTime(),
    }))
    .filter((r) => r.value > 0);

  if (costRows.length === 0 && durationRows.length === 0) return null;

  const rows = view === "cost" ? costRows : durationRows;

  const total = view === "cost"
    ? (totalCost != null && totalCost > 0 ? totalCost : costRows.reduce((s, r) => s + r.value, 0))
    : durationRows.reduce((s, r) => s + r.value, 0);

  const maxValue = rows.length > 0 ? Math.max(...rows.map((r) => r.value)) : 0;

  const sorted = [...rows].sort((a, b) => {
    if (sort === "desc") return b.value - a.value;
    if (sort === "asc") return a.value - b.value;
    return a.label.localeCompare(b.label);
  });

  const SORT_LABELS: Record<BreakdownSortMode, string> = {
    desc: "High → Low",
    asc:  "Low → High",
    alpha: "A–Z",
  };

  const barColor = view === "cost" ? "#60a5fa" : "#a78bfa";
  const headingText = view === "cost" ? "Cost breakdown" : "Duration breakdown";
  const countText = view === "cost"
    ? `${costRows.length} node${costRows.length !== 1 ? "s" : ""} with cost`
    : `${durationRows.length} node${durationRows.length !== 1 ? "s" : ""} timed`;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
          {headingText}
        </h2>
        {/* View toggle */}
        <div style={{ display: "flex", gap: 2 }}>
          {(["cost", "duration"] as BreakdownViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                fontSize: 11,
                background: "none",
                border: `1px solid ${view === v ? "var(--color-border)" : "transparent"}`,
                borderRadius: 4,
                padding: "2px 8px",
                color: view === v ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                cursor: "pointer",
                fontWeight: view === v ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {countText}
        </span>
        {/* Sort controls */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {(["desc", "asc", "alpha"] as BreakdownSortMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSort(mode)}
              style={{
                fontSize: 11,
                background: "none",
                border: `1px solid ${sort === mode ? "var(--color-border)" : "transparent"}`,
                borderRadius: 4,
                padding: "2px 8px",
                color: sort === mode ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                cursor: "pointer",
                fontWeight: sort === mode ? 600 : 400,
              }}
            >
              {SORT_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
          No node-level {view} data available for this run.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {sorted.map(({ label, value }) => {
            const pct = total > 0 ? (value / total) * 100 : 0;
            const barPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
            return (
              <div
                key={label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(90px, 180px) 1fr 72px 44px",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  title={label}
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
                <div style={{
                  height: 4, borderRadius: 2,
                  backgroundColor: "var(--color-border)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${barPct}%`,
                    backgroundColor: barColor,
                    borderRadius: 2,
                    opacity: 0.75,
                  }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "right" }}>
                  {view === "cost" ? `$${value.toFixed(4)}` : msToLabel(value)}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "right" }}>
                  {pct < 0.5 ? "<1%" : `${Math.round(pct)}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodeTimeline({
  nodeExecutions,
  nodeLabels,
}: {
  nodeExecutions: NodeExecutionRow[];
  nodeLabels: Record<string, string>;
}) {
  type TimedRow = { label: string; start: number; end: number; durationMs: number };

  const rows: TimedRow[] = nodeExecutions
    .filter((ne) => ne.startedAt != null && ne.completedAt != null)
    .map((ne) => {
      const start = new Date(ne.startedAt!).getTime();
      const end = new Date(ne.completedAt!).getTime();
      return { label: nodeLabels[ne.nodeId] ?? ne.nodeId, start, end, durationMs: end - start };
    })
    .filter((r) => r.durationMs > 0)
    .sort((a, b) => a.start - b.start);

  if (rows.length === 0) return null;

  const spanStart = Math.min(...rows.map((r) => r.start));
  const spanEnd   = Math.max(...rows.map((r) => r.end));
  const span      = spanEnd - spanStart || 1;

  // Minimum visible bar width so instant nodes don't disappear
  const MIN_BAR_PCT = 0.5;

  // Peak concurrency: sweep-line over [start, +1] / [end, -1] events.
  // Ties broken by processing end events first (boundary not counted as overlap).
  const peakConcurrency = (() => {
    const events: [number, number][] = rows.flatMap((r) => [[r.start, 1], [r.end, -1]] as [number, number][]);
    events.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    let cur = 0, peak = 0;
    for (const [, delta] of events) { cur += delta; if (cur > peak) peak = cur; }
    return peak;
  })();

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 10 }}>
        Execution timeline
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
          {rows.length} node{rows.length !== 1 ? "s" : ""}
        </span>
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map(({ label, start, durationMs }) => {
          const leftPct  = ((start - spanStart) / span) * 100;
          const widthPct = Math.max((durationMs / span) * 100, MIN_BAR_PCT);
          return (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(90px, 180px) 1fr 64px",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                title={label}
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              {/* Track */}
              <div style={{
                position: "relative",
                height: 6,
                borderRadius: 3,
                backgroundColor: "var(--color-border)",
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: "100%",
                  backgroundColor: "#a78bfa",
                  borderRadius: 3,
                  opacity: 0.8,
                }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "right" }}>
                {msToLabel(durationMs)}
              </span>
            </div>
          );
        })}
      </div>
      {/* Footer summary */}
      <div style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 20px",
      }}>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          Wall-clock span: <span style={{ color: "var(--color-text-secondary)" }}>{msToLabel(spanEnd - spanStart)}</span>
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          Peak concurrent nodes: <span style={{ color: "var(--color-text-secondary)" }}>{peakConcurrency}</span>
        </span>
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{value}</div>
    </div>
  );
}

function NodeExecutionCard({ ne, label }: { ne: NodeExecutionRow; label: string }) {
  const dot = STATUS_COLOR[ne.status] ?? "#737373";
  const textColor = STATUS_TEXT_COLOR[ne.status] ?? "var(--color-text-muted)";

  return (
    <div style={{
      padding: "10px 14px",
      backgroundColor: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          display: "inline-block", width: 7, height: 7,
          borderRadius: "50%", backgroundColor: dot, flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", flex: 1, minWidth: 100 }}>
          {label}
        </span>
        <span style={{ fontSize: 12, color: textColor, textTransform: "capitalize" }}>
          {statusLabel(ne.status)}
        </span>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {durationLabel(ne.startedAt, ne.completedAt)}
        </span>
        {ne.cost != null && ne.cost > 0 && (
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            ${ne.cost.toFixed(4)}
          </span>
        )}
        {ne.providerId && (
          <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>
            {ne.providerId}{ne.modelId ? ` · ${ne.modelId}` : ""}
          </span>
        )}
      </div>

      {ne.error && (
        <pre style={{
          marginTop: 8,
          padding: "6px 8px",
          backgroundColor: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 6,
          fontSize: 11,
          color: "#fca5a5",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {ne.error}
        </pre>
      )}
    </div>
  );
}

function NodeOutputBlock({
  label,
  outputs,
  last,
}: {
  label: string;
  outputs: Record<string, unknown>;
  last: boolean;
}) {
  return (
    <div style={{
      padding: "14px 18px",
      borderBottom: last ? "none" : "1px solid var(--color-border)",
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 10 }}>
        {label}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.entries(outputs).map(([key, value]) => (
          <OutputEntry key={key} portKey={key} value={value} />
        ))}
      </div>
    </div>
  );
}

function OutputEntry({ portKey, value }: { portKey: string; value: unknown }) {
  // Direct image ArtifactRef
  if (isArtifactRef(value) && value.mimeType.startsWith("image/")) {
    return (
      <div>
        <PortLabel label={portKey} />
        <ArtifactImage ref={value} />
      </div>
    );
  }

  // Direct video ArtifactRef
  if (isArtifactRef(value) && value.mimeType.startsWith("video/")) {
    return (
      <div>
        <PortLabel label={portKey} note="video" />
        <ArtifactVideo ref={value} />
      </div>
    );
  }

  // Collection / selection — extract embedded image refs
  const imageRefs = extractImageRefs(value);
  if (imageRefs.length > 0) {
    return (
      <div>
        <PortLabel label={portKey} note={`${imageRefs.length} image${imageRefs.length !== 1 ? "s" : ""}`} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {imageRefs.map((ref, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <ArtifactImage key={i} ref={ref} />
          ))}
        </div>
      </div>
    );
  }

  // Collection / selection — extract embedded video refs
  const videoRefs = extractVideoRefs(value);
  if (videoRefs.length > 0) {
    return (
      <div>
        <PortLabel label={portKey} note={`${videoRefs.length} video${videoRefs.length !== 1 ? "s" : ""}`} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {videoRefs.map((ref, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <ArtifactVideo key={i} ref={ref} />
          ))}
        </div>
      </div>
    );
  }

  // String
  if (typeof value === "string") {
    return (
      <div>
        <PortLabel label={portKey} />
        <pre style={{
          margin: 0,
          padding: "8px 10px",
          backgroundColor: "var(--color-surface-hover, #1a1a1a)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--color-text-secondary)",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 120,
          overflow: "auto",
        }}>
          {value}
        </pre>
      </div>
    );
  }

  // Primitive
  if (typeof value !== "object" || value === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PortLabel label={portKey} />
        <code style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{String(value)}</code>
      </div>
    );
  }

  // JSON fallback
  return (
    <div>
      <PortLabel label={portKey} />
      <pre style={{
        margin: 0,
        padding: "8px 10px",
        backgroundColor: "var(--color-surface-hover, #1a1a1a)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--color-text-muted)",
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: 160,
        overflow: "auto",
      }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function PortLabel({ label, note }: { label: string; note?: string }) {
  return (
    <div style={{ marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>{label}</span>
      {note && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{note}</span>}
    </div>
  );
}

function ArtifactVideo({ ref }: { ref: ArtifactRef }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/artifacts?path=${encodeURIComponent(ref.path)}`;

  if (failed) {
    return (
      <div style={{
        padding: "8px 12px",
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--color-text-muted)",
      }}>
        {ref.filename}
        {" — file no longer available"}
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      playsInline
      title={ref.filename}
      onError={() => setFailed(true)}
      style={{
        maxHeight: 200,
        maxWidth: "min(320px, 100%)",
        borderRadius: 6,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-surface)",
        display: "block",
      }}
    />
  );
}

function ArtifactImage({ ref }: { ref: ArtifactRef }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/artifacts?path=${encodeURIComponent(ref.path)}`;

  if (failed) {
    return (
      <div style={{
        padding: "8px 12px",
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--color-text-muted)",
      }}>
        {ref.filename}
        {ref.width && ref.height ? ` (${ref.width}×${ref.height})` : ""}
        {" — file no longer available"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={ref.filename}
      title={ref.width && ref.height ? `${ref.filename} (${ref.width}×${ref.height})` : ref.filename}
      onError={() => setFailed(true)}
      style={{
        maxHeight: 200,
        maxWidth: "min(240px, 100%)",
        borderRadius: 6,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-surface)",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}
