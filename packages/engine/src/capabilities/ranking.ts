import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@iterastudio/shared";
import {
  ensureCollection,
  isCandidateCollection,
  getScore,
  rankByMetric,
  takeTopK,
  filterByThreshold,
  toSelection,
  toCollection,
  attachScore,
} from "@iterastudio/shared";

/** Default metric name when scores arrive as a raw array. */
const DEFAULT_METRIC = "score";

/**
 * Ranking capability executor.
 *
 * Accepts either:
 * - Candidate-aware: a CandidateCollection on `items_in` (scores already attached)
 * - Legacy: parallel arrays on `items_in` + `scores_in`
 *
 * Outputs:
 * - `top_items_out`: CandidateSelection with selected items
 * - `ranked_items_out`: CandidateCollection with all items ranked
 */
export async function executeRanking(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  const mode = (params.mode as string) ?? "topK";
  const topK = (params.topK as number) ?? 5;
  const threshold = params.threshold as number | undefined;

  // Determine the scoring metric to rank by
  let metric = DEFAULT_METRIC;
  let collection = ensureCollection(inputs.items_in, "image", context.nodeId);

  if (isCandidateCollection(inputs.items_in)) {
    // Candidate-aware path — items already have scores attached
    // Use the first available metric from the items
    const firstWithScores = collection.items.find((item) => item.scores && item.scores.length > 0);
    if (firstWithScores?.scores?.[0]) {
      metric = firstWithScores.scores[0].metric;
    }
  } else {
    // Legacy path — parallel items + scores arrays
    const rawScores = inputs.scores_in;
    const scores: number[] = Array.isArray(rawScores)
      ? rawScores.map((s) => (typeof s === "number" ? s : Number(s) || 0))
      : [];

    if (scores.length === 0) {
      throw new Error("Ranking: no scores provided in scores_in port");
    }

    if (collection.items.length !== scores.length) {
      throw new Error(
        `Ranking: items (${collection.items.length}) and scores (${scores.length}) arrays must have equal length`,
      );
    }

    // Attach scores to candidates from the parallel array
    collection = {
      ...collection,
      items: collection.items.map((item, i) =>
        attachScore(item, { metric, value: scores[i], normalized: scores[i] }),
      ),
    };
  }

  if (collection.items.length === 0) {
    throw new Error("Ranking: no items provided in items_in port");
  }

  // Rank all items
  const rankedItems = rankByMetric(collection.items, metric);
  const totalBefore = rankedItems.length;

  // Select based on mode
  let selectedItems;
  switch (mode) {
    case "topK":
      selectedItems = takeTopK(collection.items, topK, metric);
      break;

    case "threshold":
      selectedItems = threshold !== undefined
        ? filterByThreshold(collection.items, metric, threshold)
        : rankedItems;
      // Re-rank the filtered set
      selectedItems = selectedItems.map((item, i) => ({ ...item, rank: i + 1 }));
      break;

    case "sort":
      selectedItems = rankedItems;
      break;

    default:
      selectedItems = takeTopK(collection.items, topK, metric);
  }

  const selection = toSelection(
    selectedItems,
    totalBefore,
    mode as "topK" | "threshold" | "sort",
    metric,
    context.nodeId,
  );

  const rankedCollection = toCollection(rankedItems, "ranked", context.nodeId);

  return {
    outputs: {
      top_items_out: selection,
      ranked_items_out: rankedCollection,
    },
    cost: 0,
    metadata: {
      mode,
      metric,
      inputCount: totalBefore,
      selectedCount: selectedItems.length,
    },
  };
}
