"use client";

import { create } from "zustand";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraph,
} from "@aistudio/shared";
import type { RunDebugSnapshot } from "@aistudio/engine";
import type { NodeLatestOutput } from "@/lib/runOutputs";
import { computeStaleFromNode } from "@/lib/staleness";
import { readBudgetCapFromStorage } from "@/hooks/useBudgetSettings";
import type { NormalizedNodeRunState } from "@/lib/nodeRunState";
import type { NodeExecutionSummary } from "@/lib/nodeExecutionSummary";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import { nodeRegistry, toWorkflowPorts } from "@aistudio/shared";

// ── React Flow ↔ WorkflowNode adapters ──

// Node types that use a specialized React Flow component instead of CustomNode.
// All other nodes fall back to the generic "custom" component.
const SPECIALIZED_NODE_TYPES = new Set(["react-agent", "obsidian-memory", "sub-agent"]);

export function toFlowNode(wn: WorkflowNode): Node {
  return {
    id: wn.id,
    type: SPECIALIZED_NODE_TYPES.has(wn.type) ? wn.type : "custom",
    position: wn.position,
    data: {
      ...wn.data,
      inputs: wn.inputs,
      outputs: wn.outputs,
      nodeType: wn.type,
    },
  };
}

export function toFlowEdge(we: WorkflowEdge): Edge {
  return {
    id: we.id,
    source: we.source,
    sourceHandle: we.sourceHandle,
    target: we.target,
    targetHandle: we.targetHandle,
    type: "default",
  };
}

export function fromFlowNode(node: Node): WorkflowNode {
  const d = node.data as Record<string, unknown>;
  return {
    id: node.id,
    type: (d.nodeType as string) ?? "unknown",
    position: node.position,
    data: {
      label: (d.label as string) ?? "",
      params: (d.params as Record<string, unknown>) ?? {},
      retryCount: (d.retryCount as number) ?? 1,
      timeoutMs: (d.timeoutMs as number) ?? 300_000,
      ...(d.providerId ? { providerId: d.providerId as string } : {}),
      ...(d.modelId ? { modelId: d.modelId as string } : {}),
    },
    inputs: (d.inputs as WorkflowNode["inputs"]) ?? [],
    outputs: (d.outputs as WorkflowNode["outputs"]) ?? [],
  };
}

// ── Store types ──

interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  revisionCount: number;
}

interface HistorySnapshot {
  nodes: Node[];
  edges: Edge[];
}

interface WorkflowState {
  // Workflow identity
  meta: WorkflowMeta | null;

  // React Flow state
  nodes: Node[];
  edges: Edge[];

  // Undo/redo history
  historyStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  // UI state
  selectedNodeId: string | null;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  debuggerOpen: boolean;
  templatePickerOpen: boolean;
  saveAsTemplateOpen: boolean;
  debugSnapshot: RunDebugSnapshot | null;
  currentRunId: string | null;
  /** Non-null when the canvas was loaded via Edit & Replay from a historical run. */
  replayRunId: string | null;
  dirty: boolean;
  saving: boolean;
  isRunning: boolean;
  /** Incremented each time updateNodeParam fires — canvas watches this to debounce Auto-Run. */
  paramEditSeq: number;
  /** When true, meaningful param edits schedule a debounced rerun. Session-only; no DB persistence. */
  autoRunEnabled: boolean;
  /** Latest output per node from the most recent completed run. Populated after runs and on load. */
  latestOutputsByNode: Record<string, NodeLatestOutput> | null;
  /** Session-only: nodes whose params/graph may have changed since their last successful run. */
  staleNodeIds: Record<string, true>;
  /** Session-only: last known normalized run state per node — persists across run restarts. */
  nodeRunStatesById: Record<string, NormalizedNodeRunState>;
  /** Session-only: latest normalized execution summary per node from the most recent run. */
  latestExecutionByNodeId: Record<string, NodeExecutionSummary>;

  // ── Auto-Run queue flags (session-only, no persistence) ──
  /** Debounce timer is ticking — a run will be requested soon. */
  autoRunPending: boolean;
  /** A run is in-flight; one follow-up run is waiting to fire after it completes. */
  autoRunQueued: boolean;
  /** An auto-triggered run is currently executing. */
  autoRunInFlight: boolean;

