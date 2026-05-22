/**
 * Best-of-N capability executor.
 *
 * Closes the generation → scoring → ranking → selection loop:
 *
 *   1. Generate N image candidates via a swappable GeneratorAdapter
 *      (MockGeneratorAdapter by default; FalGeneratorAdapter when FAL_API_KEY
 *       is set; any custom adapter injected via context.params.__generator)
 *   2. Score them with executeClipScoring (existing capability)
 *   3. Rank and select top K with executeRanking (existing capability)
 *   4. Return canonical CandidateSelection + full CandidateCollection
 *
 * Replacing the default generator with a new provider requires only swapping
 * step 1 — the scoring/ranking/serialization pipeline is unchanged.
 *
 * Node type: "best-of-n"
 */

import crypto from "node:crypto";

import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  CandidateItem,
} from "@iterastudio/shared";
import { toCollection } from "@iterastudio/shared";

import { writeArtifact } from "../local/imageUtils.js";
import { executeClipScoring } from "./clipScoring.js";
import { executeRanking } from "./ranking.js";
import {
  type GeneratorAdapter,
  createGenerator,
} from "./generator.js";

// ── Generator resolution ───────────────────────────────────────────────────

/**
 * Resolve the GeneratorAdapter to use for this execution.
 *
 * Resolution order:
 *   1. `context.params.__generator` — injected adapter (tests / advanced usage)
 *   2. provider="mock" (or no provider) — MockGeneratorAdapter (intentional dev fallback)
 *   3. real provider (e.g. "fal") + apiKey (DB or env) — real adapter
 *   4. real provider + no apiKey — throws with actionable error
 */
function resolveGenerator(context: NodeExecutionContext): GeneratorAdapter {
  const injected = context.params.__generator;
  if (injected && typeof (injected as GeneratorAdapter).generate === "function") {
    return injected as GeneratorAdapter;
  }

  // Default to "mock" when params.provider is unset — aligns with the parameterSchema
  // defaultValue and ensures fresh canvas nodes work without a key configured.
  // Nodes explicitly set to "fal" (via inspector or template) will still use the real provider.
  const provider = (context.params.provider as string | undefined) ?? "mock";
  const modelId  = context.params.model as string | undefined;
  // __apiKey is injected by the dispatch layer (DB key takes precedence; env var is the fallback).
  // Trim the env var for safety — .env.local files sometimes have leading/trailing spaces.
  const apiKey   = (context.params.__apiKey as string | undefined) ?? process.env.FAL_API_KEY?.trim();

  // When the user explicitly selects a real provider (anything other than "mock"),
  // a configured API key is required.  Fail clearly so the user knows what to fix
  // rather than silently producing mock images in a production-like run.
  if (provider !== "mock" && !apiKey) {
    throw new Error(
      `Provider "${provider}" is not configured. ` +
      `Add your API key in Settings → Providers to run this workflow.`,
    );
  }

  return createGenerator({ provider, modelId, apiKey });
}

// ── Executor ───────────────────────────────────────────────────────────────

export async function executeBestOfN(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params, outputDir, runId, nodeId } = context;

  const prompt = (inputs.prompt_in as string | undefined) ?? (params.prompt as string | undefined);
  const n      = Math.max(1, Math.round(Number(params.n ?? 4)));
  const k      = Math.max(1, Math.min(n, Math.round(Number(params.k ?? 2))));

  const generator = resolveGenerator(context);

  // Derive the base seed.
  //   - params.seed takes precedence (explicit workflow param — enables reproducible runs)
  //   - Otherwise derive deterministically from the prompt text
  //   - Fall back to 42 when no prompt is provided
  const baseSeed: number =
    params.seed !== undefined && params.seed !== null
      ? (Math.round(Number(params.seed)) & 0x7fffffff)
      : prompt
        ? [...prompt].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 256, 0)
        : 42;

  // ── Step 1: Generate N image candidates ───────────────────────────────

  const candidates: CandidateItem[] = [];

  for (let i = 0; i < n; i++) {
    // Per-candidate seed: encodes both base seed and candidate index so
    // each slot always resolves to the same image (for mock) or a reproducible
    // variation (for real providers that honour the seed param).
    const candidateSeed = (baseSeed * 1000 + i) & 0x7fffffff;

    const generated = await generator.generate({
      prompt:  prompt ?? "abstract art",
      width:   512,
      height:  512,
      seed:    candidateSeed,
      signal:  context.signal,
    });

    // Normalise format string for writeArtifact (strip "image/" prefix).
    const format = generated.mimeType.replace(/^image\//, "") === "jpeg"
      ? "jpeg"
      : "png";

    const ref = await writeArtifact({
      buffer:    generated.buffer,
      outputDir,
      runId,
      nodeId,
      suffix:    `gen-${i}`,
      format,
      width:     generated.width,
      height:    generated.height,
    });

    candidates.push({
      id:           crypto.randomUUID(),
      type:         "image",
      value:        ref,        // ArtifactRef — fully serializable
      prompt,
      sourceNodeId: nodeId,
    });
  }

  const generatedCollection = toCollection(candidates, "generated", nodeId);

  // ── Step 2: Score candidates via existing executeClipScoring ──────────

  const scoringCtx: NodeExecutionContext = {
    nodeId:    `${nodeId}-scoring`,
    runId,
    inputs:    { images_in: generatedCollection, prompt_in: prompt },
    params:    { normalizeScores: true },
    outputDir,
  };

  const scoringResult = await executeClipScoring(scoringCtx, _definition);
  const scoredCollection = scoringResult.outputs.scored_images_out;

  // ── Step 3: Rank and select top K via existing executeRanking ─────────

  const rankingCtx: NodeExecutionContext = {
    nodeId:    `${nodeId}-ranking`,
    runId,
    inputs:    { items_in: scoredCollection },
    params:    { mode: "topK", topK: k },
    outputDir,
  };

  const rankingResult = await executeRanking(rankingCtx, _definition);

  // ── Return canonical outputs ───────────────────────────────────────────

  return {
    outputs: {
      selection_out:      rankingResult.outputs.top_items_out,     // CandidateSelection (top K)
      all_candidates_out: rankingResult.outputs.ranked_items_out,  // CandidateCollection (all N, ranked)
    },
    cost: 0,
    metadata: {
      n,
      k,
      promptProvided:   !!prompt,
      mock:             generator.kind === "mock",
      generatedCount:   n,
      selectedCount:    k,
      generatorKind:    generator.kind,
    },
  };
}
