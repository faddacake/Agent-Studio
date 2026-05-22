"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import type { WorkflowNode, WorkflowEdge } from "@iterastudio/shared";
import { imageInputNode, promptTemplateNode } from "@iterastudio/shared";
import { extractImageRefs, extractVideoRefs } from "@/lib/artifactRefs";
import { NodeConfig } from "./NodeConfig";
import { useWorkflowStore } from "@/stores/workflowStore";
import { formatDuration, formatCost, humanizeNodeError } from "@/lib/formatExecution";
import type { ExecutionStatus } from "@/lib/nodeExecutionSummary";
import { canRetry } from "@/lib/retryRun";
import { ArtifactPreviewPanel } from "@/components/prompt/ArtifactPreviewPanel";
import type { ArtifactPreviewable } from "@/components/prompt/ArtifactPreviewPanel";
import { createWorkflowNode } from "@/components/canvas/createWorkflowNode";
import { getSuggestions } from "@/lib/suggestions";
import type { Suggestion } from "@/lib/suggestions";
import { findCompatibleInputPort } from "@/lib/portCompatibility";
import { getSupportedModels, type ModelOption } from "@/config/models";

type InspectorTab = "config" | "ports" | "run";

interface InspectorPanelProps {
  /** The currently selected node, or null if nothing is selected */
  selectedNode: WorkflowNode | null;
  /** Called when a parameter value changes */
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  /** Called when the panel is closed */
  onClose?: () => void;
}

/**
 * Right-side sliding inspector panel.
 * Opens when a node is selected. Delegates configuration rendering
 * to NodeConfig, which is entirely schema-driven.
 */
