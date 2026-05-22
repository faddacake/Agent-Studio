"use client";

/**
 * RunOutputsPanel — displays node output values from a completed or
 * in-progress workflow run.
 *
 * Fetches from GET /api/workflows/:id/runs/:runId/outputs whenever a new
 * node completes (tracked via snapshot.summary.completed).
 *
 * Supports:
 *   - ArtifactRef images   → inline <img> via /api/artifacts?path=...
 *   - ArtifactRef videos   → inline <video> via /api/artifacts?path=...
 *   - Candidate collections → extracted image/video grid + count
 *   - Strings              → monospace text block
 *   - Primitives           → inline value
 *   - Everything else      → truncated formatted JSON
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isArtifactRef } from "@iterastudio/shared";
import type { ArtifactRef } from "@iterastudio/shared";
import type { RunDebugSnapshot } from "@iterastudio/engine";
import { extractImageRefs, extractVideoRefs } from "@/lib/artifactRefs";

// ── Types ──────────────────────────────────────────────────────────────────

interface NodeOutputEntry {
  nodeId: string;
  outputs: Record<string, unknown>;
}

export interface RunOutputsPanelProps {
  workflowId: string;
  runId: string | null;
  snapshot: RunDebugSnapshot | null;
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function RunOutputsPanel({
  workflowId,
  runId,
  snapshot,
}: RunOutputsPanelProps) {
  const router = useRouter();
  const [nodeOutputs, setNodeOutputs] = useState<NodeOutputEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingToEditor, setSendingToEditor] = useState(false);

  const completedCount = snapshot?.summary.completed ?? 0;

  useEffect(() => {
    if (!runId || completedCount === 0) {
      setNodeOutputs([]);
      return;
    }

    setLoading(true);
    fetch(`/api/workflows/${workflowId}/runs/${runId}/outputs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputs: NodeOutputEntry[] } | null) => {
        if (data?.outputs) setNodeOutputs(data.outputs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workflowId, runId, completedCount]);

  const handleSendToEditor = useCallback(async () => {
    if (sendingToEditor || !runId) return;
    setSendingToEditor(true);
    try {
      type Scene = { id: string; type: "image" | "video"; src: string; duration: number };
      const scenes: Scene[] = [];
      for (const { outputs } of nodeOutputs) {
        for (const value of Object.values(outputs)) {
          if (isArtifactRef(value)) {
            if (value.mimeType.startsWith("image/")) {
              scenes.push({ id: crypto.randomUUID(), type: "image", src: value.path, duration: 5 });
            } else if (value.mimeType.startsWith("video/")) {
              scenes.push({ id: crypto.randomUUID(), type: "video", src: value.path, duration: 10 });
            }
          } else {
            for (const ref of extractImageRefs(value)) {
              scenes.push({ id: crypto.randomUUID(), type: "image", src: ref.path, duration: 5 });
            }
            for (const ref of extractVideoRefs(value)) {
              scenes.push({ id: crypto.randomUUID(), type: "video", src: ref.path, duration: 10 });
            }
          }
        }
      }
      if (scenes.length === 0) { setSendingToEditor(false); return; }
      const res = await fetch("/api/editor-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Run ${runId.slice(0, 8)}`, aspectRatio: "16:9", scenes }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const project = (await res.json()) as { id: string };
      router.push(`/editor/${project.id}`);
    } catch {
      setSendingToEditor(false);
    }
  }, [sendingToEditor, runId, nodeOutputs, router]);

  if (!runId) {
    return (
      <div className="px-4 py-4 text-xs text-neutral-500">
        No run yet — start a workflow run to see outputs.
      </div>
    );
  }

  // Label lookup from snapshot
  const labelMap = new Map<string, string>();
  if (snapshot) {
    for (const n of snapshot.nodes) {
      labelMap.set(n.nodeId, n.label);
    }
  }

  // Sort by topological order from snapshot
  const topoOrder = snapshot?.executionOrder ?? [];
  const ordered: NodeOutputEntry[] = topoOrder
    .map((id) => nodeOutputs.find((n) => n.nodeId === id))
    .filter(Boolean) as NodeOutputEntry[];
  // Any nodes not in topo order (edge case) go at the end
  for (const n of nodeOutputs) {
    if (!topoOrder.includes(n.nodeId)) ordered.push(n);
  }

  if (loading && ordered.length === 0) {
    return (
      <div className="px-4 py-4 text-xs text-neutral-500">Loading outputs…</div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="px-4 py-4 text-xs text-neutral-500">
        {completedCount > 0 ? "Loading outputs…" : "No completed nodes yet."}
      </div>
    );
  }

  // Show the "Send to Video Editor" button whenever there are image or video artifacts.
  const hasArtifacts = ordered.some(({ outputs }) =>
    Object.values(outputs).some((v) =>
      (isArtifactRef(v) && (v.mimeType.startsWith("image/") || v.mimeType.startsWith("video/"))) ||
      extractImageRefs(v).length > 0 ||
      extractVideoRefs(v).length > 0,
    ),
  );

  return (
    <div className="flex flex-col divide-y divide-neutral-800/60">
      {hasArtifacts && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => { void handleSendToEditor(); }}
            disabled={sendingToEditor}
            className={`w-full rounded-lg border py-2 text-sm font-semibold transition-colors ${
              sendingToEditor
                ? "cursor-default border-neutral-700 bg-neutral-900 text-neutral-500"
                : "border-emerald-600 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25"
            }`}
          >
            {sendingToEditor ? "Opening Editor…" : "Send to Video Editor →"}
          </button>
        </div>
      )}
      {ordered.map(({ nodeId, outputs }) => (
        <NodeOutputSection
          key={nodeId}
          label={labelMap.get(nodeId) ?? nodeId}
          outputs={outputs}
        />
      ))}
    </div>
  );
}

// ── Node section ───────────────────────────────────────────────────────────

function NodeOutputSection({
  label,
  outputs,
}: {
  label: string;
  outputs: Record<string, unknown>;
}) {
  const entries = Object.entries(outputs);

  return (
    <div className="px-4 py-3">
      <h4 className="mb-2 text-[11px] font-semibold text-neutral-300">{label}</h4>
      <div className="flex flex-col gap-3">
        {entries.map(([key, value]) => (
          <OutputEntry key={key} portKey={key} value={value} />
        ))}
      </div>
    </div>
  );
}

// ── Per-output entry ───────────────────────────────────────────────────────

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
        <PortLabel
          label={portKey}
          note={`${imageRefs.length} image${imageRefs.length !== 1 ? "s" : ""}`}
        />
        <div className="flex flex-wrap gap-2">
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
        <PortLabel
          label={portKey}
          note={`${videoRefs.length} video${videoRefs.length !== 1 ? "s" : ""}`}
        />
        <div className="flex flex-wrap gap-2">
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
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-neutral-900/80 p-2 text-[11px] leading-relaxed text-neutral-300 font-mono">
          {value}
        </pre>
      </div>
    );
  }

  // Primitive
  if (typeof value !== "object" || value === null) {
    return (
      <div className="flex items-center gap-2">
        <PortLabel label={portKey} />
        <span className="text-[11px] text-neutral-300 font-mono">{String(value)}</span>
      </div>
    );
  }

  // Complex object / array — show formatted JSON (truncated)
  return (
    <div>
      <PortLabel label={portKey} />
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-neutral-900/80 p-2 text-[10px] text-neutral-400 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ── Tiny sub-components ────────────────────────────────────────────────────

function PortLabel({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-neutral-500">{label}</span>
      {note && (
        <span className="text-[10px] text-neutral-600">{note}</span>
      )}
    </div>
  );
}

function ArtifactImage({ ref }: { ref: ArtifactRef }) {
  const src = `/api/artifacts?path=${encodeURIComponent(ref.path)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={ref.filename}
      title={
        ref.width && ref.height
          ? `${ref.filename} (${ref.width}×${ref.height})`
          : ref.filename
      }
      className="max-h-48 rounded border border-neutral-700 bg-neutral-800/60 object-contain"
      style={{ maxWidth: "min(220px, 100%)" }}
    />
  );
}

function ArtifactVideo({ ref }: { ref: ArtifactRef }) {
  const src = `/api/artifacts?path=${encodeURIComponent(ref.path)}`;
  return (
    <video
      src={src}
      controls
      playsInline
      title={ref.filename}
      className="max-h-48 rounded border border-neutral-700 bg-neutral-900 object-contain"
      style={{ maxWidth: "min(300px, 100%)" }}
    />
  );
}
