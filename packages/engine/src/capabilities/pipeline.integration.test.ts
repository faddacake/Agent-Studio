/**
 * End-to-end integration test for the full candidate-aware pipeline:
 *
 *   Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle
 *
 * Uses mock provider output (simulated raw image URLs) as pipeline input.
 * Each stage is invoked directly via its executor function with the output
 * of the previous stage wired as input — the thinnest true integration path
 * that exercises candidate normalization, scoring, ranking, formatting,
 * and export manifest construction.
 *
 * All assertions verify that upstream metadata (scores, ranks, social content,
 * asset references) is preserved through every stage.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type {
  NodeExecutionContext,
  NodeExecutionResult,
  CandidateCollection,
  CandidateSelection,
  CandidateItem,
} from "@iterastudio/shared";

import { executeClipScoring } from "./clipScoring.js";
import { executeRanking } from "./ranking.js";
import { executeSocialFormat } from "./socialFormat.js";
import { executeExportBundle } from "./exportBundle.js";

// ── Helpers ──

/** Build a minimal NodeExecutionContext for a capability executor. */
function makeContext(
  nodeId: string,
  inputs: Record<string, unknown>,
  params: Record<string, unknown> = {},
): NodeExecutionContext {
  return {
    nodeId,
    runId: "test-run-001",
    inputs,
    params,
    outputDir: "/tmp/aistudio-test",
  };
}

// ── Test constants ──

/** Simulated raw image outputs from a mock ImageGen provider node. */
const MOCK_IMAGE_URLS = [
  "https://cdn.example.com/img-001.png",
  "https://cdn.example.com/img-002.png",
  "https://cdn.example.com/img-003.png",
  "https://cdn.example.com/img-004.png",
  "https://cdn.example.com/img-005.png",
  "https://cdn.example.com/img-006.png",
  "https://cdn.example.com/img-007.png",
  "https://cdn.example.com/img-008.png",
];

const MOCK_PROMPT = "a futuristic city skyline at sunset";

const TOP_K = 3;
const PLATFORMS = ["instagram", "x", "linkedin"];

// ── Pipeline test ──

