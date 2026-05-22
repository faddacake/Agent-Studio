import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  CandidateScore,
} from "@iterastudio/shared";
import {
  ensureCollection,
  attachScores,
  rankByMetric,
  takeTopK,
  toCollection,
} from "@iterastudio/shared";

/** The scoring metric name used by CLIP scoring. */
const CLIP_METRIC = "clip_similarity";

/**
 * Mock CLIP scoring function.
 *
 * Generates deterministic pseudo-random scores based on image index
 * and prompt length. This will be replaced with a real CLIP model
 * integration (e.g. open_clip via a Python sidecar or ONNX runtime).
 */
function mockClipScore(_value: unknown, prompt: string | undefined, index: number): number {
  const baseSeed = index * 17 + 42;
  const promptFactor = prompt ? (prompt.length % 20) / 20 : 0.5;
  const rawScore = ((baseSeed * 13 + 7) % 100) / 100;
  return rawScore * 0.6 + promptFactor * 0.4;
}

/**
 * CLIP Scoring capability executor.
 *
 * Accepts either:
 * - Raw image array on `images_in` (backward compatible)
 * - A CandidateCollection on `images_in` (candidate-aware)
 *
 * Outputs:
 * - `scores_out`: numeric score array (for backward-compatible chaining)
 * - `scored_images_out`: CandidateCollection with scores attached and items ranked
 */
export async function executeClipScoring(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // Normalize input — works with raw arrays or CandidateCollections
  const collection = ensureCollection(inputs.images_in, "image", context.nodeId);

  if (collection.items.length === 0) {
    throw new Error("ClipScoring: no images provided in images_in port");
  }

  const prompt = inputs.prompt_in as string | undefined;
  const normalizeScores = (params.normalizeScores as boolean) ?? true;
  const topKPreview = params.topKPreview as number | undefined;
  const model = (params.model as string) ?? "open_clip";

  // Score each candidate
  const rawScores = collection.items.map((item, i) =>
    mockClipScore(item.value, prompt ?? item.prompt, i),
  );

  // Normalize to 0–100 if requested
  let normalizedScores: number[];
  if (normalizeScores && rawScores.length > 0) {
    const minScore = Math.min(...rawScores);
    const maxScore = Math.max(...rawScores);
    const range = maxScore - minScore;
    normalizedScores = range > 0
      ? rawScores.map((s) => Math.round(((s - minScore) / range) * 100))
      : rawScores.map(() => 50);
  } else {
    normalizedScores = rawScores.map((s) => Math.round(s * 100));
  }

  // Attach scores to candidates using the shared contract
  const scored = attachScores(collection, (_item, i): CandidateScore => ({
    metric: CLIP_METRIC,
    value: rawScores[i],
    normalized: normalizedScores[i],
    model,
  }));

  // Rank by CLIP metric and apply topK if specified
  let resultItems = rankByMetric(scored.items, CLIP_METRIC);
  if (topKPreview) {
    resultItems = takeTopK(scored.items, topKPreview, CLIP_METRIC);
  }

  const resultCollection = toCollection(resultItems, "scored", context.nodeId);

  return {
    outputs: {
      scores_out: normalizedScores,
      scored_images_out: resultCollection,
    },
    cost: 0,
    metadata: {
      model,
      imageCount: collection.items.length,
      promptProvided: !!prompt,
      metric: CLIP_METRIC,
      mock: true,
    },
  };
}
