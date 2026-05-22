"use client";

import { useState, useEffect, useCallback } from "react";
import type { ArtifactRef } from "@iterastudio/shared";
import { extractImageRefs, extractVideoRefs } from "@/lib/artifactRefs";

// ── Types matching API shapes ─────────────────────────────────────────────────

interface WorkflowSummary {
  id: string;
  name: string;
  lastRunStatus: string | null;
  lastRunAt: string | null;
}

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
}

interface PickableArtifact {
  ref: ArtifactRef;
  nodeId: string;
  workflowId: string;
  runId: string;
}

interface ArtifactPickerModalProps {
  onPick: (ref: ArtifactRef) => void;
  onClose: () => void;
}

function artifactUrl(path: string): string {
  return `/api/artifacts?path=${encodeURIComponent(path)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ArtifactPickerModal({ onPick, onClose }: ArtifactPickerModalProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<PickableArtifact[]>([]);

  const [loadingWorkflows, setLoadingWorkflows] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workflows on mount
  useEffect(() => {
    setLoadingWorkflows(true);
    fetch("/api/workflows")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: WorkflowSummary[] | { workflows?: WorkflowSummary[] }) => {
        const raw = Array.isArray(data) ? data : (data.workflows ?? []);
        const wfs = raw.filter(
          (w) => w.lastRunStatus === "completed",
        );
        setWorkflows(wfs);
        if (wfs.length === 1) setSelectedWorkflowId(wfs[0]!.id);
      })
      .catch(() => setError("Could not load workflows."))
      .finally(() => setLoadingWorkflows(false));
  }, []);

  // Load runs when workflow is selected
  useEffect(() => {
    if (!selectedWorkflowId) return;
    setSelectedRunId(null);
    setArtifacts([]);
    setRuns([]);
    setLoadingRuns(true);
    setError(null);
    fetch(`/api/workflows/${selectedWorkflowId}/runs`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: RunSummary[] | { runs?: RunSummary[] }) => {
        const raw = Array.isArray(data) ? data : (data.runs ?? []);
        const completed = raw.filter((r) => r.status === "completed");
        setRuns(completed);
        if (completed.length === 1) setSelectedRunId(completed[0]!.id);
      })
      .catch(() => setError("Could not load runs."))
      .finally(() => setLoadingRuns(false));
  }, [selectedWorkflowId]);

  // Load artifacts when run is selected
  useEffect(() => {
    if (!selectedWorkflowId || !selectedRunId) return;
    setArtifacts([]);
    setLoadingArtifacts(true);
    setError(null);
    fetch(`/api/workflows/${selectedWorkflowId}/runs/${selectedRunId}/outputs`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { outputs?: Array<{ nodeId: string; outputs: Record<string, unknown> }> }) => {
        const found: PickableArtifact[] = [];
        for (const node of data.outputs ?? []) {
          const imageRefs = extractImageRefs(node.outputs);
          const videoRefs = extractVideoRefs(node.outputs);
          for (const ref of [...imageRefs, ...videoRefs]) {
            found.push({ ref, nodeId: node.nodeId, workflowId: selectedWorkflowId, runId: selectedRunId });
          }
        }
        setArtifacts(found);
      })
      .catch(() => setError("Could not load run outputs."))
      .finally(() => setLoadingArtifacts(false));
  }, [selectedWorkflowId, selectedRunId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add scene from artifacts"
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          width: "min(680px, 95vw)",
          maxHeight: "min(560px, 90vh)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
            Add Scene from Artifacts
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Selectors row */}
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-border)",
              flexShrink: 0,
            }}
          >
            {/* Workflow selector */}
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", marginBottom: 4 }}>
                Workflow
              </label>
              {loadingWorkflows ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>
              ) : workflows.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No completed workflows</div>
              ) : (
                <select
                  value={selectedWorkflowId ?? ""}
                  onChange={(e) => setSelectedWorkflowId(e.target.value || null)}
                  style={{
                    width: "100%",
                    fontSize: 12,
                    padding: "5px 8px",
                    borderRadius: 5,
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-primary)",
                    outline: "none",
                  }}
                >
                  <option value="">Select a workflow…</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Run selector */}
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", marginBottom: 4 }}>
                Run
              </label>
              {loadingRuns ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>
              ) : !selectedWorkflowId ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>—</div>
              ) : runs.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No completed runs</div>
              ) : (
                <select
                  value={selectedRunId ?? ""}
                  onChange={(e) => setSelectedRunId(e.target.value || null)}
                  style={{
                    width: "100%",
                    fontSize: 12,
                    padding: "5px 8px",
                    borderRadius: 5,
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-primary)",
                    outline: "none",
                  }}
                >
                  <option value="">Select a run…</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>{formatDate(r.createdAt)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Artifact grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {error && (
              <p style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>{error}</p>
            )}
            {!error && loadingArtifacts && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>Loading artifacts…</p>
            )}
            {!error && !loadingArtifacts && selectedRunId && artifacts.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                No image or video artifacts found in this run.
              </p>
            )}
            {!error && !loadingArtifacts && !selectedRunId && !selectedWorkflowId && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                Select a workflow and run to browse artifacts.
              </p>
            )}
            {!error && !loadingArtifacts && !selectedRunId && selectedWorkflowId && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                Select a run to browse its artifacts.
              </p>
            )}
            {artifacts.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: 10,
                }}
              >
                {artifacts.map((a, i) => (
                  <ArtifactTile key={`${a.nodeId}-${i}`} artifact={a} onPick={onPick} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Artifact tile ─────────────────────────────────────────────────────────────

function ArtifactTile({
  artifact,
  onPick,
}: {
  artifact: PickableArtifact;
  onPick: (ref: ArtifactRef) => void;
}) {
  const { ref } = artifact;
  const isVideo = ref.mimeType.startsWith("video/");
  const src = artifactUrl(ref.path);

  return (
    <button
      type="button"
      onClick={() => onPick(ref)}
      title={ref.filename ?? (isVideo ? "Video artifact" : "Image artifact")}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border)";
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: "56.25%",
          backgroundColor: "#000",
          overflow: "hidden",
        }}
      >
        {isVideo ? (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={ref.filename ?? "artifact"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}

        {/* Type badge */}
        <span
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            fontSize: 8,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "1px 4px",
            borderRadius: 3,
            backgroundColor: isVideo ? "rgba(249,115,22,0.85)" : "rgba(168,85,247,0.85)",
            color: "#fff",
          }}
        >
          {isVideo ? "video" : "image"}
        </span>
      </div>

      {/* Filename */}
      <div
        style={{
          padding: "5px 7px",
          fontSize: 10,
          color: "var(--color-text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {ref.filename ?? (isVideo ? "video" : "image")}
      </div>
    </button>
  );
}
