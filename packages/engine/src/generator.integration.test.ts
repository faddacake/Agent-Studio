/**
 * Generator adapter integration tests.
 *
 * Verifies the GeneratorAdapter abstraction:
 *
 *   1. MockGeneratorAdapter produces valid PNG buffers with correct dimensions
 *   2. Mock output is deterministic — same seed → same bytes
 *   3. Different seeds produce distinct image data
 *   4. createGenerator factory returns the correct adapter type
 *   5. executeBestOfN accepts a custom adapter via context.params.__generator
 *   6. Injected adapters surface their kind in result metadata
 *
 * No network calls, no external services.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import type { NodeExecutionContext } from "@aistudio/shared";
import { isArtifactRef, type CandidateCollection } from "@aistudio/shared";

import {
  MockGeneratorAdapter,
  FalGeneratorAdapter,
  ReplicateGeneratorAdapter,
  FalVideoGeneratorAdapter,
  createGenerator,
  createVideoGenerator,
  isFalVideoModelId,
  type GeneratorAdapter,
  type GenerateOpts,
  type GeneratedImage,
} from "./capabilities/generator.js";
import { executeBestOfN } from "./capabilities/bestOfN.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const OUTPUT_DIR = "/tmp/aistudio-test";

function makeBonCtx(
  params: Record<string, unknown>,
  prompt?: string,
): NodeExecutionContext {
  return {
    nodeId:    crypto.randomUUID(),
    runId:     "gen-" + crypto.randomUUID().slice(0, 8),
    inputs:    prompt ? { prompt_in: prompt } : {},
    params,
    outputDir: OUTPUT_DIR,
  };
}

// ── MockGeneratorAdapter ───────────────────────────────────────────────────

describe("MockGeneratorAdapter", () => {
  it("returns a non-empty PNG Buffer", async () => {
    const adapter = new MockGeneratorAdapter();
    const result  = await adapter.generate({ prompt: "test", seed: 42 });

    assert.ok(Buffer.isBuffer(result.buffer), "buffer should be a Buffer");
    assert.ok(result.buffer.length > 0,       "buffer should be non-empty");
    assert.equal(result.mimeType, "image/png", "mimeType should be image/png");
  });

  it("honours requested dimensions (64×64)", async () => {
    const adapter = new MockGeneratorAdapter();
    const result  = await adapter.generate({ prompt: "test", width: 64, height: 64, seed: 0 });

    assert.equal(result.width,  64, "width should match requested 64");
    assert.equal(result.height, 64, "height should match requested 64");
  });

  it("honours requested dimensions (128×256)", async () => {
    const adapter = new MockGeneratorAdapter();
    const result  = await adapter.generate({ prompt: "test", width: 128, height: 256, seed: 1 });

    assert.equal(result.width,  128, "width should match requested 128");
    assert.equal(result.height, 256, "height should match requested 256");
  });

  it("is deterministic — same seed produces identical bytes", async () => {
    const adapter = new MockGeneratorAdapter();
    const opts: GenerateOpts = { prompt: "city skyline", width: 64, height: 64, seed: 99 };

    const [r1, r2] = await Promise.all([
      adapter.generate(opts),
      adapter.generate(opts),
    ]);

    assert.ok(r1.buffer.equals(r2.buffer), "same seed should produce identical buffers");
  });

  it("different seeds produce different image bytes", async () => {
    const adapter = new MockGeneratorAdapter();
    const base = { prompt: "landscape", width: 64, height: 64 };

    const r1 = await adapter.generate({ ...base, seed: 0 });
    const r2 = await adapter.generate({ ...base, seed: 1 });

    assert.ok(!r1.buffer.equals(r2.buffer), "different seeds should produce different images");
  });

  it("has kind === 'mock'", () => {
    const adapter = new MockGeneratorAdapter();
    assert.equal(adapter.kind, "mock");
  });
});

// ── FalGeneratorAdapter ────────────────────────────────────────────────────

describe("FalGeneratorAdapter", () => {
  it("has kind === 'fal'", () => {
    const adapter = new FalGeneratorAdapter("fake-key");
    assert.equal(adapter.kind, "fal");
  });

  it("accepts a custom modelId", () => {
    const adapter = new FalGeneratorAdapter("key", "fal-ai/flux-pro/v1.1");
    assert.equal(adapter.kind, "fal");
  });
});

// ── ReplicateGeneratorAdapter ──────────────────────────────────────────────

describe("ReplicateGeneratorAdapter", () => {
  it("has kind === 'replicate'", () => {
    const adapter = new ReplicateGeneratorAdapter("fake-token");
    assert.equal(adapter.kind, "replicate");
  });

  it("accepts a custom modelSlug", () => {
    const adapter = new ReplicateGeneratorAdapter("fake-token", "stability-ai/sdxl");
    assert.equal(adapter.kind, "replicate");
  });
});

// ── FalVideoGeneratorAdapter ───────────────────────────────────────────────

describe("FalVideoGeneratorAdapter", () => {
  it("has kind === 'fal-video'", () => {
    const adapter = new FalVideoGeneratorAdapter("fake-key");
    assert.equal(adapter.kind, "fal-video");
  });

  it("accepts a custom modelId", () => {
    const adapter = new FalVideoGeneratorAdapter("key", "fal-ai/kling-video/v1.6/standard/text-to-video");
    assert.equal(adapter.kind, "fal-video");
  });
});

// ── isFalVideoModelId ──────────────────────────────────────────────────────

describe("isFalVideoModelId", () => {
  it("returns true for Kling model ID", () => {
    assert.equal(isFalVideoModelId("fal-ai/kling-video/v1.6/standard/text-to-video"), true);
  });

  it("returns true for any fal-ai/kling-video prefix", () => {
    assert.equal(isFalVideoModelId("fal-ai/kling-video/v2/pro/text-to-video"), true);
  });

  it("returns false for FLUX image model ID", () => {
    assert.equal(isFalVideoModelId("fal-ai/flux/schnell"), false);
  });

  it("returns false for unrelated model ID", () => {
    assert.equal(isFalVideoModelId("stability-ai/sdxl"), false);
  });
});

// ── createVideoGenerator factory ───────────────────────────────────────────

describe("createVideoGenerator factory", () => {
  it("returns FalVideoGeneratorAdapter when provider=fal and apiKey is provided", () => {
    const adapter = createVideoGenerator({ provider: "fal", apiKey: "fal-test-key" });
    assert.equal(adapter.kind, "fal-video");
  });

  it("returns FalVideoGeneratorAdapter when FAL_API_KEY env var is set", () => {
    const savedKey = process.env.FAL_API_KEY;
    process.env.FAL_API_KEY = "env-key";

    const adapter = createVideoGenerator({ provider: "fal" });
    assert.equal(adapter.kind, "fal-video");

    if (savedKey !== undefined) process.env.FAL_API_KEY = savedKey;
    else delete process.env.FAL_API_KEY;
  });

  it("throws when no API key is available for fal provider", () => {
    const savedKey = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;

    assert.throws(
      () => createVideoGenerator({ provider: "fal" }),
      /not configured/,
      "should throw with actionable message when no key",
    );

    if (savedKey !== undefined) process.env.FAL_API_KEY = savedKey;
  });

  it("throws for unknown provider", () => {
    assert.throws(
      () => createVideoGenerator({ provider: "unknown-provider", apiKey: "key" }),
      /not configured/,
    );
  });
});

// ── createGenerator factory ────────────────────────────────────────────────

describe("createGenerator factory", () => {
  it("returns MockGeneratorAdapter when no apiKey is provided", () => {
    // Ensure FAL_API_KEY is not set in test env
    const savedKey = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;

    const adapter = createGenerator({});
    assert.equal(adapter.kind, "mock", "should fall back to mock when no key");

    if (savedKey !== undefined) process.env.FAL_API_KEY = savedKey;
  });

  it("returns MockGeneratorAdapter when provider is unknown", () => {
    const adapter = createGenerator({ provider: "unknown-provider", apiKey: "somekey" });
    assert.equal(adapter.kind, "mock", "unknown provider should fall back to mock");
  });

  it("returns FalGeneratorAdapter when provider=fal and apiKey is provided", () => {
    const adapter = createGenerator({ provider: "fal", apiKey: "fal-test-key" });
    assert.equal(adapter.kind, "fal", "should return fal adapter when key is provided");
  });

  it("returns FalGeneratorAdapter when FAL_API_KEY env var is set", () => {
    const savedKey = process.env.FAL_API_KEY;
    process.env.FAL_API_KEY = "env-key";

    const adapter = createGenerator({ provider: "fal" });
    assert.equal(adapter.kind, "fal", "should use FAL_API_KEY env var");

    if (savedKey !== undefined) process.env.FAL_API_KEY = savedKey;
    else delete process.env.FAL_API_KEY;
  });

  it("returns ReplicateGeneratorAdapter when provider=replicate and apiKey is provided", () => {
    const adapter = createGenerator({ provider: "replicate", apiKey: "r8_test-token" });
    assert.equal(adapter.kind, "replicate", "should return replicate adapter when token is provided");
  });

  it("returns ReplicateGeneratorAdapter when REPLICATE_API_TOKEN env var is set", () => {
    const savedKey = process.env.REPLICATE_API_TOKEN;
    process.env.REPLICATE_API_TOKEN = "r8_env-token";

    const adapter = createGenerator({ provider: "replicate" });
    assert.equal(adapter.kind, "replicate", "should use REPLICATE_API_TOKEN env var");

    if (savedKey !== undefined) process.env.REPLICATE_API_TOKEN = savedKey;
    else delete process.env.REPLICATE_API_TOKEN;
  });

  it("does not pick up REPLICATE_API_TOKEN when provider=fal", () => {
    const savedFal = process.env.FAL_API_KEY;
    const savedRep = process.env.REPLICATE_API_TOKEN;
    delete process.env.FAL_API_KEY;
    process.env.REPLICATE_API_TOKEN = "r8_should-not-be-used";

    const adapter = createGenerator({ provider: "fal" });
    assert.equal(adapter.kind, "mock", "fal provider should not use REPLICATE_API_TOKEN");

    if (savedFal !== undefined) process.env.FAL_API_KEY = savedFal;
    if (savedRep !== undefined) process.env.REPLICATE_API_TOKEN = savedRep;
    else delete process.env.REPLICATE_API_TOKEN;
  });
});

// ── Adapter injection into executeBestOfN ─────────────────────────────────

describe("executeBestOfN with injected generator", () => {
  it("uses an injected MockGeneratorAdapter and reflects kind in metadata", async () => {
    const injected = new MockGeneratorAdapter();

    const result = await executeBestOfN(
      makeBonCtx({ n: 3, k: 2, __generator: injected }, "injection test"),
      {} as never,
    );

    assert.equal(result.metadata?.generatorKind, "mock",  "generatorKind should be mock");
    assert.equal(result.metadata?.mock,          true,    "mock flag should be true");
    assert.equal(result.metadata?.n,             3,       "n should be 3");
    assert.equal(result.metadata?.k,             2,       "k should be 2");
  });

  it("custom adapter — all candidates are valid ArtifactRefs", async () => {
    const injected = new MockGeneratorAdapter();

    const result = await executeBestOfN(
      makeBonCtx({ n: 4, k: 2, __generator: injected }, "artifact test"),
      {} as never,
    );

    const all = result.outputs.all_candidates_out as CandidateCollection;
    assert.equal(all.items.length, 4, "should generate exactly 4 candidates");
    for (const item of all.items) {
      assert.ok(isArtifactRef(item.value), "each candidate value should be ArtifactRef");
    }
  });

  it("custom adapter — non-mock kind surfaces correctly in metadata", async () => {
    /** Minimal stub that reports a custom kind (simulates a future provider). */
    const stubAdapter: GeneratorAdapter = {
      kind: "stub-provider",
      async generate(_opts: GenerateOpts): Promise<GeneratedImage> {
        // Return the same tiny PNG that MockGeneratorAdapter would produce
        const real = new MockGeneratorAdapter();
        return real.generate({ ..._opts, seed: 7 });
      },
    };

    const result = await executeBestOfN(
      makeBonCtx({ n: 2, k: 1, __generator: stubAdapter }, "custom provider test"),
      {} as never,
    );

    assert.equal(result.metadata?.generatorKind, "stub-provider",
      "generatorKind should reflect the injected adapter's kind");
    assert.equal(result.metadata?.mock, false,
      "mock should be false for non-mock adapters");
  });

  it("injection falls back gracefully when __generator is not a valid adapter", async () => {
    // If the injected value lacks .generate(), resolveGenerator falls through
    // to createGenerator().  provider:"mock" avoids needing a real API key.
    const result = await executeBestOfN(
      makeBonCtx({ n: 2, k: 1, provider: "mock", __generator: "not-an-adapter" }, "fallback test"),
      {} as never,
    );

    assert.equal(result.metadata?.generatorKind, "mock", "should fall back to mock");
  });
});