  // React Flow callbacks
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Actions
  loadWorkflow: (meta: WorkflowMeta, graph: WorkflowGraph, replayRunId?: string | null) => void;
  setReplayRunId: (id: string | null) => void;
  addNode: (node: WorkflowNode) => void;
  duplicateNode: (nodeId: string) => void;
  /** Batch-insert multiple nodes + edges as a single undo step. */
  insertNodes: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  insertFragment: (graph: WorkflowGraph, offsetX?: number, offsetY?: number) => void;
  removeNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  updateNodeParam: (nodeId: string, key: string, value: unknown) => void;
  togglePalette: () => void;
  toggleInspector: () => void;
  toggleDebugger: () => void;
  toggleTemplatePicker: () => void;
  toggleSaveAsTemplate: () => void;
  setDebugSnapshot: (snapshot: RunDebugSnapshot | null) => void;
  setCurrentRunId: (runId: string | null) => void;
  saveGraph: () => Promise<void>;
  runWorkflow: (opts?: { budgetCap?: number }) => Promise<void>;
  setAutoRunEnabled: (enabled: boolean) => void;
  setLatestOutputsByNode: (map: Record<string, NodeLatestOutput>) => void;
  markNodeAndDownstreamStale: (nodeId: string) => void;
  clearStaleNodes: (nodeIds?: string[]) => void;
  setNodeRunStates: (map: Record<string, NormalizedNodeRunState>) => void;
  clearNodeRunStates: () => void;
  setLatestExecutionByNode: (map: Record<string, NodeExecutionSummary>) => void;
  clearLatestExecutionByNode: () => void;
  setAutoRunPending: (flag: boolean) => void;
  setAutoRunQueued: (flag: boolean) => void;
  setAutoRunInFlight: (flag: boolean) => void;
  updateMetaName: (name: string) => void;
  updateMetaRunStatus: (status: string, runAt: string) => void;
  getWorkflowGraph: () => WorkflowGraph;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

// ── Store ──

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  meta: null,
  nodes: [],
  edges: [],
  historyStack: [],
  redoStack: [],
  selectedNodeId: null,
  paletteOpen: true,
  inspectorOpen: false,
  debuggerOpen: false,
  templatePickerOpen: false,
  saveAsTemplateOpen: false,
  debugSnapshot: null,
  currentRunId: null,
  replayRunId: null,
  dirty: false,
  saving: false,
  isRunning: false,
  paramEditSeq: 0,
  autoRunEnabled: false,
  latestOutputsByNode: null,
  staleNodeIds: {},
  nodeRunStatesById: {},
  latestExecutionByNodeId: {},
  autoRunPending: false,
  autoRunQueued: false,
  autoRunInFlight: false,

  pushHistory: () => {
    const { nodes, edges, historyStack } = get();
    const snapshot: HistorySnapshot = { nodes, edges };
    const next = historyStack.length >= 50
      ? [...historyStack.slice(1), snapshot]
      : [...historyStack, snapshot];
    set({ historyStack: next, redoStack: [] });
  },

