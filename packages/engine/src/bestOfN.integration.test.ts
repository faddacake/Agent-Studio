/**
 * Best-of-N integration tests.
 *
 * Verifies the full generation → scoring → ranking → selection pipeline:
 *
 * 1. The executor generates exactly N serializable ArtifactRef candidates
 * 2. Each candidate is scored via executeClipScoring (existing path)
 * 3. Top K are selected via executeRanking (existing path)
 * 4. Output matches canonical CandidateSelection shape
 * 5. All outputs are JSON-serializable (no Buffer anywhere)
 * 6. Selection is downstream-compatible (SocialFormat, ExportBundle)
 * 7. Generation is deterministic — same prompt → same score ordering
 *
 * No external services, no network calls, no non-deterministic behaviour.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  isArtifactRef,
  isCandidateCollection,
  type CandidateCollection,
  type CandidateSelection,
  type NodeExecutionContext,
} from "@iterastudio/shared";

import { executeBestOfN }       from "./capabilities/bestOfN.js";
import { executeSocialFormat }  from "./capabilities/socialFormat.js";
import { executeExportBundle }  from "./capabilities/exportBundle.js";

// ── Helpers ──

const OUTPUT_DIR = "/tmp/aistudio-test";

function makeBonCtx(
  params: Record<string, unknown>,
  prompt?: string,
): NodeExecutionContext {
  return {
    nodeId:    crypto.randomUUID(),
    runId:     "bon-" + crypto.randomUUID().slice(0, 8),
    inputs:    prompt ? { prompt_in: prompt } : {},
    // Default to "mock" so tests run without a real API key.
    // Individual tests can override by passing provider in params.
    params:    { provider: "mock", ...params },
    outputDir: OUTPUT_DIR,
  };
}

/**
 * Deep-check that a value contains no Buffer or Uint8Array instances.
 * Throws with the path if one is found; returns true otherwise.
 */
