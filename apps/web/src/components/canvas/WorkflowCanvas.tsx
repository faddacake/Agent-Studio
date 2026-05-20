"use client";

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, Component, type ReactNode, type KeyboardEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Connection, Edge, Node, OnBeforeDelete } from "@xyflow/react";
import type { WorkflowNode, WorkflowGraph } from "@iterastudio/shared";
import { nodeRegistry, isArtifactRef, type NodeDefinition } from "@iterastudio/shared";
import type { WorkflowEdge } from "@iterastudio/shared";
import { extractImageRefs, extractVideoRefs } from "@/lib/artifactRefs";
import { useWorkflowStore, fromFlowNode } from "@/stores/workflowStore";
import { filterPresets } from "@/lib/presets";
import type { Preset } from "@/lib/presets";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
import { createWorkflowNode } from "./createWorkflowNode";
import { useRunEvents } from "@/hooks/useRunEvents";
import { isConnectionValid } from "@/lib/connectionValidation";
import { NodePalette } from "./NodePalette";
import { TemplatePicker } from "./TemplatePicker";
const WorkflowEmptyState = lazy(() =>
  import("./WorkflowEmptyState").then((m) => ({ default: m.WorkflowEmptyState }))
);
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { SaveRevisionDialog } from "./SaveRevisionDialog";
import { SaveFragmentDialog } from "./SaveFragmentDialog";
import { FragmentBrowser } from "@/components/fragments/FragmentBrowser";
import { CustomNode } from "./CustomNode";
import { AgentNode } from "./AgentNode";
import { ObsidianMemoryNode } from "./ObsidianMemoryNode";
import { ConfirmReplaceDialog } from "./ConfirmReplaceDialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { InspectorPanel } from "@/components/inspector";
import { RunDebuggerPanel, RunOutputsPanel } from "@/components/debugger";
import { buildOutputsMap } from "@/lib/runOutputs";
import { buildNodeRunStatesMap, TERMINAL_RUN_STATUSES } from "@/lib/nodeRunState";
import { buildExecutionSummaryMap } from "@/lib/nodeExecutionSummary";
import { requestAutoRun, onAutoRunComplete } from "@/lib/runQueue";
import { deriveWorkflowHealth, hasHealthSignals, type WorkflowHealthSummary } from "@/lib/workflowHealth";
import { deriveExecutionPath } from "@/lib/executionPath";
import { useBudgetSettings } from "@/hooks/useBudgetSettings";
import { BudgetWarningModal } from "@/components/editor/BudgetWarningModal";
import { BudgetSettingsPanel } from "@/components/settings/BudgetSettingsPanel";
import { SchedulePanel } from "./SchedulePanel";

// ── Node types map (stable reference) ──

const nodeTypes: NodeTypes = {
  custom:            CustomNode,
  "react-agent":     AgentNode,
  "obsidian-memory": ObsidianMemoryNode,
};

// ── Run-status dot colors (mirrors list-page RUN_DOT_COLOR) ──

const RUN_STATUS_COLOR: Record<string, string> = {
  completed:       "#4ade80",
  running:         "#60a5fa",
  failed:          "#f87171",
  partial_failure: "#f87171",
  cancelled:       "#737373",
  budget_exceeded: "#facc15",
  pending:         "#facc15",
};

function formatRunTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Module-level constants ──

const TERMINAL_BADGE: Record<string, { label: string; colorClass: string }> = {
  completed:       { label: "✓ Completed",       colorClass: "border-emerald-600 bg-emerald-600/10 text-emerald-400" },
  failed:          { label: "✗ Failed",           colorClass: "border-red-600 bg-red-600/10 text-red-400" },
  partial_failure: { label: "✗ Partial Failure",  colorClass: "border-red-600 bg-red-600/10 text-red-400" },
  cancelled:       { label: "— Cancelled",        colorClass: "border-yellow-500 bg-yellow-500/10 text-yellow-400" },
  budget_exceeded: { label: "— Budget Exceeded",  colorClass: "border-yellow-500 bg-yellow-500/10 text-yellow-400" },
};

// ── Error boundary: isolates WorkflowEmptyState failures from the canvas ──

class EmptyStateBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.hasError ? null : this.props.children; }
}

// ── Inner canvas (needs ReactFlowProvider ancestor) ──

