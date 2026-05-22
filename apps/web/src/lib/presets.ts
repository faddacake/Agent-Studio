/**
 * Quick-chain preset definitions for the slash command palette.
 * Each preset describes 2–4 nodes and their connecting edges.
 * No backend calls — pure client-side data.
 */

import { NodeType } from "@iterastudio/shared";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PresetEdgeSpec {
  /** Index into the preset's nodes array (source). */
  sourceIdx: number;
  sourceHandle: string;
  /** Index into the preset's nodes array (target). */
  targetIdx: number;
  targetHandle: string;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Extra search keywords beyond label/description. */
  keywords: string[];
  nodes: Array<{ type: string }>;
  edges: PresetEdgeSpec[];
}

// ── Preset catalog ─────────────────────────────────────────────────────────

export const PRESETS: Preset[] = [
  {
    id: "prompt-to-image",
    label: "Prompt → Image",
    description: "Prompt template wired to an image generation node",
    keywords: ["prompt", "image", "generate", "starter", "text", "pipeline"],
    nodes: [
      { type: NodeType.PromptTemplate },
      { type: NodeType.ImageGeneration },
    ],
    edges: [
      { sourceIdx: 0, sourceHandle: "text_out", targetIdx: 1, targetHandle: "prompt_in" },
    ],
  },
  {
    id: "image-resize-output",
    label: "Image → Resize → Output",
    description: "Load an image, resize it, and collect the result",
    keywords: ["image", "resize", "output", "transform", "starter"],
    nodes: [
      { type: NodeType.ImageInput },
      { type: NodeType.Resize },
      { type: NodeType.Output },
    ],
    edges: [
      { sourceIdx: 0, sourceHandle: "image_out", targetIdx: 1, targetHandle: "image_in" },
      { sourceIdx: 1, sourceHandle: "image_out", targetIdx: 2, targetHandle: "input" },
    ],
  },
  {
    id: "image-clip-ranking",
    label: "Image → CLIP → Ranking",
    description: "Score images with CLIP similarity and rank by quality",
    keywords: ["clip", "scoring", "ranking", "quality", "score", "evaluate"],
    nodes: [
      { type: NodeType.ImageInput },
      { type: NodeType.ClipScoring },
      { type: NodeType.Ranking },
    ],
    edges: [
      { sourceIdx: 0, sourceHandle: "image_out", targetIdx: 1, targetHandle: "images_in" },
      { sourceIdx: 1, sourceHandle: "scores_out", targetIdx: 2, targetHandle: "scores_in" },
    ],
  },
  {
    id: "prompt-to-video",
    label: "Prompt → Video",
    description: "Prompt template wired to a video generation node",
    keywords: ["prompt", "video", "generate", "starter", "kling", "pipeline"],
    nodes: [
      { type: NodeType.PromptTemplate },
      { type: NodeType.VideoGeneration },
    ],
    edges: [
      { sourceIdx: 0, sourceHandle: "text_out", targetIdx: 1, targetHandle: "prompt_in" },
    ],
  },
  {
    id: "full-pipeline",
    label: "Full Pipeline",
    description: "Prompt → generate image → convert format → output",
    keywords: [
      "full", "pipeline", "prompt", "image", "format", "output",
      "starter", "complete", "end to end",
    ],
    nodes: [
      { type: NodeType.PromptTemplate },
      { type: NodeType.ImageGeneration },
      { type: NodeType.FormatConvert },
      { type: NodeType.Output },
    ],
    edges: [
      { sourceIdx: 0, sourceHandle: "text_out",   targetIdx: 1, targetHandle: "prompt_in" },
      { sourceIdx: 1, sourceHandle: "image_out",  targetIdx: 2, targetHandle: "image_in"  },
      { sourceIdx: 2, sourceHandle: "image_out",  targetIdx: 3, targetHandle: "input"     },
    ],
  },
];

// ── Search helper ──────────────────────────────────────────────────────────

export function filterPresets(query: string): Preset[] {
  const q = query.toLowerCase().trim();
  if (!q) return PRESETS;
  return PRESETS.filter(
    (p) =>
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.keywords.some((k) => k.includes(q)),
  );
}