function assertBufferFree(value: unknown, path = "root"): true {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    throw new Error(`Buffer/Uint8Array found at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertBufferFree(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertBufferFree(v, `${path}.${k}`);
    }
  }
  return true;
}

// ── Suites ──

describe("Best-of-N executor", () => {

  // ──────────────────────────────────────────────────────────────────────────
  // Basic generation contract
  // ──────────────────────────────────────────────────────────────────────────

  describe("generates N serializable ArtifactRef candidates", () => {
    it("produces exactly N candidates in all_candidates_out", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "a futuristic city"),
        {} as never,
      );

      const all = result.outputs.all_candidates_out as CandidateCollection;
      assert.ok(isCandidateCollection(all), "all_candidates_out must be CandidateCollection");
      assert.equal(all.items.length, 4, "should have generated exactly 4 candidates");
    });

    it("every candidate value is an ArtifactRef (not a Buffer)", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 3, k: 1 }, "sunset over ocean"),
        {} as never,
      );

      const all = result.outputs.all_candidates_out as CandidateCollection;
      for (const item of all.items) {
        assert.ok(isArtifactRef(item.value),
          `item.value should be ArtifactRef (got ${typeof item.value})`);
        assert.ok(!Buffer.isBuffer(item.value),
          "item.value must not be a raw Buffer");
      }
    });

    it("each ArtifactRef has kind=local-file, mimeType=image/png, and sizeBytes > 0", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 3, k: 1 }, "mountain landscape"),
        {} as never,
      );

      const all = result.outputs.all_candidates_out as CandidateCollection;
      for (const item of all.items) {
        const ref = item.value as ReturnType<typeof isArtifactRef extends (v: unknown) => v is infer R ? (v: unknown) => v is R : never>;
        const r   = item.value as { kind: string; mimeType: string; sizeBytes?: number; filename: string };
        assert.equal(r.kind,     "local-file",  "kind should be local-file");
        assert.equal(r.mimeType, "image/png",   "mimeType should be image/png");
        assert.ok(typeof r.sizeBytes === "number" && r.sizeBytes > 0, "sizeBytes should be > 0");
        assert.ok(r.filename.endsWith(".png"), "filename should end with .png");
      }
    });

    it("works with n=1, k=1 (minimum valid parameters)", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 1, k: 1 }, "single image"),
        {} as never,
      );
      const sel = result.outputs.selection_out as CandidateSelection;
      assert.equal(sel.items.length, 1, "should select exactly 1 candidate");
      assert.ok(isArtifactRef(sel.items[0].value), "item should be ArtifactRef");
    });

    it("works without a prompt (prompt_in omitted)", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 2, k: 1 }),
        {} as never,
      );
      assert.equal(result.metadata?.promptProvided, false, "promptProvided should be false");
      const all = result.outputs.all_candidates_out as CandidateCollection;
      assert.equal(all.items.length, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scoring path
  // ──────────────────────────────────────────────────────────────────────────

  describe("candidates are scored via existing CLIP scoring path", () => {
    it("every candidate has at least one score attached", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "abstract expressionism"),
        {} as never,
      );

      const all = result.outputs.all_candidates_out as CandidateCollection;
      for (const item of all.items) {
        assert.ok(
          Array.isArray(item.scores) && item.scores.length > 0,
          `candidate ${item.id} should have scores attached`,
        );
        assert.ok(
          item.scores!.every((s) => typeof s.value === "number"),
          "all score values should be numbers",
        );
      }
    });

    it("scores are distinct across candidates (scoring differentiates them)", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "prompt for scoring test"),
        {} as never,
      );

      const all    = result.outputs.all_candidates_out as CandidateCollection;
      const scores = all.items.map((item) => item.scores?.[0]?.normalized ?? 0);
      const unique = new Set(scores);
      assert.ok(unique.size > 1, "scores should not all be identical — need distinct values for ranking");
    });

    it("all candidates have rank assigned after ranking step", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "ranked prompt"),
        {} as never,
      );

      const all = result.outputs.all_candidates_out as CandidateCollection;
      const ranks = all.items.map((item) => item.rank).filter((r) => r !== undefined);
      assert.equal(ranks.length, all.items.length, "every candidate should have a rank");
      // Ranks should be 1-based consecutive integers (1..n)
      const sortedRanks = [...ranks].sort((a, b) => a! - b!);
      sortedRanks.forEach((r, i) => {
        assert.equal(r, i + 1, `rank at position ${i} should be ${i + 1}`);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Selection contract
  // ──────────────────────────────────────────────────────────────────────────

  describe("top K are selected via existing ranking path", () => {
    it("selection_out contains exactly K items", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 5, k: 3 }, "selection test"),
        {} as never,
      );

      const sel = result.outputs.selection_out as CandidateSelection;
      assert.equal(sel.items.length, 3, "selection should contain exactly 3 items");
    });

    it("selection_out has canonical CandidateSelection shape", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "shape test"),
        {} as never,
      );

      const sel = result.outputs.selection_out as CandidateSelection;
      assert.ok("selectionMode" in sel,         "should have selectionMode");
      assert.ok("totalBeforeSelection" in sel,   "should have totalBeforeSelection");
      assert.equal(sel.selectionMode,           "topK",  "selectionMode should be topK");
      assert.equal(sel.totalBeforeSelection,    4,       "totalBeforeSelection should equal N");
      assert.equal(sel.collectionType,          "selected", "collectionType should be selected");
    });

    it("k is clamped to n when k > n", async () => {
      // k=10 with n=3 — should select at most 3
      const result = await executeBestOfN(
        makeBonCtx({ n: 3, k: 10 }, "clamp test"),
        {} as never,
      );
      const sel = result.outputs.selection_out as CandidateSelection;
      assert.ok(sel.items.length <= 3, "selection must not exceed N candidates");
    });

    it("metadata carries correct n, k, and mock=true", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "metadata test"),
        {} as never,
      );
      assert.equal(result.metadata?.n,    4,    "metadata.n should be 4");
      assert.equal(result.metadata?.k,    2,    "metadata.k should be 2");
      assert.equal(result.metadata?.mock, true, "metadata.mock should be true");
      assert.equal(result.cost,           0,    "cost should be 0 for mock generation");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Serialization guarantee
  // ──────────────────────────────────────────────────────────────────────────

  describe("all outputs are JSON-serializable", () => {
    it("result.outputs passes JSON.stringify without throwing", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "serialize test"),
        {} as never,
      );

      assert.doesNotThrow(
        () => JSON.stringify(result.outputs),
        "result.outputs must be JSON.stringify-safe",
      );
    });

    it("no Buffer or Uint8Array appears anywhere in result.outputs", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "buffer-free test"),
        {} as never,
      );

      assertBufferFree(result.outputs);
    });

    it("selection_out and all_candidates_out are both independently serializable", async () => {
      const result = await executeBestOfN(
        makeBonCtx({ n: 3, k: 2 }, "independent serialize"),
        {} as never,
      );

      assert.doesNotThrow(() => JSON.stringify(result.outputs.selection_out));
      assert.doesNotThrow(() => JSON.stringify(result.outputs.all_candidates_out));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Determinism
  // ──────────────────────────────────────────────────────────────────────────

  describe("generation is deterministic for the same prompt", () => {
    it("two runs with the same prompt produce the same score ordering", async () => {
      const params  = { n: 4, k: 2 };
      const prompt  = "determinism test prompt";

      const [r1, r2] = await Promise.all([
        executeBestOfN(makeBonCtx(params, prompt), {} as never),
        executeBestOfN(makeBonCtx(params, prompt), {} as never),
      ]);

      const scores1 = (r1.outputs.all_candidates_out as CandidateCollection)
        .items.map((item) => item.scores?.[0]?.normalized);
      const scores2 = (r2.outputs.all_candidates_out as CandidateCollection)
        .items.map((item) => item.scores?.[0]?.normalized);

      assert.deepEqual(
        scores1,
        scores2,
        "score ordering should be identical for the same prompt",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Downstream compatibility
  // ──────────────────────────────────────────────────────────────────────────

  describe("output is compatible with SocialFormat and ExportBundle", () => {
    it("selection_out flows into SocialFormat without errors", async () => {
      const bonResult = await executeBestOfN(
        makeBonCtx({ n: 4, k: 2 }, "social-format pipeline"),
        {} as never,
      );

      const socialCtx: NodeExecutionContext = {
        nodeId:    crypto.randomUUID(),
        runId:     "bon-social-test",
        inputs:    { candidates_in: bonResult.outputs.selection_out },
        params:    { platforms: ["instagram", "x"], tone: "professional" },
        outputDir: OUTPUT_DIR,
      };

      const socialResult = await executeSocialFormat(socialCtx, {} as never);
      const formatted = socialResult.outputs.formatted_out as CandidateCollection;

      assert.ok(isCandidateCollection(formatted), "formatted_out should be CandidateCollection");
      assert.equal(formatted.items.length, 2, "should have 2 formatted candidates");
      assert.doesNotThrow(() => JSON.stringify(socialResult.outputs));
    });

    it("selection_out flows into ExportBundle and produces a serializable manifest", async () => {
      const bonResult = await executeBestOfN(
        makeBonCtx({ n: 3, k: 2 }, "export pipeline"),
        {} as never,
      );

      const exportCtx: NodeExecutionContext = {
        nodeId:    crypto.randomUUID(),
        runId:     "bon-export-test",
        inputs:    { candidates_in: bonResult.outputs.selection_out },
        params:    { bundleName: "best-of-n-bundle", format: "manifest-only" },
        outputDir: OUTPUT_DIR,
      };

      const exportResult = await executeExportBundle(exportCtx, {} as never);
      const manifest = exportResult.outputs.bundle_out as Record<string, unknown>;

      assert.ok(typeof manifest === "object" && manifest !== null, "bundle_out should be an object");
      assert.doesNotThrow(
        () => JSON.stringify(manifest),
        "export manifest must be JSON-serializable",
      );
      assertBufferFree(manifest);

      const assets = manifest.assets as Array<{ assetRef: unknown }>;
      assert.equal(assets.length, 2, "manifest should have 2 assets (top K selected)");
      for (const asset of assets) {
        assert.ok(isArtifactRef(asset.assetRef),
          "every manifest assetRef should be an ArtifactRef");
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full end-to-end pipeline: generation → scoring → ranking → selection
  // ──────────────────────────────────────────────────────────────────────────

  describe("end-to-end: generation → scoring → ranking → selection", () => {
    it("complete pipeline produces a valid, serializable CandidateSelection", async () => {
      // This test intentionally mirrors what a real workflow node graph would do:
      //   prompt_in → [best-of-n] → selection_out → [social-format] → formatted_out → [export-bundle] → bundle_out

      const prompt = "a futuristic city skyline at sunset";

      // Step 1: best-of-n (generation + scoring + ranking in one node)
      const bonResult = await executeBestOfN(
        makeBonCtx({ n: 5, k: 2 }, prompt),
        {} as never,
      );

      const selection = bonResult.outputs.selection_out as CandidateSelection;
      assert.equal(selection.items.length, 2, "should select top 2 from 5");
      assert.equal(selection.selectionMode, "topK");
      assert.equal(selection.totalBeforeSelection, 5);

      // Every item must be an ArtifactRef
      for (const item of selection.items) {
        assert.ok(isArtifactRef(item.value), "each selected item must be ArtifactRef");
        assert.ok(item.scores && item.scores.length > 0, "each selected item must have scores");
        assert.ok(typeof item.rank === "number", "each selected item must have a rank");
      }

      // Step 2: social format
      const socialResult = await executeSocialFormat(
        {
          nodeId:    crypto.randomUUID(),
          runId:     "e2e-test",
          inputs:    { candidates_in: selection },
          params:    { platforms: ["instagram"], tone: "bold" },
          outputDir: OUTPUT_DIR,
        },
        {} as never,
      );

      const formatted = socialResult.outputs.formatted_out as CandidateCollection;
      assert.equal(formatted.items.length, 2);

      // Step 3: export bundle
      const exportResult = await executeExportBundle(
        {
          nodeId:    crypto.randomUUID(),
          runId:     "e2e-test",
          inputs:    { candidates_in: formatted },
          params:    { bundleName: "e2e-bundle" },
          outputDir: OUTPUT_DIR,
        },
        {} as never,
      );

      const manifest = exportResult.outputs.bundle_out as Record<string, unknown>;

      // Full pipeline output must be serializable end-to-end
      assert.doesNotThrow(() => JSON.stringify(manifest));
      assertBufferFree(manifest);

      // Manifest integrity
      assert.equal(manifest.candidateCount, 2);
      const assets = manifest.assets as Array<{ assetRef: unknown }>;
      assert.equal(assets.length, 2);
      for (const asset of assets) {
        assert.ok(isArtifactRef(asset.assetRef));
      }
    });
  });
});