export function InspectorPanel({ selectedNode, onParamChange, onClose }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("config");

  // Read selected node's run status to detect failure transitions
  const runStatus = useWorkflowStore((state) => {
    if (!state.debugSnapshot || !selectedNode) return null;
    return state.debugSnapshot.nodes.find((n) => n.nodeId === selectedNode.id)?.status ?? null;
  });

  // Auto-switch to Run tab when the selected node transitions to running, failed, or cancelled
  useEffect(() => {
    if (runStatus === "running" || runStatus === "failed" || runStatus === "cancelled") {
      setActiveTab("run");
    }
  }, [runStatus]);

  // Briefly highlight the Run tab label when the selected node completes
  const [runTabHighlighted, setRunTabHighlighted] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (highlightTimer.current !== null) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    if (runStatus === "completed") {
      setRunTabHighlighted(true);
      highlightTimer.current = setTimeout(() => setRunTabHighlighted(false), 2000);
    } else {
      setRunTabHighlighted(false);
    }
    return () => {
      if (highlightTimer.current !== null) {
        clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }
    };
  }, [runStatus]);

  if (!selectedNode) {
    return null;
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h3 className="text-sm font-medium text-neutral-200 truncate">
          {selectedNode.data.label}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            aria-label="Close inspector"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800">
        {(["config", "ports", "run"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-500 text-blue-400"
                : tab === "run" && runTabHighlighted
                ? "text-green-400 hover:text-green-300"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "config" && (
          <>
            <ProvenanceBadge node={selectedNode} />
            <PresetBar node={selectedNode} onParamChange={onParamChange} />
            <ProviderModelPicker node={selectedNode} onParamChange={onParamChange} />
            <NodeConfig node={selectedNode} onParamChange={onParamChange} />
            <LatestOutputSection node={selectedNode} />
            <LastRunSection node={selectedNode} />
            <SuggestionsSection node={selectedNode} />
          </>
        )}
        {activeTab === "ports" && (
          <PortsTab node={selectedNode} />
        )}
        {activeTab === "run" && (
          <RunTab node={selectedNode} />
        )}
      </div>
    </div>
  );
}

// ── Provenance badge ──

function ProvenanceBadge({ node }: { node: WorkflowNode }) {
  const workflowId = useWorkflowStore((state) => state.meta?.id ?? null);
  const provenance = node.data.params.__provenance as
    | { runId: string; artifactPath: string }
    | undefined;

  if (!provenance?.runId || !workflowId) return null;

  const shortRunId = provenance.runId.slice(0, 8);
  const href = `/workflows/${workflowId}/history/${provenance.runId}`;

  return (
    <div className="mx-3 mt-3 flex items-center gap-1.5 rounded border border-purple-800/50 bg-purple-950/40 px-2 py-1.5 text-[11px]">
      <svg
        className="h-3 w-3 shrink-0 text-purple-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 015.656 0l4-4a4 4 0 01-5.656-5.656l-1.102 1.101" />
      </svg>
      <span className="text-purple-300/70">From run</span>
      <Link
        href={href}
        className="font-mono text-purple-300 hover:text-purple-200 hover:underline"
        title={`View source run ${provenance.runId}`}
      >
        {shortRunId}
      </Link>
    </div>
  );
}

// ── Provider & Model picker ──

const NODE_TYPE_TO_CATEGORY: Record<string, "image" | "video"> = {
  "image-generation": "image",
  "video-generation": "video",
};

const PROVIDER_LABELS: Record<string, string> = {
  fal: "fal.ai",
  replicate: "Replicate",
};

function ProviderModelPicker({
  node,
  onParamChange,
}: {
  node: WorkflowNode;
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
}) {
  // ── Hooks first (before any early returns) ──────────────────────────────────
  // null = fetch not yet complete; Set = configured provider IDs
  const [configuredProviders, setConfiguredProviders] = useState<Set<string> | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.ok ? (r.json() as Promise<Array<{ id: string }>>) : Promise.reject())
      .then((data) => setConfiguredProviders(new Set(data.map((p) => p.id))))
      .catch(() => setConfiguredProviders(new Set()));
  }, []);

  // ── Derive category from node type ──────────────────────────────────────────
  const category = NODE_TYPE_TO_CATEGORY[node.type];
  if (!category) return null;

  // Build provider → model list and adapterModelId → ModelOption lookup in one pass.
  const modelsByProvider: Record<string, { id: string; label: string }[]> = {};
  const modelByAdapterId: Record<string, ModelOption> = {};
  for (const m of getSupportedModels(category)) {
    if (!modelsByProvider[m.provider]) modelsByProvider[m.provider] = [];
    modelsByProvider[m.provider].push({ id: m.adapterModelId, label: m.name });
    modelByAdapterId[m.adapterModelId] = m;
  }

  const availableProviders = Object.keys(modelsByProvider).map((id) => ({
    id,
    label: PROVIDER_LABELS[id] ?? id,
  }));
  if (availableProviders.length === 0) return null;

  const currentProvider =
    (node.data.params.providerId as string | undefined) ?? availableProviders[0].id;
  const models = modelsByProvider[currentProvider] ?? [];
  const currentModel =
    (node.data.params.modelId as string | undefined) ?? models[0]?.id ?? "";

  // configuredProviders === null while fetch is in flight — don't warn yet.
  const providerIsConfigured =
    configuredProviders === null || configuredProviders.has(currentProvider);

  /** Apply modelId + all defaultParams for the given adapterModelId. */
  const applyModel = (adapterId: string) => {
    onParamChange(node.id, "modelId", adapterId);
    const modelOption = modelByAdapterId[adapterId];
    if (modelOption) {
      for (const [key, value] of Object.entries(modelOption.defaultParams)) {
        onParamChange(node.id, key, value);
      }
    }
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    onParamChange(node.id, "providerId", newProvider);
    const firstAdapterId = modelsByProvider[newProvider]?.[0]?.id ?? "";
    applyModel(firstAdapterId);
  };

  return (
    <div className="mx-3 mt-3 mb-1">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Provider &amp; Model
      </h4>
      <div className="flex flex-col gap-2">
        <select
          value={currentProvider}
          onChange={handleProviderChange}
          className="w-full cursor-pointer rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-300 outline-none"
        >
          {availableProviders.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <select
          value={currentModel}
          onChange={(e) => applyModel(e.target.value)}
          className="w-full cursor-pointer rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-300 outline-none"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        {currentModel && modelByAdapterId[currentModel] && (
          <p className="text-[10px] text-neutral-600">
            ≈ ${modelByAdapterId[currentModel].estimatedCost.toFixed(3)} / {category === "video" ? "clip" : "image"}
          </p>
        )}
        {!providerIsConfigured && (
          <p className="text-[10px] leading-snug text-amber-500/90">
            No {PROVIDER_LABELS[currentProvider] ?? currentProvider} API key —{" "}
            <Link
              href="/settings/providers"
              className="underline decoration-dotted underline-offset-2 hover:text-amber-400 transition-colors"
            >
              Add key →
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Last Run section (Config tab) ──

const LAST_RUN_STATUS_COLOR: Record<ExecutionStatus, string> = {
  success: "text-green-400",
  failed:  "text-red-400",
  running: "text-blue-400",
  queued:  "text-yellow-400",
  idle:    "text-neutral-400",
};

const LAST_RUN_STATUS_LABEL: Record<ExecutionStatus, string> = {
  success: "Completed",
  failed:  "Failed",
  running: "Running",
  queued:  "Queued",
  idle:    "Idle",
};

function LastRunSection({ node }: { node: WorkflowNode }) {
  const summary = useWorkflowStore((s) => s.latestExecutionByNodeId[node.id] ?? null);
  const workflowId = useWorkflowStore((s) => s.meta?.id ?? null);
  // Suppress the "Open Run" link if LatestOutputSection already shows it for the same run.
  const outputRunId = useWorkflowStore((s) => s.latestOutputsByNode?.[node.id]?.runId ?? null);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  if (!summary) return null;

  const runHref = workflowId ? `/workflows/${workflowId}/history/${summary.runId}` : null;
  const showRunLink = runHref && summary.runId !== outputRunId;
  const showRetry = canRetry({
    hasWorkflow: !!workflowId,
    isRunning,
    nodeIsFailed: summary.status === "failed",
  });

  return (
    <div className="mx-3 mt-4 mb-1">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Last Run
      </h4>
      <div className="rounded border border-neutral-800 bg-neutral-900/60 overflow-hidden">
        <div className="flex flex-col gap-1 p-2 text-[11px]">
          {/* Status */}
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-neutral-500">Status</span>
            <span className={LAST_RUN_STATUS_COLOR[summary.status]}>
              {LAST_RUN_STATUS_LABEL[summary.status]}
            </span>
          </div>
          {/* Duration */}
          {summary.durationMs !== undefined && (
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-neutral-500">Duration</span>
              <span className="text-neutral-300">{formatDuration(summary.durationMs)}</span>
            </div>
          )}
          {/* Model */}
          {summary.modelId && (
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-neutral-500">Model</span>
              <span className="break-all font-mono text-neutral-300 text-right">{summary.modelId}</span>
            </div>
          )}
          {/* Provider (only when no modelId to avoid redundancy) */}
          {summary.providerId && !summary.modelId && (
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-neutral-500">Provider</span>
              <span className="font-mono text-neutral-300">{summary.providerId}</span>
            </div>
          )}
          {/* Cost */}
          {summary.cost !== undefined && summary.cost > 0 && (
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-neutral-500">Cost</span>
              <span className="text-neutral-300">{formatCost(summary.cost)}</span>
            </div>
          )}
        </div>
        {/* Error line — humanized with recovery suggestion */}
        {summary.status === "failed" && summary.shortError && (() => {
          const { message, suggestion } = humanizeNodeError(summary.shortError);
          return (
            <div className="border-t border-red-900/30 px-2 py-1.5">
              <p className="whitespace-pre-wrap break-words text-[11px] leading-snug text-red-300">
                {message}
              </p>
              {suggestion && (
                <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">
                  {suggestion}
                </p>
              )}
            </div>
          );
        })()}
        {/* Footer: Open Run + Retry */}
        {(showRunLink || showRetry) && (
          <div className="flex items-center gap-2 border-t border-neutral-800/80 px-2 py-1.5">
            {showRunLink && (
              <Link
                href={runHref!}
                className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Open Run
              </Link>
            )}
            {showRunLink && showRetry && (
              <span className="text-neutral-700 select-none">·</span>
            )}
            {showRetry && (
              <button
                type="button"
                onClick={() => void useWorkflowStore.getState().runWorkflow()}
                className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                title="Retry — re-runs the full workflow"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Suggestions section ──

function SuggestionsSection({ node }: { node: WorkflowNode }) {
  // Subscribe to stable primitives; build graph in useMemo to avoid returning a
  // new object literal from inside the selector (triggers "getSnapshot should be
  // cached" warning and unnecessary re-renders in React strict mode).
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const graph = useMemo(
    () => useWorkflowStore.getState().getWorkflowGraph(),
    // nodes/edges are replaced by reference on every store mutation, so this
    // recomputes only when the actual graph data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges],
  );
  const suggestions = getSuggestions(node, graph);

  if (suggestions.length === 0) return null;

  return (
    <div className="mx-3 mt-4 mb-1">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Suggestions
      </h4>
      <div className="flex flex-col gap-1">
        {suggestions.map((s: Suggestion) => (
          <button
            key={s.id}
            type="button"
            onClick={s.action}
            className="flex w-full flex-col gap-0.5 rounded-md border border-neutral-800 bg-neutral-900/60 px-2.5 py-2 text-left hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0 text-blue-400" aria-hidden="true">
                <path d="M5 1v4M5 7.5v.5" />
                <circle cx="5" cy="5" r="4" />
              </svg>
              {s.label}
            </span>
            {s.description && (
              <span className="text-[11px] leading-relaxed text-neutral-500">{s.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Latest Output section (Config tab) ──

function LatestOutputSection({ node }: { node: WorkflowNode }) {
  const output = useWorkflowStore((s) => s.latestOutputsByNode?.[node.id] ?? null);
  const workflowId = useWorkflowStore((s) => s.meta?.id ?? null);
  const insertNodes = useWorkflowStore((s) => s.insertNodes);
  const isStale = useWorkflowStore((s) => s.staleNodeIds[node.id] === true);

  const handleUseInCanvas = useCallback(() => {
    if (!output) return;

    let newNode: ReturnType<typeof createWorkflowNode> | null = null;
    let sourcePortId: string | null = null;
    let sourcePortType: string | null = null;

    if (output.outputType === "image" && output.imageUrl) {
      newNode = createWorkflowNode(imageInputNode, {
        x: node.position.x - 320,
        y: node.position.y,
      });
      newNode.data.params.source = output.imageUrl;
      newNode.data.label =
        output.imageFilename?.replace(/\.[^.]+$/, "") || "Image Input";
      if (output.artifactPath) {
        newNode.data.params.__provenance = {
          runId: output.runId,
          artifactPath: output.artifactPath,
        };
      }
      sourcePortId = "image_out";
      sourcePortType = "image";
    } else if (output.outputType === "text" && output.textFull) {
      newNode = createWorkflowNode(promptTemplateNode, {
        x: node.position.x - 320,
        y: node.position.y,
      });
      newNode.data.params.template = output.textFull;
      newNode.data.label = "Prompt";
      sourcePortId = "text_out";
      sourcePortType = "text";
    }

    if (!newNode || !sourcePortId || !sourcePortType) return;

    // Auto-connect when there is exactly one compatible input on the selected node.
    let edge: WorkflowEdge | null = null;
    const compatInputId = findCompatibleInputPort(sourcePortType, node.inputs);
    if (compatInputId) {
      edge = {
        id: crypto.randomUUID(),
        source: newNode.id,
        sourceHandle: sourcePortId,
        target: node.id,
        targetHandle: compatInputId,
      };
    }

    // Single undo step: node + optional edge together.
    insertNodes([newNode], edge ? [edge] : []);
  }, [output, node.position, node.id, node.inputs, insertNodes]);

  if (!output) return null;

  const runHref =
    workflowId ? `/workflows/${workflowId}/history/${output.runId}` : null;

  return (
    <div className="mx-3 mt-4 mb-1">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Latest Output
        {isStale && (
          <span className="normal-case font-normal text-amber-500/80 tracking-normal">(outdated)</span>
        )}
      </h4>
      <div className="rounded border border-neutral-800 bg-neutral-900/60 overflow-hidden">
        {/* Image preview */}
        {output.outputType === "image" && output.imageUrl && (
          <div className="p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={output.imageUrl}
              alt={output.imageFilename ?? "output"}
              className="w-full rounded object-contain bg-neutral-800/40"
              style={{ maxHeight: "9rem" }}
            />
          </div>
        )}
        {/* Video preview */}
        {output.outputType === "video" && output.videoUrl && (
          <div className="p-2">
            <video
              src={output.videoUrl}
              controls
              playsInline
              className="w-full rounded bg-neutral-900"
              style={{ maxHeight: "9rem" }}
            />
          </div>
        )}
        {/* Text snippet */}
        {output.outputType === "text" && output.textSnippet && (
          <pre className="px-2 py-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-300 font-mono max-h-24 overflow-y-auto">
            {output.textSnippet}
          </pre>
        )}
        {/* JSON / unknown summary */}
        {(output.outputType === "json" || output.outputType === "unknown") &&
          output.summary && (
            <div className="px-2 py-1.5 text-[11px] text-neutral-500">
              {output.summary}
            </div>
          )}
        {/* Quick actions */}
        {(() => {
          const canInsert =
            (output.outputType === "image" && !!output.imageUrl) ||
            (output.outputType === "text" && !!output.textFull);
          if (!runHref && !canInsert) return null;
          return (
            <div className="flex items-center gap-2 border-t border-neutral-800/80 px-2 py-1.5">
              {runHref && (
                <Link
                  href={runHref}
                  className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Open Run
                </Link>
              )}
              {canInsert && (
                <>
                  {runHref && (
                    <span className="text-neutral-700 select-none">·</span>
                  )}
                  <button
                    type="button"
                    onClick={handleUseInCanvas}
                    className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Use in Canvas
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Ports tab ──

function PortsTab({ node }: { node: WorkflowNode }) {
  return (
    <div className="flex flex-col gap-4 p-3">
      {node.inputs.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-neutral-400 mb-2">Inputs</h4>
          <div className="flex flex-col gap-1">
            {node.inputs.map((port) => (
              <div key={port.id} className="flex items-center gap-2 text-xs">
                <PortDot type={port.type} />
                <span className="text-neutral-300">{port.name}</span>
                <span className="text-neutral-600">({port.type})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {node.outputs.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-neutral-400 mb-2">Outputs</h4>
          <div className="flex flex-col gap-1">
            {node.outputs.map((port) => (
              <div key={port.id} className="flex items-center gap-2 text-xs">
                <PortDot type={port.type} />
                <span className="text-neutral-300">{port.name}</span>
                <span className="text-neutral-600">({port.type})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {node.inputs.length === 0 && node.outputs.length === 0 && (
        <p className="text-xs text-neutral-500 italic">This node has no ports.</p>
      )}
    </div>
  );
}

// ── Run tab ──


const STATUS_COLORS: Record<string, string> = {
  pending:   "text-neutral-400",
  queued:    "text-yellow-400",
  running:   "text-blue-400",
  completed: "text-green-400",
  failed:    "text-red-400",
  cancelled: "text-neutral-500",
};


function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function RunTab({ node }: { node: WorkflowNode }) {
  const info = useWorkflowStore((state) => {
    if (!state.debugSnapshot) return null;
    return state.debugSnapshot.nodes.find((n) => n.nodeId === node.id) ?? null;
  });
  const workflowId = useWorkflowStore((state) => state.debugSnapshot?.workflowId ?? null);
  const runId = useWorkflowStore((state) => state.debugSnapshot?.runId ?? null);
  const addNode = useWorkflowStore((state) => state.addNode);

  const [artifact, setArtifact] = useState<ArtifactPreviewable | null>(null);

  // Insert an Image Input node pre-filled with this artifact's URL.
  // Only available for image artifacts — video has no canvas input node yet.
  const handleUseInCanvas = useCallback((url: string, filename: string) => {
    const newNode = createWorkflowNode(imageInputNode, {
      x: node.position.x - 280,
      y: node.position.y,
    });
    newNode.data.params.source = url;
    newNode.data.label = filename.replace(/\.[^.]+$/, "") || "Image Input";
    addNode(newNode);
  }, [node.position, addNode]);

  const isVideoArtifact = artifact?.mimeType?.startsWith("video/") ?? false;

  useEffect(() => {
    if (info?.status !== "completed" || !workflowId || !runId) {
      setArtifact(null);
      return;
    }
    fetch(`/api/workflows/${workflowId}/runs/${runId}/outputs`)
      .then((r) => r.ok
        ? (r.json() as Promise<{ outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }> }>)
        : Promise.resolve({ outputs: [] }))
      .then(({ outputs }) => {
        const nodeOutputs = outputs.find((o) => o.nodeId === node.id)?.outputs;
        if (!nodeOutputs) { setArtifact(null); return; }
        const vals = Object.values(nodeOutputs);
        const imageRef = vals.flatMap((v) => extractImageRefs(v))[0] ?? null;
        const videoRef = vals.flatMap((v) => extractVideoRefs(v))[0] ?? null;
        const ref = imageRef ?? videoRef;
        if (!ref) { setArtifact(null); return; }
        setArtifact({
          modelId: node.id,
          modelName: node.data.label,
          outputUrl: `/api/artifacts?path=${encodeURIComponent(ref.path)}`,
          filename: ref.filename,
          mimeType: ref.mimeType,
          sizeBytes: ref.sizeBytes,
          cost: info.cost,
          durationMs: info.durationMs,
        });
      })
      .catch(() => setArtifact(null));
  }, [info?.status, info?.cost, info?.durationMs, workflowId, runId, node.id, node.data.label]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Execution section */}
      {info ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Execution</h4>
          <div className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px]">
            <MetaRow label="Status">
              <span className={STATUS_COLORS[info.status] ?? "text-neutral-400"}>
                {info.status.charAt(0).toUpperCase() + info.status.slice(1)}
              </span>
            </MetaRow>
            {info.durationMs !== undefined && (
              <MetaRow label="Duration">
                <span className="text-neutral-300">{formatDuration(info.durationMs)}</span>
              </MetaRow>
            )}
            {info.cost !== undefined && info.cost > 0 && (
              <MetaRow label="Cost">
                <span className="text-neutral-300">{formatCost(info.cost)}</span>
              </MetaRow>
            )}
            {info.attempt > 1 && (
              <MetaRow label="Attempts">
                <span className="text-neutral-300">{info.attempt}</span>
              </MetaRow>
            )}
            {info.providerId && (
              <MetaRow label="Provider">
                <span className="font-mono text-neutral-300">{info.providerId}</span>
              </MetaRow>
            )}
            {info.modelId && (
              <MetaRow label="Model">
                <span className="break-all font-mono text-neutral-300">{info.modelId}</span>
              </MetaRow>
            )}
          </div>
          {info.error && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-red-500/70">Error</span>
              <pre className="whitespace-pre-wrap break-words rounded border border-red-900/40 bg-red-950/30 p-2 font-mono text-[10px] leading-tight text-red-300">
                {info.error}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs italic text-neutral-500">
          No active run — select a node during a live run to see execution details.
          Last run summary is in the Config tab.
        </p>
      )}

      {/* Artifact preview */}
      {artifact && (
        <ArtifactPreviewPanel
          result={artifact}
          label="Node output"
          highlighted={false}
          onUseInCanvas={isVideoArtifact ? undefined : handleUseInCanvas}
        />
      )}

      {/* Node configuration metadata */}
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Node</h4>
        <div className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px]">
          <MetaRow label="ID">
            <span className="break-all font-mono text-neutral-400">{node.id}</span>
          </MetaRow>
          <MetaRow label="Type">
            <span className="text-neutral-400">{node.type}</span>
          </MetaRow>
          <MetaRow label="Retry limit">
            <span className="text-neutral-400">{node.data.retryCount as number}</span>
          </MetaRow>
          <MetaRow label="Timeout">
            <span className="text-neutral-400">{((node.data.timeoutMs as number) / 1000).toFixed(0)}s</span>
          </MetaRow>
        </div>
      </div>
    </div>
  );
}

// ── Port color dot ──

const PORT_COLORS: Record<string, string> = {
  image: "bg-purple-500",
  video: "bg-orange-500",
  text: "bg-green-500",
  number: "bg-blue-500",
  json: "bg-yellow-500",
};

function PortDot({ type }: { type: string }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${PORT_COLORS[type] ?? "bg-neutral-500"}`} />
  );
}

// ── Preset bar ──

interface NodePreset {
  id: string;
  name: string;
  nodeType: string;
  params: Record<string, unknown>;
  createdAt: string;
}

function PresetBar({ node, onParamChange }: { node: WorkflowNode; onParamChange: (nodeId: string, key: string, value: unknown) => void }) {
  const [presets, setPresets] = useState<NodePreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [nameInputOpen, setNameInputOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // per-preset mutation state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSavingId, setRenameSavingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // keyboard navigation
  const [focusedIdx, setFocusedIdx] = useState(0);
  const chipRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Load presets for this node type
  useEffect(() => {
    fetch(`/api/node-presets?nodeType=${encodeURIComponent(node.type)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: NodePreset[]) => { setPresets(data); setFocusedIdx(0); })
      .catch(() => {/* silent */});
  }, [node.type]);

  // Focus the active chip when focusedIdx changes (skip while rename input is open)
  useEffect(() => {
    if (nameInputOpen || renamingId !== null) return;
    chipRefs.current[focusedIdx]?.focus();
  }, [focusedIdx, nameInputOpen, renamingId]);

  // Clamp focusedIdx when the preset list shrinks after a delete
  useEffect(() => {
    if (presets.length > 0) {
      setFocusedIdx((i) => Math.min(i, presets.length - 1));
    }
  }, [presets.length]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleSave = useCallback(async () => {
    const trimmed = savingName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/node-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, nodeType: node.type, params: node.data.params }),
      });
      if (!res.ok) return;
      const created: NodePreset = await res.json();
      setPresets((prev) => [...prev, created]);
      setSaved(true);
      setSavingName("");
      setNameInputOpen(false);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }, [savingName, node.type, node.data.params]);

  const handleApply = useCallback((preset: NodePreset) => {
    for (const [key, value] of Object.entries(preset.params)) {
      onParamChange(node.id, key, value);
    }
  }, [node.id, onParamChange]);

  const handleRenameCommit = useCallback(async (presetId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    setRenameSavingId(presetId);
    try {
      const res = await fetch(`/api/node-presets/${presetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) return;
      setPresets((prev) => prev.map((p) => (p.id === presetId ? { ...p, name: trimmed } : p)));
      setRenamingId(null);
    } finally {
      setRenameSavingId(null);
    }
  }, [renameValue]);

  const handleDeleteConfirm = useCallback(async (presetId: string) => {
    setDeletingId(presetId);
    setConfirmingDeleteId(null);
    try {
      await fetch(`/api/node-presets/${presetId}`, { method: "DELETE" });
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
    } finally {
      setDeletingId(null);
    }
  }, []);

  // Keyboard handler for the chips container
  const handleChipsKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // While rename input is active: only Escape cancels (input handles its own keys)
    if (renamingId !== null) {
      if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
      return;
    }
    // While confirming delete: only Escape cancels
    if (confirmingDeleteId !== null) {
      if (e.key === "Escape") { e.preventDefault(); setConfirmingDeleteId(null); }
      return;
    }

    const preset = presets[focusedIdx] ?? null;
    const busy = preset ? (deletingId === preset.id || renameSavingId === preset.id) : false;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, presets.length - 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) break;
        if (preset && !busy) { e.preventDefault(); handleApply(preset); }
        break;
      case "r":
        if (e.target instanceof HTMLInputElement) break;
        if (preset && !busy) {
          e.preventDefault();
          setConfirmingDeleteId(null);
          setRenamingId(preset.id);
          setRenameValue(preset.name);
        }
        break;
      case "Delete":
      case "Backspace":
        if (e.target instanceof HTMLInputElement) break;
        if (preset && !busy) {
          e.preventDefault();
          setRenamingId(null);
          setConfirmingDeleteId(preset.id);
        }
        break;
      case "Escape":
        e.preventDefault();
        // Mutations already handled above; nothing to close (not a modal)
        break;
    }
  }, [renamingId, confirmingDeleteId, presets, focusedIdx, deletingId, renameSavingId, handleApply]);

  return (
    <div className="border-b border-neutral-800 px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        {presets.length > 0 && (
          <select
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) handleApply(preset);
              e.target.value = "";
            }}
            defaultValue=""
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-300 outline-none cursor-pointer"
          >
            <option value="" disabled>Apply preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        {nameInputOpen ? (
          <>
            <input
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setNameInputOpen(false); }}
              placeholder="Preset name"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-blue-500 w-28"
            />
            <button
              onClick={handleSave}
              disabled={saving || !savingName.trim()}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:text-neutral-600"
            >
              {saved ? "Saved!" : saving ? "…" : "Save"}
            </button>
            <button onClick={() => setNameInputOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-400">
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setNameInputOpen(true)}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            + Save as Preset
          </button>
        )}
        {presets.length > 0 && !nameInputOpen && (
          <>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div className="ml-auto flex flex-wrap gap-x-2 gap-y-1 outline-none" onKeyDown={handleChipsKeyDown}>
              {presets.map((p, idx) => {
                const isRenaming = renamingId === p.id;
                const isConfirming = confirmingDeleteId === p.id;
                const isDeleting = deletingId === p.id;
                const isSaving = renameSavingId === p.id;
                const isFocused = focusedIdx === idx && renamingId === null;

                if (isRenaming) {
                  return (
                    <span key={p.id} className="flex items-center gap-1">
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRenameCommit(p.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        disabled={isSaving}
                        className="w-20 rounded border border-neutral-600 bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-100 outline-none focus:border-neutral-400"
                      />
                      <button
                        onClick={() => void handleRenameCommit(p.id)}
                        disabled={isSaving || !renameValue.trim()}
                        className="text-[10px] text-neutral-300 hover:text-neutral-100 disabled:text-neutral-600"
                      >
                        {isSaving ? "…" : "✓"}
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        disabled={isSaving}
                        className="text-[10px] text-neutral-600 hover:text-neutral-400"
                      >
                        ✕
                      </button>
                    </span>
                  );
                }

                if (isConfirming) {
                  return (
                    <span key={p.id} className="flex items-center gap-1 text-[10px]">
                      <span className="text-red-400">{p.name}?</span>
                      <button
                        onClick={() => void handleDeleteConfirm(p.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        className="text-neutral-600 hover:text-neutral-400"
                      >
                        No
                      </button>
                    </span>
                  );
                }

                if (isDeleting) {
                  return (
                    <span key={p.id} className="text-[10px] text-neutral-600">…</span>
                  );
                }

                return (
                  <span
                    key={p.id}
                    ref={(el) => { chipRefs.current[idx] = el; }}
                    tabIndex={0}
                    onFocus={() => setFocusedIdx(idx)}
                    className={[
                      "flex items-center gap-0.5 rounded outline-none",
                      isFocused ? "ring-1 ring-neutral-600" : "",
                    ].join(" ")}
                  >
                    <button
                      onClick={() => { setConfirmingDeleteId(null); setRenamingId(p.id); setRenameValue(p.name); }}
                      title={`Rename preset "${p.name}"`}
                      className="text-[10px] text-neutral-500 hover:text-neutral-300"
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => { setRenamingId(null); setConfirmingDeleteId(p.id); }}
                      title={`Delete preset "${p.name}"`}
                      className="text-[10px] text-neutral-600 hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="w-full flex gap-2 mt-0.5">
              {["↑↓ navigate", "Enter apply", "r rename", "Del delete"].map((hint) => (
                <span key={hint} className="text-[9px] text-neutral-700">{hint}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