  undo: () => {
    const { nodes, edges, historyStack, redoStack } = get();
    if (historyStack.length === 0) return;
    const snapshot = historyStack[historyStack.length - 1];
    const redoSnapshot: HistorySnapshot = { nodes, edges };
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      historyStack: historyStack.slice(0, -1),
      redoStack: [...redoStack, redoSnapshot],
      selectedNodeId: null,
      dirty: true,
    });
  },

  redo: () => {
    const { nodes, edges, historyStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const snapshot = redoStack[redoStack.length - 1];
    const undoSnapshot: HistorySnapshot = { nodes, edges };
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      historyStack: [...historyStack, undoSnapshot],
      redoStack: redoStack.slice(0, -1),
      selectedNodeId: null,
      dirty: true,
    });
  },

  onNodesChange: (changes) => {
    if (changes.some((c) => c.type === "remove")) {
      get().pushHistory();
    }
    // "dimensions" fires when ReactFlow measures rendered node sizes (on load / resize).
    // "select" fires when a node is selected/deselected — neither is a saveable data change.
    // "position" with dragging:true is an intermediate drag state; only mark dirty on release.
    const hasSaveableChange = changes.some(
      (c) =>
        c.type === "add" ||
        c.type === "remove" ||
        c.type === "replace" ||
        (c.type === "position" && c.dragging !== true),
    );
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      ...(hasSaveableChange ? { dirty: true } : {}),
    }));
  },

  onEdgesChange: (changes) => {
    // Capture removed edge targets *before* applying changes so we can still look them up.
    const removedTargets = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => get().edges.find((e) => e.id === c.id)?.target ?? null)
      .filter((t): t is string => t !== null);
    if (changes.some((c) => c.type === "remove")) {
      get().pushHistory();
    }
    // "select" on edges is not a saveable data change.
    const hasSaveableChange = changes.some(
      (c) => c.type === "add" || c.type === "remove" || c.type === "replace",
    );
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      ...(hasSaveableChange ? { dirty: true } : {}),
    }));
    for (const target of removedTargets) {
      get().markNodeAndDownstreamStale(target);
    }
  },

  onConnect: (connection) => {
    get().pushHistory();
    set((s) => ({
      edges: addEdge(
        { ...connection, id: crypto.randomUUID(), type: "default" },
        s.edges,
      ),
      dirty: true,
    }));
    if (connection.target) {
      get().markNodeAndDownstreamStale(connection.target);
    }
  },

  loadWorkflow: (meta, graph, replayRunId = null) => {
    // Enrich any nodes that are missing port data (e.g. template-created workflows
    // whose nodes were saved before ports were stored). Looks up each node type in
    // the NodeRegistry and fills in inputs/outputs so React Flow handles render.
    const enriched = graph.nodes.map((wn) => {
      if ((wn.inputs?.length ?? 0) === 0 && (wn.outputs?.length ?? 0) === 0) {
        const def = nodeRegistry.get(wn.type);
        if (def) {
          return {
            ...wn,
            inputs:  toWorkflowPorts(def.inputs,  "input"),
            outputs: toWorkflowPorts(def.outputs, "output"),
          };
        }
      }
      return wn;
    });
    set({
      meta,
      nodes: enriched.map(toFlowNode),
      edges: graph.edges.map(toFlowEdge),
      selectedNodeId: null,
      replayRunId: replayRunId ?? null,
      dirty: false,
      historyStack: [],
      redoStack: [],
      latestOutputsByNode: null,
      staleNodeIds: {},
      nodeRunStatesById: {},
      latestExecutionByNodeId: {},
      autoRunPending: false,
      autoRunQueued: false,
      autoRunInFlight: false,
    });
  },

  addNode: (node) => {
    get().pushHistory();
    set((s) => ({
      nodes: [...s.nodes, toFlowNode(node)],
      dirty: true,
    }));
  },

  duplicateNode: (nodeId) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    state.pushHistory();
    const newId = crypto.randomUUID();
    const clone = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: false,
    };
    set((s) => ({
      nodes: [...s.nodes, clone],
      selectedNodeId: newId,
      inspectorOpen: true,
      dirty: true,
    }));
  },

  insertNodes: (nodes, edges) => {
    get().pushHistory();
    const flowEdges = edges.map((we) => ({
      id: we.id,
      source: we.source,
      sourceHandle: we.sourceHandle,
      target: we.target,
      targetHandle: we.targetHandle,
      type: "default" as const,
      animated: true,
    }));
    set((s) => ({
      nodes: [...s.nodes, ...nodes.map(toFlowNode)],
      edges: [...s.edges, ...flowEdges],
      selectedNodeId: nodes[0]?.id ?? null,
      inspectorOpen: nodes.length > 0,
      dirty: true,
    }));
    // Mark target nodes stale for any newly-created connecting edges.
    for (const edge of edges) {
      get().markNodeAndDownstreamStale(edge.target);
    }
  },

  insertFragment: (graph, offsetX = 100, offsetY = 100) => {
    get().pushHistory();
    // Remap node IDs to avoid collisions with existing canvas nodes.
    const idMap = new Map<string, string>();
    const newNodes = graph.nodes.map((wn, i) => {
      const newId = `${wn.id}-${Date.now()}-${i}`;
      idMap.set(wn.id, newId);
      return toFlowNode({
        ...wn,
        id: newId,
        position: { x: (wn.position?.x ?? 0) + offsetX, y: (wn.position?.y ?? 0) + offsetY },
      });
    });
    const newEdges: Edge[] = graph.edges.map((we) => ({
      id: `${we.id}-${Date.now()}`,
      source: idMap.get(we.source) ?? we.source,
      sourceHandle: we.sourceHandle,
      target: idMap.get(we.target) ?? we.target,
      targetHandle: we.targetHandle,
      type: "default" as const,
    }));
    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      dirty: true,
    }));
  },

  removeNode: (nodeId) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      dirty: true,
    }));
  },

  selectNode: (nodeId) => {
    set({
      selectedNodeId: nodeId,
      inspectorOpen: nodeId !== null,
    });
  },

  updateNodeParam: (nodeId, key, value) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const params = { ...(n.data.params as Record<string, unknown>), [key]: value };
        return { ...n, data: { ...n.data, params } };
      }),
      dirty: true,
      paramEditSeq: s.paramEditSeq + 1,
    }));
    get().markNodeAndDownstreamStale(nodeId);
  },

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  toggleDebugger: () => set((s) => ({ debuggerOpen: !s.debuggerOpen })),
  toggleTemplatePicker: () => set((s) => ({ templatePickerOpen: !s.templatePickerOpen })),
  toggleSaveAsTemplate: () => set((s) => ({ saveAsTemplateOpen: !s.saveAsTemplateOpen })),
  setDebugSnapshot: (snapshot) => set({ debugSnapshot: snapshot }),
  setCurrentRunId: (runId) => set({ currentRunId: runId }),
  setReplayRunId: (id) => set({ replayRunId: id }),

  getWorkflowGraph: () => {
    const { nodes, edges } = get();
    return {
      version: 1 as const,
      nodes: nodes.map(fromFlowNode),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? "",
        target: e.target,
        targetHandle: e.targetHandle ?? "",
      })),
    };
  },

  saveGraph: async () => {
    const { meta } = get();
    if (!meta) return;

    set({ saving: true });
    try {
      const graph = get().getWorkflowGraph();
      const res = await fetch(`/api/workflows/${meta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph }),
      });
      if (res.ok) {
        set({ dirty: false });
      }
    } finally {
      set({ saving: false });
    }
  },

  setAutoRunEnabled: (enabled) => set({ autoRunEnabled: enabled }),
  setLatestOutputsByNode: (map) => set({ latestOutputsByNode: map }),

  markNodeAndDownstreamStale: (nodeId) => {
    const { nodes, edges, staleNodeIds } = get();
    set({ staleNodeIds: computeStaleFromNode(nodeId, nodes, edges, staleNodeIds) });
  },

  clearStaleNodes: (nodeIds) => {
    if (!nodeIds) {
      set({ staleNodeIds: {} });
      return;
    }
    const next = { ...get().staleNodeIds };
    for (const id of nodeIds) delete next[id];
    set({ staleNodeIds: next });
  },

  setNodeRunStates: (map) => set({ nodeRunStatesById: map }),
  clearNodeRunStates: () => set({ nodeRunStatesById: {} }),
  setLatestExecutionByNode: (map) => set({ latestExecutionByNodeId: map }),
  clearLatestExecutionByNode: () => set({ latestExecutionByNodeId: {} }),
  setAutoRunPending: (flag) => set({ autoRunPending: flag }),
  setAutoRunQueued: (flag) => set({ autoRunQueued: flag }),
  setAutoRunInFlight: (flag) => set({ autoRunInFlight: flag }),

  updateMetaName: (name) => {
    set((s) => ({
      meta: s.meta ? { ...s.meta, name } : s.meta,
    }));
  },

  updateMetaRunStatus: (status, runAt) => {
    set((s) => ({
      meta: s.meta ? { ...s.meta, lastRunStatus: status, lastRunAt: runAt } : s.meta,
    }));
  },

  runWorkflow: async (opts) => {
    const { meta, dirty } = get();
    if (!meta) return;

    set({ isRunning: true });
    try {
      // Auto-save so the DB has the latest graph before running
      if (dirty) {
        await get().saveGraph();
      }

      // Resolve budget cap: explicit opt > localStorage default.
      // Always include so the engine can enforce it at runtime.
      const budgetCap: number =
        opts?.budgetCap !== undefined
          ? opts.budgetCap
          : readBudgetCapFromStorage();

      const res = await fetch(`/api/workflows/${meta.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetCap }),
      });
      if (!res.ok) throw new Error(`Failed to start run: ${res.status}`);
      const { id: runId } = (await res.json()) as { id: string };

      // Clear stale snapshot and persisted node-state badges immediately so the
      // debugger and canvas don't flash previous-run state while the SSE
      // connection is being established.
      set({ currentRunId: runId, debuggerOpen: true, debugSnapshot: null, replayRunId: null, nodeRunStatesById: {} });
    } catch (err) {
      console.error("[runWorkflow]", err);
    } finally {
      set({ isRunning: false });
    }
  },
}));