function CanvasInner({ initialArtifactPath, initialRunId, initialFragmentId }: { initialArtifactPath?: string; initialRunId?: string; initialFragmentId?: string }) {
  const {
    nodes,
    edges,
    meta,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectedNodeId,
    paletteOpen,
    inspectorOpen,
    debuggerOpen,
    templatePickerOpen,
    saveAsTemplateOpen,
    debugSnapshot,
    currentRunId,
    replayRunId,
    dirty,
    saving,
    isRunning,
    addNode,
    duplicateNode,
    insertNodes,
    selectNode,
    updateNodeParam,
    loadWorkflow,
    togglePalette,
    toggleDebugger,
    toggleTemplatePicker,
    toggleSaveAsTemplate,
    saveGraph,
    runWorkflow,
    updateMetaName,
    getWorkflowGraph,
    pushHistory,
    undo,
    redo,
    historyStack,
    redoStack,
    updateMetaRunStatus,
    setReplayRunId,
    insertFragment,
    autoRunEnabled,
    paramEditSeq,
    setAutoRunEnabled,
    setLatestOutputsByNode,
    clearStaleNodes,
    setNodeRunStates,
    clearNodeRunStates,
    setLatestExecutionByNode,
    clearLatestExecutionByNode,
    autoRunPending,
    autoRunQueued,
    setAutoRunPending,
    setAutoRunQueued,
    setAutoRunInFlight,
    staleNodeIds,
    nodeRunStatesById,
  } = useWorkflowStore();

  const canUndo = historyStack.length > 0;
  const canRedo = redoStack.length > 0;

  // ── Budget settings + pre-run cost check ─────────────────────────────────
  const { budgetCap, setBudgetCap } = useBudgetSettings();
  const [budgetWarning, setBudgetWarning] = useState<{ estimatedCost: number } | null>(null);
  const [budgetPanelOpen, setBudgetPanelOpen] = useState(false);
  const budgetBtnRef = useRef<HTMLButtonElement | null>(null);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false);
  const scheduleBtnRef = useRef<HTMLButtonElement | null>(null);
  const [scheduleActive, setScheduleActive] = useState(false);
  const [emptyStateDismissed, setEmptyStateDismissed] = useState(false);

  // ── Schedule active state — drives indicator on Schedule button ──────────
  // Fetches once when the workflow loads; updated in real-time via SchedulePanel.
  useEffect(() => {
    if (!meta?.id) return;
    fetch(`/api/workflows/${meta.id}/schedule`)
      .then((r) => r.ok ? r.json() : { schedule: null })
      .then((data: { schedule: { enabled?: boolean } | null }) => {
        setScheduleActive(data.schedule?.enabled === true);
      })
      .catch(() => {});
  }, [meta?.id]);

  // ── Provider availability check ───────────────────────────────────────────
  // Re-checked on focus/visibility so that adding a provider in another tab
  // immediately re-enables the Run button when the user returns to the canvas.
  // Default true so the Run button starts disabled until the fetch resolves,
  // avoiding a green flash → disabled transition on the no-provider first-visit path.
  const [hasNoProviders, setHasNoProviders] = useState(true);
  useEffect(() => {
    function checkProviders() {
      fetch("/api/providers")
        .then((r) => r.ok ? r.json() : [])
        .then((rows: unknown[]) => setHasNoProviders(rows.length === 0))
        .catch(() => setHasNoProviders(false));
    }
    checkProviders();
    function onVisibility() { if (document.visibilityState === "visible") checkProviders(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkProviders);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkProviders);
    };
  }, []);

  const handleRun = useCallback(() => {
    // Estimate cost from node definitions (registry must be initialized — idempotent).
    initializeNodeRegistry();
    let estimated = 0;
    for (const node of nodes) {
      const nodeType = (node.data as { nodeType?: string }).nodeType ?? "";
      const def = nodeRegistry.get(nodeType);
      if (def?.estimateCost) {
        const params = (node.data as { params?: Record<string, unknown> }).params ?? {};
        estimated += def.estimateCost(params).estimated;
      }
    }
    if (estimated > budgetCap) {
      setBudgetWarning({ estimatedCost: estimated });
      return;
    }
    void runWorkflow({ budgetCap });
  }, [nodes, budgetCap, runWorkflow]);

  // ── Execution-path edge styling ──────────────────────────────────────────
  // While a run is live, emphasize edges along the active execution path.
  // Returns the unmodified edge list when no run is active (zero overhead).
  const styledEdges = useMemo(() => {
    if (debugSnapshot?.status !== "running") return edges;
    const path = deriveExecutionPath(debugSnapshot.nodes, edges);
    return edges.map((edge) => {
      if (path.activeFeedEdgeIds.has(edge.id)) {
        // Blue animated feed: data flowing into the currently-running node
        return { ...edge, animated: true,  style: { stroke: "#60a5fa", strokeWidth: 2.5 } };
      }
      if (path.completedPathEdgeIds.has(edge.id)) {
        // Green static trace: path already traversed this run
        return { ...edge, animated: false, style: { stroke: "#4ade80", strokeWidth: 1.5, opacity: 0.65 } };
      }
      // Unreached — dim during active run so path pops visually
      return { ...edge, animated: false, style: { stroke: "#3a3a3a", strokeWidth: 1 } };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, debugSnapshot]);

  // ── Workflow health summary ───────────────────────────────────────────────
  const health = useMemo<WorkflowHealthSummary>(() =>
    deriveWorkflowHealth({
      nodeRunStatesById,
      staleNodeIds,
      liveRunStatus: debugSnapshot?.status,
      autoRunPending,
      autoRunQueued,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeRunStatesById, staleNodeIds, debugSnapshot?.status, autoRunPending, autoRunQueued],
  );

  // ── Artifact → Canvas insertion (refs declared here; effect placed after screenToFlowPosition) ──
  const router = useRouter();
  const pathname = usePathname();
  const insertedRef = useRef(false); // prevent double-insertion in React StrictMode

  // ── Debug panel tab ───────────────────────────────────────────────────────
  const [activeDebugTab, setActiveDebugTab] = useState<"nodes" | "outputs">("nodes");

  // ── Template refresh key — incremented after a successful Save as Template ──
  const [templateRefreshKey, setTemplateRefreshKey] = useState(0);

  // ── Template load sequence — incremented to trigger fitView after load ────
  const [templateLoadSeq, setTemplateLoadSeq] = useState(0);
  const templateLoadMountedRef = useRef(false);

  // ── Post-run artifacts — drives floating "Send to Video Editor" FAB ───────
  const [postRunArtifacts, setPostRunArtifacts] = useState<
    Array<{ type: "image" | "video"; path: string }>
  >([]);
  const [sendingFromCanvas, setSendingFromCanvas] = useState(false);

  // ── Slash command menu ────────────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const slashInputRef = useRef<HTMLInputElement>(null);
  const slashListRef = useRef<HTMLUListElement>(null);

  type SlashItem = { kind: "preset"; preset: Preset } | { kind: "node"; def: NodeDefinition };

  const slashItems = useMemo<SlashItem[]>(() => {
    if (!slashOpen) return [];
    initializeNodeRegistry();
    const q = slashQuery.toLowerCase().trim();
    const presetItems: SlashItem[] = filterPresets(q).map((preset) => ({ kind: "preset", preset }));
    const all = nodeRegistry.getAvailable();
    const nodeItems: SlashItem[] = (
      q
        ? all.filter(
            (d) =>
              d.label.toLowerCase().includes(q) ||
              d.description.toLowerCase().includes(q) ||
              d.type.toLowerCase().includes(q),
          )
        : all
    ).map((def) => ({ kind: "node", def }));
    return [...presetItems, ...nodeItems];
  }, [slashOpen, slashQuery]);

  // Keep highlighted index in range when results change
  useEffect(() => {
    setSlashIdx((i) => Math.min(i, Math.max(0, slashItems.length - 1)));
  }, [slashItems.length]);

  // Auto-focus input when menu opens
  useEffect(() => {
    if (slashOpen) {
      setTimeout(() => slashInputRef.current?.focus(), 0);
    }
  }, [slashOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    const el = slashListRef.current?.children[slashIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [slashIdx]);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashIdx(0);
  }, []);

  // selectSlashNode / selectSlashPreset — defined after screenToFlowPosition (see below)
  const selectSlashNodeRef = useRef<((def: NodeDefinition) => void) | null>(null);
  const selectSlashPresetRef = useRef<((preset: Preset) => void) | null>(null);

  const handleSlashKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSlash();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = slashItems[slashIdx];
        if (!item) return;
        if (item.kind === "preset") selectSlashPresetRef.current?.(item.preset);
        else selectSlashNodeRef.current?.(item.def);
      }
    },
    [slashItems, slashIdx, closeSlash],
  );

  // ── Inline workflow rename ────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const handleStartRename = useCallback(() => {
    setNameInput(meta?.name ?? "");
    setEditingName(true);
  }, [meta?.name]);

  const handleCommitRename = useCallback(async () => {
    const trimmed = nameInput.trim();
    setEditingName(false);
    if (!trimmed || !meta || trimmed === meta.name) return;
    const previous = meta.name;
    updateMetaName(trimmed);
    try {
      const res = await fetch(`/api/workflows/${meta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      updateMetaName(previous);
    }
  }, [nameInput, meta, updateMetaName]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.currentTarget.blur(); }
      if (e.key === "Escape") { setEditingName(false); }
    },
    [],
  );

  // ── Save revision ─────────────────────────────────────────────────────────
  const [saveRevisionOpen, setSaveRevisionOpen] = useState(false);

  // ── Fragment save / insert ────────────────────────────────────────────────
  const [saveFragmentOpen, setSaveFragmentOpen] = useState(false);
  const [fragmentBrowserOpen, setFragmentBrowserOpen] = useState(false);
  const { getNodes } = useReactFlow();

  const getSelectedFragment = useCallback((): import("@iterastudio/shared").WorkflowGraph => {
    const selected = getNodes().filter((n) => n.selected);
    const selectedIds = new Set(selected.map((n) => n.id));
    const selectedEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    return {
      version: 1,
      nodes: selected.map((n) => fromFlowNode(n)),
      edges: selectedEdges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? "",
        target: e.target,
        targetHandle: e.targetHandle ?? "",
      })),
    };
  }, [getNodes, edges]);

  const handleInsertFragmentGraph = useCallback(
    (graph: import("@iterastudio/shared").WorkflowGraph) => {
      insertFragment(graph, 120, 120);
    },
    [insertFragment],
  );

  // ── Fragment insertion from URL param (?insertFragment=<id>) ─────────────
  // Fires once on mount when navigating here from the Library page.
  const fragmentInsertedRef = useRef(false);
  useEffect(() => {
    if (!initialFragmentId || fragmentInsertedRef.current) return;
    fragmentInsertedRef.current = true;
    fetch("/api/fragments")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: Array<{ id: string; graph: import("@iterastudio/shared").WorkflowGraph }> | null) => {
        if (!list) return;
        const match = list.find((f) => f.id === initialFragmentId);
        if (match) insertFragment(match.graph, 120, 120);
      })
      .catch(() => { /* silent */ });
    router.replace(pathname);
  }, [initialFragmentId, insertFragment, router, pathname]);

  // ── Export workflow ───────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!meta?.id || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/workflows/${meta.id}/export`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `${meta.name}.workflow.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [meta, exporting]);

  // Subscribe to SSE run events — updates debugSnapshot in the store,
  // which drives the status dots on CustomNode and the RunDebuggerPanel.
  useRunEvents(meta?.id ?? "", currentRunId);

  // ── Run-complete badge ────────────────────────────────────────────────────
  // Shows briefly next to the Run Workflow button when a run reaches a
  // terminal status, then auto-dismisses after 3 s.

  const [runBadge, setRunBadge] = useState<{
    label: string;
    colorClass: string;
  } | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect transition to terminal status → show badge + update meta run status.
  // On "completed", open the debugger panel and switch to the Outputs tab so the
  // "Send to Video Editor" button is immediately visible without extra clicks.
  useEffect(() => {
    const status = debugSnapshot?.status;
    if (!status) return;
    const badge = TERMINAL_BADGE[status];
    if (!badge) return;

    setRunBadge(badge);
    updateMetaRunStatus(status, new Date().toISOString());
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = setTimeout(() => {
      setRunBadge(null);
      badgeTimerRef.current = null;
    }, 3000);

    if (status === "completed") {
      // Surface outputs automatically — open debugger if closed, switch to Outputs tab.
      if (!debuggerOpen) toggleDebugger();
      setActiveDebugTab("outputs");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugSnapshot?.status]);

  // New run started → dismiss badge immediately
  useEffect(() => {
    if (!isRunning) return;
    setRunBadge(null);
    if (badgeTimerRef.current) {
      clearTimeout(badgeTimerRef.current);
      badgeTimerRef.current = null;
    }
  }, [isRunning]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
  }, []);

  // ── Latest Outputs — populate Inspector config-tab preview ───────────────

  // After a run completes (fully or partially): cache per-node outputs for the
  // Inspector and clear all stale indicators. partial_failure means the workflow
  // executed — some nodes may have produced output — so stale marks are now stale
  // data about a pre-run state and should be cleared just as for a full completion.
  // On "completed" also extract artifact refs to drive the floating FAB.
  useEffect(() => {
    const snapshot = debugSnapshot;
    if (!snapshot) return;
    const { status } = snapshot;
    if (status !== "completed" && status !== "partial_failure") return;
    clearStaleNodes();
    const wfId = snapshot.workflowId;
    const rId = snapshot.runId;
    if (!wfId || !rId) return;
    fetch(`/api/workflows/${wfId}/runs/${rId}/outputs`)
      .then((r) => r.ok ? (r.json() as Promise<{ outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }> }>) : null)
      .then((data) => {
        if (!data?.outputs) return;
        setLatestOutputsByNode(buildOutputsMap(data.outputs, rId, wfId));

        if (status === "completed") {
          const artifacts: Array<{ type: "image" | "video"; path: string }> = [];
          for (const { outputs } of data.outputs) {
            for (const value of Object.values(outputs)) {
              if (isArtifactRef(value)) {
                if (value.mimeType.startsWith("image/")) artifacts.push({ type: "image", path: value.path });
                else if (value.mimeType.startsWith("video/")) artifacts.push({ type: "video", path: value.path });
              } else {
                for (const ref of extractImageRefs(value)) artifacts.push({ type: "image", path: ref.path });
                for (const ref of extractVideoRefs(value)) artifacts.push({ type: "video", path: ref.path });
              }
            }
          }
          setPostRunArtifacts(artifacts);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugSnapshot?.status]);

  // When a run reaches any terminal status, snapshot the per-node states so
  // CustomNode badges persist after debugSnapshot is cleared on the next run.
  // Also persist execution summaries for the Inspector "Last Run" section.
  useEffect(() => {
    const status = debugSnapshot?.status;
    if (!status || !TERMINAL_RUN_STATUSES.has(status)) return;
    if (!debugSnapshot.nodes?.length) return;
    setNodeRunStates(buildNodeRunStatesMap(debugSnapshot.nodes));
    setLatestExecutionByNode(buildExecutionSummaryMap(debugSnapshot.nodes, debugSnapshot.runId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugSnapshot?.status]);

  // Clear persisted node run states, execution summaries, and the post-run FAB
  // when a new run starts so stale badges and buttons don't linger.
  useEffect(() => {
    if (debugSnapshot?.status !== "running") return;
    clearNodeRunStates();
    clearLatestExecutionByNode();
    setPostRunArtifacts([]);
    setSendingFromCanvas(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugSnapshot?.status]);

  // On workflow load, fetch outputs for the Inspector's "Latest Output" preview.
  // When a replay run is active, fetch that run's outputs directly — they match
  // the restored graph and are more meaningful than a different recent run.
  // Otherwise, find the most recently completed run and fetch its outputs.
  useEffect(() => {
    const id = meta?.id;
    if (!id) return;

    if (replayRunId) {
      // Replay mode: fetch the specific run being restored, regardless of lastRunStatus.
      fetch(`/api/workflows/${id}/runs/${replayRunId}/outputs`)
        .then((r) => r.ok ? (r.json() as Promise<{ outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }> }>) : null)
        .then((data) => {
          if (!data?.outputs) return;
          setLatestOutputsByNode(buildOutputsMap(data.outputs, replayRunId, id));
        })
        .catch(() => {});
    } else {
      // Normal mode: only worth fetching if at least one run has completed.
      if (!meta?.lastRunStatus) return;
      fetch(`/api/workflows/${id}/runs`)
        .then((r) => r.ok ? (r.json() as Promise<Array<{ id: string; status: string }>>) : null)
        .then((runs) => {
          const latest = runs?.find((r) => r.status === "completed");
          if (!latest) return;
          fetch(`/api/workflows/${id}/runs/${latest.id}/outputs`)
            .then((r) => r.ok ? (r.json() as Promise<{ outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }> }>) : null)
            .then((data) => {
              if (!data?.outputs) return;
              setLatestOutputsByNode(buildOutputsMap(data.outputs, latest.id, id));
            })
            .catch(() => {});
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.id, replayRunId]);

  // ── Auto-Run Downstream ───────────────────────────────────────────────────
  // Collapses rapid param edits into a single run via a 800 ms debounce.
  // Edits made while a run is in-flight are collapsed into exactly one queued run.

  const autoRunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the initial effect fire on mount (paramEditSeq = 0).
  const autoRunMountedRef = useRef(false);
  // Keep the latest enabled flag accessible inside the timer callback.
  const autoRunEnabledRef = useRef(autoRunEnabled);
  autoRunEnabledRef.current = autoRunEnabled;

  // Trigger debounce on param edits.
  // Unlike the previous version, we no longer bail out when a run is in-flight —
  // edits during a run set autoRunPending and eventually call requestAutoRun(),
  // which collapses them into a single queued follow-up run.
  useEffect(() => {
    if (!autoRunMountedRef.current) {
      autoRunMountedRef.current = true;
      return;
    }
    if (!autoRunEnabledRef.current || !meta) return;

    setAutoRunPending(true);
    if (autoRunTimerRef.current) clearTimeout(autoRunTimerRef.current);

    autoRunTimerRef.current = setTimeout(() => {
      autoRunTimerRef.current = null;
      requestAutoRun();
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramEditSeq]);

  // When auto-run is turned off: cancel any pending timer and clear all queue flags.
  useEffect(() => {
    if (!autoRunEnabled) {
      if (autoRunTimerRef.current) {
        clearTimeout(autoRunTimerRef.current);
        autoRunTimerRef.current = null;
      }
      setAutoRunPending(false);
      setAutoRunQueued(false);
      setAutoRunInFlight(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunEnabled]);

  // When a manual run starts, cancel any pending debounce timer.
  // Leave autoRunQueued intact — edits before the manual run should still
  // produce a follow-up auto-run after it finishes.
  useEffect(() => {
    if (isRunning && autoRunTimerRef.current) {
      clearTimeout(autoRunTimerRef.current);
      autoRunTimerRef.current = null;
      setAutoRunPending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // When a run completes, fire a queued auto-run if one is waiting.
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (!isRunning && wasRunningRef.current) {
      onAutoRunComplete();
    }
    wasRunningRef.current = isRunning;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Cleanup auto-run timer on unmount.
  useEffect(() => () => {
    if (autoRunTimerRef.current) clearTimeout(autoRunTimerRef.current);
  }, []);

  // Refresh last-run status when the editor regains focus / visibility,
  // so status stays current after runs triggered in other tabs/sessions.
  const lastRefreshRef = useRef<number>(0);
  useEffect(() => {
    function refresh() {
      if (!meta?.id) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < 500) return; // debounce double-fire
      lastRefreshRef.current = now;
      fetch(`/api/workflows/${meta.id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((row: { lastRunStatus?: string | null; lastRunAt?: string | null } | null) => {
          if (!row?.lastRunStatus) return;
          const current = useWorkflowStore.getState().meta;
          if (
            current &&
            (row.lastRunStatus !== current.lastRunStatus || row.lastRunAt !== current.lastRunAt)
          ) {
            updateMetaRunStatus(row.lastRunStatus, row.lastRunAt ?? new Date().toISOString());
          }
        })
        .catch(() => { /* silent — don't disrupt the editor */ });
    }
    function onVisibility() { if (document.visibilityState === "visible") refresh(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [meta?.id, updateMetaRunStatus]);

  const { screenToFlowPosition, fitView } = useReactFlow();

  // Send all post-run artifacts to the Video Editor — creates an editor project
  // and navigates there. Mirrors the logic in RunOutputsPanel but operates on
  // the canvas-level postRunArtifacts state so the FAB works independently.
  const handleSendFromCanvas = useCallback(async () => {
    if (sendingFromCanvas || postRunArtifacts.length === 0 || !currentRunId) return;
    setSendingFromCanvas(true);
    try {
      const scenes = postRunArtifacts.map((a) => ({
        id: crypto.randomUUID(),
        type: a.type,
        src: a.path,
        duration: a.type === "video" ? 10 : 5,
      }));
      const res = await fetch("/api/editor-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Run ${currentRunId.slice(0, 8)}`,
          aspectRatio: "16:9",
          scenes,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const project = (await res.json()) as { id: string };
      router.push(`/editor/${project.id}`);
    } catch {
      setSendingFromCanvas(false);
    }
  }, [sendingFromCanvas, postRunArtifacts, currentRunId, router]);

  // Wire up the slash selectors now that screenToFlowPosition is available
  const PRESET_STEP = 240;

  const selectSlashNode = useCallback(
    (def: NodeDefinition) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNode({ ...createWorkflowNode(def, position) });
      closeSlash();
    },
    [screenToFlowPosition, addNode, closeSlash],
  );
  selectSlashNodeRef.current = selectSlashNode;

  const selectSlashPreset = useCallback(
    (preset: Preset) => {
      initializeNodeRegistry();
      // Center the entire chain in the viewport
      const totalWidth = (preset.nodes.length - 1) * PRESET_STEP;
      const anchor = screenToFlowPosition({
        x: window.innerWidth / 2 - totalWidth / 2,
        y: window.innerHeight / 2,
      });

      const createdNodes = preset.nodes
        .map((pn, i) => {
          const def = nodeRegistry.get(pn.type);
          if (!def) return null;
          return createWorkflowNode(def, { x: anchor.x + i * PRESET_STEP, y: anchor.y });
        })
        .filter((n): n is NonNullable<typeof n> => n !== null);

      const createdEdges: WorkflowEdge[] = preset.edges
        .map((pe) => {
          const src = createdNodes[pe.sourceIdx];
          const tgt = createdNodes[pe.targetIdx];
          if (!src || !tgt) return null;
          return {
            id: crypto.randomUUID(),
            source: src.id,
            sourceHandle: pe.sourceHandle,
            target: tgt.id,
            targetHandle: pe.targetHandle,
          } satisfies WorkflowEdge;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      insertNodes(createdNodes, createdEdges);
      closeSlash();
    },
    [screenToFlowPosition, insertNodes, closeSlash],
  );
  selectSlashPresetRef.current = selectSlashPreset;

  // ── Artifact → Canvas insertion ───────────────────────────────────────────
  // Fires once when the canvas mounts with ?insertArtifact=<path>: creates a
  // pre-populated Image Input node at the viewport centre and removes the param.
  useEffect(() => {
    if (!initialArtifactPath || insertedRef.current) return;
    insertedRef.current = true;

    initializeNodeRegistry();
    const def = nodeRegistry.get("image-input");
    if (!def) return;

    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = createWorkflowNode(def, position);
    node.data.params.source = `/api/artifacts?path=${encodeURIComponent(initialArtifactPath)}`;
    if (initialRunId) {
      node.data.params.__provenance = { runId: initialRunId, artifactPath: initialArtifactPath };
    }
    addNode(node);

    // Remove ?insertArtifact so a page refresh does not re-insert the node.
    router.replace(pathname);
  }, [initialArtifactPath, initialRunId, screenToFlowPosition, addNode, router, pathname]);

  // Pending template load — set when dirty=true and user picks a template.
  // Cleared on cancel or after confirming the replace.
  const [pendingTemplate, setPendingTemplate] = useState<{
    graph: WorkflowGraph;
    name: string;
  } | null>(null);

  // Pending node deletion — set when the node has connected edges.
  // The resolver lets us resolve the onBeforeDelete promise from dialog actions.
  const deleteResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    nodeLabel: string;
    edgeCount: number;
  } | null>(null);

  const handleBeforeDelete: OnBeforeDelete<Node, Edge> = useCallback(
    ({ nodes: deletingNodes }) => {
      // Count edges connected to any node being deleted
      const connectedEdges = edges.filter(
        (e) => deletingNodes.some((n) => n.id === e.source || n.id === e.target),
      );

      if (connectedEdges.length === 0) return Promise.resolve(true);

      // Hold the deletion and wait for user confirmation
      const firstLabel = (deletingNodes[0]?.data?.label as string | undefined) ?? "Node";
      setPendingDelete({ nodeLabel: firstLabel, edgeCount: connectedEdges.length });

      return new Promise<boolean>((resolve) => {
        deleteResolverRef.current = resolve;
      });
    },
    [edges],
  );

  const handleConfirmDelete = useCallback(() => {
    deleteResolverRef.current?.(true);
    deleteResolverRef.current = null;
    setPendingDelete(null);
  }, []);

  const handleCancelDelete = useCallback(() => {
    deleteResolverRef.current?.(false);
    deleteResolverRef.current = null;
    setPendingDelete(null);
  }, []);

  // Find the selected workflow node for the inspector
  const selectedNode: WorkflowNode | null = useMemo(() => {
    if (!selectedNodeId) return null;
    const flowNode = nodes.find((n) => n.id === selectedNodeId);
    if (!flowNode) return null;
    return fromFlowNode(flowNode);
  }, [selectedNodeId, nodes]);

  // Add node from palette at center of viewport
  const handleAddNode = useCallback(
    (node: WorkflowNode) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNode({ ...node, position });
    },
    [addNode, screenToFlowPosition],
  );

  // Node click → select
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  // Click on pane → deselect
  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Port compatibility check — passed to ReactFlow as isValidConnection.
  // When false, ReactFlow refuses the drag and shows a red indicator.
  const handleIsValidConnection = useCallback(
    (connection: Connection | Edge) => isConnectionValid(nodes, connection),
    [nodes],
  );

  // Load a template graph into the store.
  // If the canvas has unsaved changes, hold the selection in pendingTemplate
  // and wait for the user to confirm before replacing the graph.
  const applyTemplate = useCallback(
    (graph: WorkflowGraph, name: string) => {
      const meta = useWorkflowStore.getState().meta;
      if (meta) {
        // Clear run status so the status dot doesn't show a stale state from the previous graph.
        loadWorkflow({ ...meta, lastRunStatus: null, lastRunAt: null }, graph);
      } else {
        loadWorkflow({ id: crypto.randomUUID(), name, description: "", lastRunStatus: null, lastRunAt: null, revisionCount: 0 }, graph);
      }
      // Clear any post-run FAB from the previous graph so it doesn't appear on the new template.
      setPostRunArtifacts([]);
      setSendingFromCanvas(false);
      setTemplateLoadSeq((s) => s + 1);
    },
    [loadWorkflow],
  );

  // Fit the viewport around all nodes after a template is loaded.
  // Two staggered calls: the first fires before React Flow has measured all
  // nodes (giving a rough snap), the second fires after measurement is complete
  // and produces the final accurate centered view.
  // Skips the initial mount (seq = 0) so it only fires on actual template loads.
  useEffect(() => {
    if (!templateLoadMountedRef.current) {
      templateLoadMountedRef.current = true;
      return;
    }
    // Three staggered calls: rough snap (before measurement) → post-measurement
    // accurate center → final safety snap for slow/complex templates.
    const id1 = setTimeout(() => { fitView({ duration: 200, padding: 0.22 }); }, 80);
    const id2 = setTimeout(() => { fitView({ duration: 300, padding: 0.22 }); }, 420);
    const id3 = setTimeout(() => { fitView({ duration: 250, padding: 0.22 }); }, 900);
    return () => { clearTimeout(id1); clearTimeout(id2); clearTimeout(id3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateLoadSeq]);

  const handleTemplateSelect = useCallback(
    (graph: WorkflowGraph, name: string) => {
      if (nodes.length > 0) {
        setPendingTemplate({ graph, name });
      } else {
        applyTemplate(graph, name);
      }
    },
    [nodes.length, applyTemplate],
  );

  const handleConfirmReplace = useCallback(() => {
    if (pendingTemplate) {
      applyTemplate(pendingTemplate.graph, pendingTemplate.name);
      setPendingTemplate(null);
    }
  }, [pendingTemplate, applyTemplate]);

  const handleCancelReplace = useCallback(() => {
    setPendingTemplate(null);
  }, []);

  // Push history on drag start so node moves are undoable
  const handleNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveGraph();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      // Duplicate selected node
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !e.shiftKey) {
        e.preventDefault();
        if (selectedNodeId) duplicateNode(selectedNodeId);
      }
      // Slash command menu — only when canvas is focused (not inside an input)
      if (e.key === "/" && !inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSlashOpen(true);
        setSlashQuery("");
        setSlashIdx(0);
      }
    },
    [saveGraph, undo, redo, selectedNodeId, duplicateNode],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="flex h-full w-full" onKeyDown={handleKeyDown}>
      {/* Left: Node Palette */}
      <NodePalette
        onAddNode={handleAddNode}
        onApplyTemplate={handleTemplateSelect}
        templateRefreshKey={templateRefreshKey}
        open={paletteOpen}
        onToggle={togglePalette}
      />

      {/* Center: React Flow Canvas */}
      <div className="relative flex-1">
        {/* Restore / Edit & Replay origin banner */}
        {replayRunId && (
          <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2" data-testid="replay-banner">
            <div className="flex items-center gap-3 rounded-lg border border-amber-700/50 bg-amber-950/90 px-4 py-1.5 text-xs text-amber-300 shadow-lg backdrop-blur-sm">
              <span>
                Graph loaded from run{" "}
                <code className="font-mono text-amber-200">{replayRunId.slice(0, 8)}</code>
                {" "}— edit or run as new
              </span>
              <button
                type="button"
                onClick={() => setReplayRunId(null)}
                className="text-amber-500 hover:text-amber-300"
                aria-label="Dismiss replay banner"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Slash command menu */}
        {slashOpen && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) closeSlash(); }}
            onKeyDown={(e) => { if (e.key === "Escape") closeSlash(); }}
          >
            <div className="flex w-80 flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
              <div className="px-3 pt-3 pb-2">
                <input
                  ref={slashInputRef}
                  type="text"
                  value={slashQuery}
                  onChange={(e) => { setSlashQuery(e.target.value); setSlashIdx(0); }}
                  onKeyDown={handleSlashKeyDown}
                  placeholder="Search nodes & presets…"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <ul
                ref={slashListRef}
                className="max-h-72 overflow-y-auto pb-2"
                role="listbox"
                aria-label="Nodes and presets"
              >
                {slashItems.length === 0 && (
                  <li className="px-4 py-3 text-xs text-neutral-600">No results</li>
                )}
                {slashItems.map((item, i) => {
                  const isHighlighted = i === slashIdx;
                  // Divider between last preset and first node
                  const prevItem = slashItems[i - 1];
                  const showDivider =
                    item.kind === "node" && prevItem?.kind === "preset";

                  if (item.kind === "preset") {
                    return (
                      <li key={`preset-${item.preset.id}`} role="option" aria-selected={isHighlighted}>
                        <button
                          type="button"
                          onMouseEnter={() => setSlashIdx(i)}
                          onClick={() => selectSlashPreset(item.preset)}
                          className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${
                            isHighlighted ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm text-neutral-100">{item.preset.label}</span>
                            <span className="rounded bg-violet-500/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-400">
                              Preset
                            </span>
                            <span className="text-[10px] text-neutral-600">
                              {item.preset.nodes.length} nodes
                            </span>
                          </span>
                          <span className="line-clamp-1 text-[11px] text-neutral-500">
                            {item.preset.description}
                          </span>
                        </button>
                      </li>
                    );
                  }

                  // Single node item
                  return (
                    <li key={`node-${item.def.type}`} role="option" aria-selected={isHighlighted}>
                      {showDivider && (
                        <div className="mx-3 my-1 border-t border-neutral-800" role="separator" />
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => selectSlashNode(item.def)}
                        className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${
                          isHighlighted ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                        }`}
                      >
                        <span className="text-sm text-neutral-100">{item.def.label}</span>
                        <span className="line-clamp-1 text-[11px] text-neutral-500">
                          {item.def.description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-neutral-800 px-3 py-1.5">
                <span className="text-[10px] text-neutral-600">↑↓ navigate · Enter insert · Esc close</span>
              </div>
            </div>
          </div>
        )}

        {/* Empty state — welcoming panel with featured templates */}
        {nodes.length === 0 && !emptyStateDismissed && (
          <EmptyStateBoundary onError={() => setEmptyStateDismissed(true)}>
            <Suspense fallback={null}>
              <WorkflowEmptyState
                onSelectTemplate={handleTemplateSelect}
                onOpenGallery={toggleTemplatePicker}
                onStartBlank={() => setEmptyStateDismissed(true)}
              />
            </Suspense>
          </EmptyStateBoundary>
        )}
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={handleIsValidConnection}
          onBeforeDelete={handleBeforeDelete}
          onNodeClick={handleNodeClick}
          onNodeDragStart={handleNodeDragStart}
          onPaneClick={handlePaneClick}
          fitView={nodes.length > 0}
          fitViewOptions={{ padding: 0.2, duration: 200 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "default", animated: true }}
          className="bg-neutral-950"
        >
          <Background color="#333" gap={20} />
          <Controls
            aria-label="Canvas controls"
            className="!bg-neutral-800 !border-neutral-700 !rounded-lg [&>button]:!bg-neutral-800 [&>button]:!border-neutral-700 [&>button]:!text-neutral-300 [&>button:hover]:!bg-neutral-700"
          />
          <MiniMap
            aria-label="Canvas minimap"
            className="!bg-neutral-900 !border-neutral-700 !rounded-lg"
            nodeColor="#525252"
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {/* Top bar: workflow controls + health strip */}
        <div className="absolute left-3 right-2 top-3 z-10 flex flex-col items-start gap-1 min-w-0">

          {/* ── Row 1: navigation · identity · run controls ── */}
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
            <Link
              href="/workflows"
              className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
              title="Back to workflows"
            >
              ← Workflows
            </Link>
            {meta && (
              <Link
                href={`/workflows/${meta.id}/history`}
                className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                title="View run history"
              >
                Run History
              </Link>
            )}
            {meta && (
              <Link
                href={`/workflows/${meta.id}/library`}
                className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                title="Workflow Library — fragments, checkpoints, artifacts, templates"
              >
                Library
              </Link>
            )}
            {editingName ? (
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleCommitRename}
                onKeyDown={handleNameKeyDown}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="w-[180px] rounded border border-neutral-600 bg-neutral-800 px-1.5 py-0.5 text-xs font-medium text-neutral-200 outline-none focus:border-neutral-500"
              />
            ) : (
              <button
                type="button"
                onClick={handleStartRename}
                title="Click to rename"
                className="max-w-[200px] cursor-text truncate rounded px-1.5 py-0.5 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
              >
                {meta?.name ?? "Untitled workflow"}
              </button>
            )}
            {meta && (
              <span
                className="flex items-center gap-1.5 text-xs text-neutral-500 select-none"
                title={meta.lastRunStatus
                  ? `Last run: ${meta.lastRunStatus.replace(/_/g, " ")}${meta.lastRunAt ? ` · ${formatRunTime(meta.lastRunAt)}` : ""}`
                  : "No runs yet"}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: meta.lastRunStatus
                      ? (RUN_STATUS_COLOR[meta.lastRunStatus] ?? "#737373")
                      : "#404040",
                  }}
                />
                <span className="capitalize">
                  {meta.lastRunStatus
                    ? `${meta.lastRunStatus.replace(/_/g, " ")}${meta.lastRunAt ? ` · ${formatRunTime(meta.lastRunAt)}` : ""}`
                    : "No runs yet"}
                </span>
              </span>
            )}
            {meta && meta.revisionCount > 0 && (
              <span className="text-xs text-neutral-600 select-none" title="Saved revision checkpoints">
                {meta.revisionCount} {meta.revisionCount === 1 ? "checkpoint" : "checkpoints"}
              </span>
            )}
            <span className="h-4 w-px bg-neutral-700" aria-hidden="true" />
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning || debugSnapshot?.status === "running" || !meta || nodes.length === 0 || hasNoProviders}
              title={
                isRunning                           ? "Run is starting…"                                           :
                debugSnapshot?.status === "running" ? "Run in progress"                                           :
                !meta                               ? "No workflow loaded"                                         :
                nodes.length === 0                  ? "Add nodes to the canvas first"                             :
                hasNoProviders                      ? "Add an API key in Settings → Providers to run workflows"   :
                undefined
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isRunning || debugSnapshot?.status === "running" || !meta || nodes.length === 0 || hasNoProviders
                  ? "border-neutral-700 bg-neutral-900 text-neutral-600 cursor-default"
                  : "border-emerald-600 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20"
              }`}
            >
              {(isRunning || debugSnapshot?.status === "running") && (
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full animate-pulse"
                  style={{ backgroundColor: "#60a5fa" }}
                  aria-label="Run in progress"
                />
              )}
              {isRunning || debugSnapshot?.status === "running" ? "Running…" : "Run Workflow"}
            </button>
            <button
              type="button"
              onClick={() => setAutoRunEnabled(!autoRunEnabled)}
              disabled={!meta || nodes.length === 0 || hasNoProviders}
              title={
                hasNoProviders
                  ? "Add an API key in Settings → Providers to enable Auto-Run"
                  : autoRunEnabled
                    ? "Auto-Run is ON — workflow reruns after parameter edits"
                    : "Enable Auto-Run — rerun after meaningful edits"
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                !meta || nodes.length === 0 || hasNoProviders
                  ? "cursor-default border-neutral-700 bg-neutral-900 text-neutral-600"
                  : autoRunEnabled
                    ? "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
              }`}
            >
              Auto-Run
            </button>
            {/* Schedule */}
            <div className="relative">
              <button
                ref={scheduleBtnRef}
                type="button"
                onClick={() => { setBudgetPanelOpen(false); setSchedulePanelOpen((v) => !v); }}
                disabled={!meta}
                title={
                  !meta ? "No workflow loaded"
                  : scheduleActive ? "Schedule active — click to edit"
                  : "Schedule recurring runs"
                }
                aria-haspopup="dialog"
                aria-expanded={schedulePanelOpen}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  schedulePanelOpen
                    ? "border-violet-500 bg-violet-500/10 text-violet-400"
                    : scheduleActive
                    ? "border-violet-700 bg-violet-700/10 text-violet-400 hover:bg-violet-700/20"
                    : !meta
                    ? "cursor-default border-neutral-700 bg-neutral-900 text-neutral-600"
                    : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                }`}
              >
                {scheduleActive && (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-label="Schedule active" />
                )}
                Schedule
              </button>
              {schedulePanelOpen && meta && (
                <SchedulePanel
                  workflowId={meta.id}
                  onClose={() => setSchedulePanelOpen(false)}
                  anchorRef={scheduleBtnRef}
                  onScheduleChange={setScheduleActive}
                />
              )}
            </div>
            {/* Budget */}
            <div className="relative">
              <button
                ref={budgetBtnRef}
                type="button"
                onClick={() => { setSchedulePanelOpen(false); setBudgetPanelOpen((v) => !v); }}
                title={
                  meta?.lastRunStatus === "budget_exceeded"
                    ? `Last run hit budget cap ($${budgetCap.toFixed(2)}) — click to adjust`
                    : `Budget cap: $${budgetCap.toFixed(2)} per run`
                }
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  budgetPanelOpen
                    ? "border-blue-600 bg-blue-600/10 text-blue-400"
                    : meta?.lastRunStatus === "budget_exceeded"
                    ? "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                }`}
                aria-haspopup="dialog"
                aria-expanded={budgetPanelOpen}
              >
                {meta?.lastRunStatus === "budget_exceeded" && (
                  <span aria-hidden="true" className="text-amber-400">⚠</span>
                )}
                <span aria-hidden="true">$</span>
                {budgetCap.toFixed(2)}
              </button>
              {budgetPanelOpen && meta && (
                <BudgetSettingsPanel
                  workflowId={meta.id}
                  onClose={() => setBudgetPanelOpen(false)}
                  anchorRef={budgetBtnRef}
                />
              )}
            </div>
            {hasNoProviders && (
              <Link
                href="/settings/providers"
                className="text-xs text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-300"
                title="Open provider settings"
              >
                Add API key
              </Link>
            )}
            {runBadge && (
              <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${runBadge.colorClass}`}>
                {runBadge.label}
              </span>
            )}
            <span className="text-xs text-neutral-600 select-none">
              {nodes.length} {nodes.length === 1 ? "node" : "nodes"} · {edges.length} {edges.length === 1 ? "edge" : "edges"}
            </span>
          </div>

          {/* ── Row 2: editing tools ── */}
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={toggleTemplatePicker}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                templatePickerOpen
                  ? "border-purple-500 bg-purple-500/10 text-purple-400"
                  : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              Templates
            </button>
            <button
              type="button"
              onClick={toggleDebugger}
              title="Show live node execution status and run outputs"
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                debuggerOpen
                  ? "border-blue-500 bg-blue-500/10 text-blue-400"
                  : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              Debugger
            </button>
            <span className="h-4 w-px bg-neutral-700" aria-hidden="true" />
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title={canUndo ? "Undo" : "Nothing to undo"}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                canUndo
                  ? "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                  : "border-neutral-700 bg-neutral-900 text-neutral-600 cursor-default"
              }`}
            >
              Undo <span className="opacity-50">⌘Z</span>
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title={canRedo ? "Redo" : "Nothing to redo"}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                canRedo
                  ? "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                  : "border-neutral-700 bg-neutral-900 text-neutral-600 cursor-default"
              }`}
            >
              Redo <span className="opacity-50">⌘⇧Z</span>
            </button>
            <button
              type="button"
              onClick={saveGraph}
              disabled={!dirty || saving}
              title={saving ? "Saving…" : !dirty ? "No unsaved changes" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                dirty && !saving
                  ? "border-blue-500 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                  : "border-neutral-700 bg-neutral-900 text-neutral-600 cursor-default"
              }`}
            >
              {saving ? "Saving…" : dirty ? (<>Save <span className="opacity-50">⌘S</span></>) : "Saved"}
            </button>
            <span className="h-4 w-px bg-neutral-700" aria-hidden="true" />
            <button
              type="button"
              onClick={toggleSaveAsTemplate}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
            >
              Save as Template
            </button>
            <button
              type="button"
              onClick={() => setSaveRevisionOpen(true)}
              disabled={!meta}
              title={!meta ? "No workflow loaded" : "Save a named revision checkpoint"}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:cursor-default disabled:text-neutral-600"
            >
              Save Revision
            </button>
            <button
              type="button"
              onClick={() => setSaveFragmentOpen(true)}
              disabled={getNodes().filter((n) => n.selected).length === 0}
              title={
                getNodes().filter((n) => n.selected).length === 0
                  ? "Select nodes on the canvas first"
                  : "Save selected nodes as a reusable fragment"
              }
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:cursor-default disabled:text-neutral-600"
            >
              Save as Fragment
            </button>
            <button
              type="button"
              onClick={() => setFragmentBrowserOpen(true)}
              title="Browse and insert a saved fragment"
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
            >
              Insert Fragment
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!meta || exporting}
              title={!meta ? "No workflow loaded" : undefined}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:cursor-default disabled:text-neutral-600"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
          </div>

          {/* Health strip — third row, only renders when there are signals */}
          <WorkflowHealthStrip health={health} />
        </div>

        {/* Floating "Send to Video Editor" FAB — appears after a successful run.
            Positioned inside the canvas div so left-1/2 centers within the canvas,
            not the full page width. Visible whether the debugger is open or not. */}
        {postRunArtifacts.length > 0 && (
          <div
            className={`absolute left-1/2 z-30 -translate-x-1/2 transition-all duration-300 ${
              debuggerOpen ? "bottom-[calc(40vh+0.75rem)]" : "bottom-4"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { void handleSendFromCanvas(); }}
                disabled={sendingFromCanvas}
                className={`inline-flex items-center gap-2.5 rounded-full border px-5 py-2 text-sm font-semibold shadow-2xl transition-all ${
                  sendingFromCanvas
                    ? "cursor-default border-neutral-700 bg-neutral-950 text-neutral-500"
                    : "border-emerald-500/70 bg-neutral-950 text-emerald-300 shadow-emerald-950 hover:border-emerald-400 hover:bg-emerald-950/80"
                }`}
              >
                {sendingFromCanvas ? (
                  "Opening Editor…"
                ) : (
                  <>
                    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-600/30 px-1 text-[11px] font-bold text-emerald-300">
                      {postRunArtifacts.length}
                    </span>
                    Send to Video Editor
                  </>
                )}
              </button>
              {!sendingFromCanvas && (
                <button
                  type="button"
                  onClick={() => setPostRunArtifacts([])}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500 shadow-xl hover:border-neutral-600 hover:text-neutral-300"
                  aria-label="Dismiss"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2 2l6 6M8 2l-6 6" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right: Inspector Panel */}
      {inspectorOpen && selectedNode && (
        <InspectorPanel
          selectedNode={selectedNode}
          onParamChange={updateNodeParam}
          onClose={() => selectNode(null)}
        />
      )}

      {/* Bottom: Debugger Panel (slides up) */}
      {debuggerOpen && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex max-h-[40vh] flex-col border-t border-neutral-800 bg-neutral-950">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-0.5 border-b border-neutral-800 px-3 pt-1.5 pb-0">
            <DebugTabButton
              label="Nodes"
              active={activeDebugTab === "nodes"}
              onClick={() => setActiveDebugTab("nodes")}
            />
            <DebugTabButton
              label="Outputs"
              active={activeDebugTab === "outputs"}
              onClick={() => setActiveDebugTab("outputs")}
            />
          </div>
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {activeDebugTab === "nodes" ? (
              debugSnapshot ? (
                <RunDebuggerPanel
                  snapshot={debugSnapshot}
                  onNodeClick={(nodeId) => selectNode(nodeId)}
                />
              ) : (
                <div className="px-4 py-4 text-xs text-neutral-500">
                  {currentRunId
                    ? "Connecting to run\u2026"
                    : "No run yet \u2014 click \u201cRun Workflow\u201d to start."}
                </div>
              )
            ) : (
              <RunOutputsPanel
                workflowId={meta?.id ?? ""}
                runId={currentRunId}
                snapshot={debugSnapshot}
              />
            )}
          </div>
        </div>
      )}

      {/* Template Picker Modal */}
      <TemplatePicker
        open={templatePickerOpen}
        onClose={toggleTemplatePicker}
        onSelect={handleTemplateSelect}
        refreshKey={templateRefreshKey}
      />

      {/* Save as Template Dialog */}
      <SaveAsTemplateDialog
        open={saveAsTemplateOpen}
        onClose={toggleSaveAsTemplate}
        getGraph={getWorkflowGraph}
        defaultName={useWorkflowStore.getState().meta?.name}
        onSaved={() => setTemplateRefreshKey((k) => k + 1)}
      />

      {/* Save Revision Dialog */}
      {meta && (
        <SaveRevisionDialog
          open={saveRevisionOpen}
          onClose={() => setSaveRevisionOpen(false)}
          workflowId={meta.id}
          getGraph={getWorkflowGraph}
        />
      )}

      {/* Save Fragment Dialog */}
      <SaveFragmentDialog
        open={saveFragmentOpen}
        onClose={() => setSaveFragmentOpen(false)}
        getFragment={getSelectedFragment}
        onSaved={() => setSaveFragmentOpen(false)}
      />

      {/* Fragment Browser */}
      <FragmentBrowser
        open={fragmentBrowserOpen}
        onClose={() => setFragmentBrowserOpen(false)}
        onInsert={handleInsertFragmentGraph}
      />

      {/* Budget warning dialog — shown when estimated run cost exceeds cap */}
      {budgetWarning && (
        <BudgetWarningModal
          estimatedCost={budgetWarning.estimatedCost}
          budgetCap={budgetCap}
          onProceed={() => {
            setBudgetWarning(null);
            void runWorkflow({ budgetCap });
          }}
          onCancel={() => setBudgetWarning(null)}
          onIncreaseBudget={(newCap) => {
            setBudgetCap(newCap);
            setBudgetWarning(null);
            void runWorkflow({ budgetCap: newCap });
          }}
        />
      )}

      {/* Confirm delete dialog — shown when deleting a node with connected edges */}
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        nodeLabel={pendingDelete?.nodeLabel}
        edgeCount={pendingDelete?.edgeCount ?? 0}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* Confirm replace dialog — shown when non-empty canvas + template selected */}
      <ConfirmReplaceDialog
        open={pendingTemplate !== null}
        templateName={pendingTemplate?.name}
        graph={pendingTemplate?.graph}
        onCancel={handleCancelReplace}
        onConfirm={handleConfirmReplace}
      />
    </div>
  );
}

// ── Workflow health strip ──

const HEALTH_CHIP: Record<string, string> = {
  running: "border-blue-800/50 bg-blue-950/40 text-blue-400",
  queued:  "border-amber-800/50 bg-amber-950/40 text-amber-400",
  pending: "border-neutral-700/50 bg-neutral-900/60 text-neutral-500",
  failed:  "border-red-900/50 bg-red-950/40 text-red-400",
  stale:   "border-yellow-900/50 bg-yellow-950/40 text-yellow-500",
};

function WorkflowHealthStrip({ health }: { health: WorkflowHealthSummary }) {
  if (!hasHealthSignals(health)) return null;

  return (
    <div className="flex items-center gap-1" role="status" aria-label="Workflow health">
      {health.isLiveRunning && (
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_CHIP.running}`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
          Running
        </span>
      )}
      {health.autoRunQueued && (
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium animate-pulse ${HEALTH_CHIP.queued}`}>
          Queued
        </span>
      )}
      {!health.autoRunQueued && health.autoRunPending && !health.isLiveRunning && (
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium animate-pulse ${HEALTH_CHIP.pending}`}>
          Pending
        </span>
      )}
      {health.failedCount > 0 && (
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_CHIP.failed}`}
          title={`${health.failedCount} node${health.failedCount === 1 ? "" : "s"} failed — select the node and check the Run tab or error strip for details`}
        >
          {health.failedCount} failed
        </span>
      )}
      {health.staleCount > 0 && (
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] ${HEALTH_CHIP.stale}`}
          title={`${health.staleCount} node${health.staleCount === 1 ? "" : "s"} have changed params or structure since the last run — re-run to update`}
        >
          {health.staleCount} stale
        </span>
      )}
    </div>
  );
}

// ── Debug tab button ──

function DebugTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t px-3 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? "border-b-2 border-blue-500 text-neutral-100"
          : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label}
    </button>
  );
}

// ── Exported wrapper with provider ──

export function WorkflowCanvas() {
  const searchParams = useSearchParams();
  const initialArtifactPath = searchParams.get("insertArtifact") ?? undefined;
  const initialRunId = searchParams.get("insertRunId") ?? undefined;
  const initialFragmentId = searchParams.get("insertFragment") ?? undefined;

  return (
    <ReactFlowProvider>
      <CanvasInner
        initialArtifactPath={initialArtifactPath}
        initialRunId={initialRunId}
        initialFragmentId={initialFragmentId}
      />
    </ReactFlowProvider>
  );
}