describe("Full pipeline integration: Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle", () => {
  // Shared state — each stage stores its result for the next stage
  let clipResult: NodeExecutionResult;
  let rankingResult: NodeExecutionResult;
  let socialResult: NodeExecutionResult;
  let exportResult: NodeExecutionResult;

  // ── Stage 1+2: Simulated Prompt + ImageGen ──
  // These are provider nodes — we mock their output as raw image URLs.
  // The real integration point is ClipScoring consuming raw arrays.

  it("Stage 1-2: mock provider output enters pipeline as raw image array", async () => {
    // ClipScoring accepts raw image arrays via ensureCollection()
    clipResult = await executeClipScoring(
      makeContext("node-clip", {
        images_in: MOCK_IMAGE_URLS,
        prompt_in: MOCK_PROMPT,
      }, {
        model: "open_clip",
        normalizeScores: true,
      }),
      {} as any, // definition not used by executor
    );

    assert.ok(clipResult, "ClipScoring should return a result");
    assert.ok(clipResult.outputs, "ClipScoring should have outputs");
  });

  // ── Stage 3: ClipScoring ──

  it("Stage 3: ClipScoring attaches score metadata to candidates", () => {
    const scored = clipResult.outputs.scored_images_out as CandidateCollection;
    const scores = clipResult.outputs.scores_out as number[];

    // Collection shape
    assert.ok(Array.isArray(scored.items), "scored_images_out should have items array");
    assert.equal(scored.items.length, MOCK_IMAGE_URLS.length, "should score all images");
    assert.equal(scored.collectionType, "scored", "collectionType should be 'scored'");
    assert.equal(scored.producedByNodeId, "node-clip", "producedByNodeId should match");

    // Backward-compatible scores array
    assert.ok(Array.isArray(scores), "scores_out should be a number array");
    assert.equal(scores.length, MOCK_IMAGE_URLS.length, "scores array length should match images");
    scores.forEach((s, i) => {
      assert.equal(typeof s, "number", `score[${i}] should be a number`);
      assert.ok(s >= 0 && s <= 100, `score[${i}] should be in 0-100 range (got ${s})`);
    });

    // Per-item score structure
    for (const item of scored.items) {
      assert.ok(item.id, "each candidate should have an id");
      assert.equal(item.type, "image", "each candidate type should be 'image'");
      assert.ok(item.value, "each candidate should have a value");
      assert.ok(Array.isArray(item.scores), "each candidate should have scores array");
      assert.ok(item.scores!.length >= 1, "each candidate should have at least one score");

      const clipScore = item.scores!.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, "each candidate should have a clip_similarity score");
      assert.equal(typeof clipScore!.value, "number", "score.value should be a number");
      assert.equal(typeof clipScore!.normalized, "number", "score.normalized should be a number");
      assert.equal(clipScore!.model, "open_clip", "score.model should be 'open_clip'");
    }

    // Rank fields should be assigned
    const ranks = scored.items.map((item) => item.rank).filter((r) => r !== undefined);
    assert.equal(ranks.length, scored.items.length, "all items should have rank assigned");

    // Ranks should be 1-based sequential
    const sortedRanks = [...ranks].sort((a, b) => a! - b!);
    assert.deepEqual(
      sortedRanks,
      Array.from({ length: scored.items.length }, (_, i) => i + 1),
      "ranks should be 1-based sequential",
    );
  });

  it("Stage 3: ClipScoring output is deterministic", async () => {
    const secondRun = await executeClipScoring(
      makeContext("node-clip-2", {
        images_in: MOCK_IMAGE_URLS,
        prompt_in: MOCK_PROMPT,
      }, {
        model: "open_clip",
        normalizeScores: true,
      }),
      {} as any,
    );

    const firstScores = clipResult.outputs.scores_out as number[];
    const secondScores = secondRun.outputs.scores_out as number[];

    assert.deepEqual(firstScores, secondScores, "scores should be deterministic across runs");
  });

  // ── Stage 4: Ranking ──

  it("Stage 4: Ranking sorts and selects candidates correctly", async () => {
    const scoredCollection = clipResult.outputs.scored_images_out as CandidateCollection;

    rankingResult = await executeRanking(
      makeContext("node-ranking", {
        items_in: scoredCollection,
      }, {
        mode: "topK",
        topK: TOP_K,
      }),
      {} as any,
    );

    assert.ok(rankingResult, "Ranking should return a result");
    assert.ok(rankingResult.outputs, "Ranking should have outputs");

    // Top selection
    const topItems = rankingResult.outputs.top_items_out as CandidateSelection;
    assert.ok(topItems, "top_items_out should exist");
    assert.equal(topItems.items.length, TOP_K, `should select top ${TOP_K} items`);
    assert.equal(topItems.selectionMode, "topK", "selectionMode should be 'topK'");
    assert.equal(topItems.selectionMetric, "clip_similarity", "selectionMetric should match");
    assert.equal(topItems.totalBeforeSelection, MOCK_IMAGE_URLS.length, "totalBeforeSelection should match input count");

    // Ranked collection (all items)
    const ranked = rankingResult.outputs.ranked_items_out as CandidateCollection;
    assert.equal(ranked.items.length, MOCK_IMAGE_URLS.length, "ranked should contain all items");
    assert.equal(ranked.collectionType, "ranked", "collectionType should be 'ranked'");

    // Verify sort order — ranks should be 1, 2, 3, ... and scores descending
    for (let i = 0; i < ranked.items.length; i++) {
      assert.equal(ranked.items[i].rank, i + 1, `ranked item ${i} should have rank ${i + 1}`);
    }

    // Verify scores are in descending order
    for (let i = 1; i < ranked.items.length; i++) {
      const prevScore = ranked.items[i - 1].scores?.find((s) => s.metric === "clip_similarity")?.normalized ?? 0;
      const currScore = ranked.items[i].scores?.find((s) => s.metric === "clip_similarity")?.normalized ?? 0;
      assert.ok(prevScore >= currScore, `ranked items should be in descending score order (item ${i - 1}: ${prevScore}, item ${i}: ${currScore})`);
    }

    // Top items should preserve scores from ClipScoring
    for (const item of topItems.items) {
      assert.ok(item.scores, "top item should preserve scores");
      const clipScore = item.scores!.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, "top item should still have clip_similarity score");
      assert.ok(item.rank, "top item should have rank");
    }
  });

  // ── Stage 5: SocialFormat ──

  it("Stage 5: SocialFormat attaches platform-ready social metadata per candidate", async () => {
    const topItems = rankingResult.outputs.top_items_out as CandidateSelection;

    socialResult = await executeSocialFormat(
      makeContext("node-social", {
        candidates_in: topItems,
      }, {
        platforms: PLATFORMS,
        tone: "professional",
        topic: "AI art, digital creation",
        includeHashtags: true,
        includeCTA: true,
      }),
      {} as any,
    );

    assert.ok(socialResult, "SocialFormat should return a result");
    assert.ok(socialResult.outputs, "SocialFormat should have outputs");

    const formatted = socialResult.outputs.formatted_out as CandidateCollection;
    assert.ok(formatted, "formatted_out should exist");
    assert.equal(formatted.items.length, TOP_K, "should format all selected candidates");
    assert.equal(formatted.collectionType, "formatted", "collectionType should be 'formatted'");

    // Verify social metadata per candidate per platform
    for (const item of formatted.items) {
      assert.ok(item.metadata, `candidate ${item.id} should have metadata`);
      const socialVariants = item.metadata!.socialVariants as Record<string, unknown>;
      assert.ok(socialVariants, `candidate ${item.id} should have socialVariants in metadata`);

      for (const platform of PLATFORMS) {
        const variant = socialVariants[platform] as Record<string, unknown>;
        assert.ok(variant, `candidate ${item.id} should have variant for ${platform}`);
        assert.equal(typeof variant.caption, "string", `${platform} variant should have caption`);
        assert.equal(typeof variant.hook, "string", `${platform} variant should have hook`);
        assert.ok(Array.isArray(variant.hashtags), `${platform} variant should have hashtags array`);
        assert.ok((variant.hashtags as string[]).length > 0, `${platform} hashtags should not be empty`);
        assert.equal(typeof variant.cta, "string", `${platform} variant should have cta`);
        assert.ok(variant.cta, `${platform} CTA should not be empty (includeCTA=true)`);
        assert.equal(typeof variant.title, "string", `${platform} variant should have title`);
        assert.ok(variant.imageSpec, `${platform} variant should have imageSpec`);
      }

      // Verify upstream metadata preserved: scores from ClipScoring, rank from Ranking
      assert.ok(item.scores, `formatted candidate ${item.id} should preserve scores`);
      const clipScore = item.scores!.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, `formatted candidate ${item.id} should still have clip_similarity score`);
      assert.ok(item.rank, `formatted candidate ${item.id} should preserve rank`);
    }
  });

  // ── Stage 6: ExportBundle ──

  it("Stage 6: ExportBundle builds a final export manifest from enriched candidate data", async () => {
    const formatted = socialResult.outputs.formatted_out as CandidateCollection;

    exportResult = await executeExportBundle(
      makeContext("node-export", {
        candidates_in: formatted,
      }, {
        bundleName: "test-campaign-spring-2026",
        format: "manifest-only",
        includeImages: true,
        includeMetadata: true,
        includeSocialText: true,
        includeScores: true,
      }),
      {} as any,
    );

    assert.ok(exportResult, "ExportBundle should return a result");
    assert.ok(exportResult.outputs, "ExportBundle should have outputs");
  });

  it("Stage 6: export manifest preserves upstream metadata", () => {
    const manifest = exportResult.outputs.bundle_out as Record<string, unknown>;
    const exportedCandidates = exportResult.outputs.candidates_out as CandidateCollection;

    // ── Manifest shape ──
    assert.equal(manifest.bundleName, "test-campaign-spring-2026", "bundleName should match");
    assert.equal(manifest.format, "manifest-only", "format should match");
    assert.equal(typeof manifest.createdAt, "string", "createdAt should be a string");
    assert.equal(manifest.candidateCount, TOP_K, "candidateCount should match selected count");

    // ── Assets ──
    const assets = manifest.assets as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(assets), "assets should be an array");
    assert.equal(assets.length, TOP_K, "should have one asset per candidate");

    for (const asset of assets) {
      assert.ok(asset.candidateId, "asset should have candidateId");
      assert.equal(asset.type, "image", "asset type should be 'image'");
      assert.ok(asset.assetRef, "asset should have assetRef (the image URL)");

      // Scores preserved
      assert.ok(Array.isArray(asset.scores), "asset should include scores");
      const scores = asset.scores as Array<Record<string, unknown>>;
      const clipAssetScore = scores.find((s) => s.metric === "clip_similarity");
      assert.ok(clipAssetScore, "asset scores should include clip_similarity");

      // Rank preserved
      assert.ok(asset.rank, "asset should include rank");
    }

    // ── Social entries ──
    const socialEntries = manifest.socialEntries as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(socialEntries), "socialEntries should be an array");
    assert.equal(
      socialEntries.length,
      TOP_K * PLATFORMS.length,
      `should have ${TOP_K} x ${PLATFORMS.length} = ${TOP_K * PLATFORMS.length} social entries`,
    );

    for (const entry of socialEntries) {
      assert.ok(entry.candidateId, "social entry should have candidateId");
      assert.ok(PLATFORMS.includes(entry.platform as string), `platform should be one of ${PLATFORMS.join(", ")}`);
      assert.equal(typeof entry.caption, "string", "social entry should have caption");
      assert.ok(Array.isArray(entry.hashtags), "social entry should have hashtags");
      assert.equal(typeof entry.hook, "string", "social entry should have hook");
      assert.equal(typeof entry.cta, "string", "social entry should have cta");
    }

    // ── Summary ──
    const summary = manifest.summary as Record<string, unknown>;
    assert.ok(summary, "manifest should have summary");
    assert.equal(summary.totalCandidates, TOP_K, "summary totalCandidates should match");
    assert.equal(typeof summary.topScore, "number", "summary should have topScore");
    assert.equal(typeof summary.topRank, "number", "summary should have topRank");
    assert.ok(Array.isArray(summary.platforms), "summary should have platforms array");
    assert.equal(summary.hasScores, true, "summary hasScores should be true");
    assert.equal(summary.hasSocialData, true, "summary hasSocialData should be true");

    // ── Metadata ──
    const meta = manifest.metadata as Record<string, unknown>;
    assert.ok(meta, "manifest should have metadata");
    assert.equal(meta.producedByNodeId, "node-export", "metadata should track producing node");

    // ── Exported candidates ──
    assert.ok(exportedCandidates, "candidates_out should exist");
    assert.equal(exportedCandidates.items.length, TOP_K, "exported candidates count should match");

    for (const item of exportedCandidates.items) {
      // Export metadata attached
      assert.equal(item.metadata?.exportBundleName, "test-campaign-spring-2026", "should attach export bundle name");
      assert.equal(item.metadata?.exportFormat, "manifest-only", "should attach export format");
      assert.ok(item.metadata?.exportedAt, "should attach exportedAt timestamp");

      // Upstream scores still present
      assert.ok(item.scores, "exported candidate should preserve scores");
      const clipScore = item.scores!.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, "exported candidate should preserve clip_similarity score");

      // Upstream rank still present
      assert.ok(item.rank, "exported candidate should preserve rank");

      // Social variants still present
      assert.ok(item.metadata?.socialVariants, "exported candidate should preserve socialVariants");
    }
  });

  // ── Cross-stage integrity ──

  it("Cross-stage: no stage drops previously attached metadata", () => {
    const exportedCandidates = exportResult.outputs.candidates_out as CandidateCollection;

    for (const item of exportedCandidates.items) {
      // From ClipScoring (stage 3)
      const clipScore = item.scores?.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, "clip_similarity score survives all stages");
      assert.equal(clipScore!.model, "open_clip", "score model survives all stages");

      // From Ranking (stage 4)
      assert.ok(typeof item.rank === "number" && item.rank >= 1, "rank survives all stages");

      // From SocialFormat (stage 5)
      const variants = item.metadata?.socialVariants as Record<string, unknown>;
      assert.ok(variants, "socialVariants survive all stages");
      for (const platform of PLATFORMS) {
        assert.ok(variants[platform], `${platform} variant survives all stages`);
      }

      // From ExportBundle (stage 6)
      assert.ok(item.metadata?.exportBundleName, "exportBundleName survives to final output");
      assert.ok(item.metadata?.exportedAt, "exportedAt survives to final output");
    }
  });

  it("Cross-stage: candidate IDs are stable across the entire pipeline", () => {
    // Gather IDs from ClipScoring output
    const clipIds = (clipResult.outputs.scored_images_out as CandidateCollection).items.map((i) => i.id);

    // Gather IDs from the final export output
    const exportIds = (exportResult.outputs.candidates_out as CandidateCollection).items.map((i) => i.id);

    // The exported IDs should be a subset of the scored IDs (since ranking selects topK)
    for (const id of exportIds) {
      assert.ok(clipIds.includes(id), `exported candidate ${id} should trace back to ClipScoring output`);
    }

    // No duplicate IDs
    const uniqueExportIds = new Set(exportIds);
    assert.equal(uniqueExportIds.size, exportIds.length, "exported candidate IDs should be unique");
  });
});
