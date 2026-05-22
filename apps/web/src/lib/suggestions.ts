/**
 * Heuristic suggestion engine — no LLM, no network calls.
 * Given the currently selected node and the current workflow graph,
 * returns up to MAX_SUGGESTIONS action buttons to show in the Inspector.
 */

import type { WorkflowGraph, WorkflowNode } from "@iterastudio/shared";
import { NodeType, nodeRegistry } from "@iterastudio/shared";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
import { createWorkflowNode } from "@/components/canvas/createWorkflowNode";
import { useWorkflowStore, toFlowNode } from "@/stores/workflowStore";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  label: string;
  description?: string;
  action: () => void;
}

const MAX_SUGGESTIONS = 4;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Does the current node have any outgoing edge from the given output port? */
function hasOutgoingEdge(nodeId: string, sourceHandle: string, graph: WorkflowGraph): boolean {
  return graph.edges.some(
    (e) => e.source === nodeId && e.sourceHandle === sourceHandle,
  );
}

/** Is a node of the given type already present anywhere in the graph? */
function hasNodeType(type: string, graph: WorkflowGraph): boolean {
  return graph.nodes.some((n) => n.type === type);
}

/**
 * Create a new node and auto-connect it to the source node, then select it.
 * All changes are batched under a single undo step.
 */
function addAndConnect(
  sourceNode: WorkflowNode,
  sourceHandle: string,
  targetType: string,
  targetHandle: string,
): void {
  initializeNodeRegistry();
  const def = nodeRegistry.get(targetType);
  if (!def) return;

  const { pushHistory } = useWorkflowStore.getState();
  pushHistory();

  const pos = {
    x: (sourceNode.position?.x ?? 0) + 220,
    y: sourceNode.position?.y ?? 0,
  };
  const newNode = createWorkflowNode(def, pos);
  const flowNode = toFlowNode(newNode);

  const newEdge = {
    id: crypto.randomUUID(),
    source: sourceNode.id,
    sourceHandle,
    target: newNode.id,
    targetHandle,
    type: "default" as const,
    animated: true,
  };

  useWorkflowStore.setState((s) => ({
    nodes: [...s.nodes, flowNode],
    edges: [...s.edges, newEdge],
    selectedNodeId: newNode.id,
    inspectorOpen: true,
    dirty: true,
  }));
}

// ── Rules ──────────────────────────────────────────────────────────────────

type Rule = (node: WorkflowNode, graph: WorkflowGraph) => Suggestion | null;

const rules: Rule[] = [
  // image-generation or image-input → Add Resize (if image_out is unconnected)
  (node, graph) => {
    if (node.type !== NodeType.ImageGeneration && node.type !== NodeType.ImageInput) return null;
    if (hasOutgoingEdge(node.id, "image_out", graph)) return null;
    return {
      id: "add-resize",
      label: "Add Resize",
      description: "Chain a Resize transform after this node",
      action: () => addAndConnect(node, "image_out", NodeType.Resize, "image_in"),
    };
  },

  // image-generation or image-input → Add CLIP Scoring
  (node, graph) => {
    if (node.type !== NodeType.ImageGeneration && node.type !== NodeType.ImageInput) return null;
    if (hasNodeType(NodeType.ClipScoring, graph)) return null;
    return {
      id: "add-clip-scoring",
      label: "Add CLIP Scoring",
      description: "Score image quality or prompt relevance",
      action: () => addAndConnect(node, "image_out", NodeType.ClipScoring, "images_in"),
    };
  },

  // image-generation or image-input → Add Format Convert
  (node, graph) => {
    if (node.type !== NodeType.ImageGeneration && node.type !== NodeType.ImageInput) return null;
    if (hasNodeType(NodeType.FormatConvert, graph)) return null;
    return {
      id: "add-format-convert",
      label: "Add Format Convert",
      description: "Convert the image to a different format",
      action: () => addAndConnect(node, "image_out", NodeType.FormatConvert, "image_in"),
    };
  },

  // prompt-template → Add Image Generator
  (node, graph) => {
    if (node.type !== NodeType.PromptTemplate) return null;
    if (hasNodeType(NodeType.ImageGeneration, graph)) return null;
    return {
      id: "add-image-gen",
      label: "Add Image Generator",
      description: "Feed this prompt into an image generation node",
      action: () => addAndConnect(node, "text_out", NodeType.ImageGeneration, "prompt_in"),
    };
  },

  // clip-scoring → Add Ranking
  (node, graph) => {
    if (node.type !== NodeType.ClipScoring) return null;
    if (hasNodeType(NodeType.Ranking, graph)) return null;
    return {
      id: "add-ranking",
      label: "Add Ranking",
      description: "Rank scored images by quality",
      action: () => addAndConnect(node, "scores_out", NodeType.Ranking, "scores_in"),
    };
  },

  // best-of-n → Add CLIP Scoring (if not already present)
  (node, graph) => {
    if (node.type !== NodeType.BestOfN) return null;
    if (hasNodeType(NodeType.ClipScoring, graph)) return null;
    return {
      id: "add-clip-scoring-bon",
      label: "Add CLIP Scoring",
      description: "Score outputs from Best-of-N",
      action: () => addAndConnect(node, "all_candidates_out", NodeType.ClipScoring, "images_in"),
    };
  },

  // Any node with outputs and no outgoing edges → Connect to Output
  (node, graph) => {
    if (node.outputs.length === 0) return null;
    if (hasNodeType(NodeType.Output, graph)) return null;
    const firstOut = node.outputs[0];
    if (!firstOut) return null;
    if (hasOutgoingEdge(node.id, firstOut.id, graph)) return null;
    return {
      id: "add-output",
      label: "Connect to Output",
      description: "Add an Output node to collect results",
      action: () => addAndConnect(node, firstOut.id, NodeType.Output, "input"),
    };
  },
];

// ── Public API ─────────────────────────────────────────────────────────────

export function getSuggestions(node: WorkflowNode, graph: WorkflowGraph): Suggestion[] {
  const results: Suggestion[] = [];
  for (const rule of rules) {
    if (results.length >= MAX_SUGGESTIONS) break;
    const s = rule(node, graph);
    if (s) results.push(s);
  }
  return results;
}
