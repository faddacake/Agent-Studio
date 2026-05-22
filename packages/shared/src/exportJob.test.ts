/**
 * Tests for the ExportJobPayload Zod schema.
 *
 * Validates that well-formed payloads pass and that specific invalid inputs
 * are rejected with the expected error paths. The schema is the single runtime
 * validator backend consumers use when receiving an export-job request.
 *
 * Run with: pnpm --filter /shared test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ExportJobPayloadSchema,
  ExportSceneEntrySchema,
  ExportTextOverlaySchema,
} from "./exportJob.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validScene(overrides: Record<string, unknown> = {}) {
  return {
    id: "scene-1",
    index: 0,
    type: "image",
    src: "scene-1.jpg",
    durationMs: 5000,
    startMs: 0,
    endMs: 5000,
    transition: "cut",
    fadeDurationMs: 0,
    fadeStartMs: 5000,
    textOverlay: null,
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-abc",
    aspectRatio: "16:9",
    totalDurationMs: 5000,
    scenes: [validScene()],
    ...overrides,
  };
}

// ── ExportTextOverlaySchema ───────────────────────────────────────────────────

describe("ExportTextOverlaySchema — valid inputs", () => {
  it("accepts a complete overlay", () => {
    const result = ExportTextOverlaySchema.safeParse({
      text: "Hello world",
      position: "bottom",
      style: "subtitle",
    });
    assert.ok(result.success);
  });

  it("accepts all position values", () => {
    for (const position of ["top", "center", "bottom"] as const) {
      const r = ExportTextOverlaySchema.safeParse({ text: "T", position, style: "title" });
      assert.ok(r.success, `position ${position} should be valid`);
    }
  });

  it("accepts all style values", () => {
    for (const style of ["subtitle", "title", "minimal"] as const) {
      const r = ExportTextOverlaySchema.safeParse({ text: "T", position: "top", style });
      assert.ok(r.success, `style ${style} should be valid`);
    }
  });
});

describe("ExportTextOverlaySchema — invalid inputs", () => {
  it("rejects empty text", () => {
    const r = ExportTextOverlaySchema.safeParse({ text: "", position: "top", style: "title" });
    assert.ok(!r.success);
  });

  it("rejects unknown position", () => {
    const r = ExportTextOverlaySchema.safeParse({ text: "T", position: "left", style: "title" });
    assert.ok(!r.success);
  });

  it("rejects unknown style", () => {
    const r = ExportTextOverlaySchema.safeParse({ text: "T", position: "top", style: "bold" });
    assert.ok(!r.success);
  });
});

// ── ExportSceneEntrySchema ────────────────────────────────────────────────────

describe("ExportSceneEntrySchema — valid inputs", () => {
  it("accepts a complete image scene entry", () => {
    assert.ok(ExportSceneEntrySchema.safeParse(validScene()).success);
  });

  it("accepts a video scene entry", () => {
    assert.ok(ExportSceneEntrySchema.safeParse(validScene({ type: "video", src: "v.mp4" })).success);
  });

  it("accepts an entry with a text overlay", () => {
    const r = ExportSceneEntrySchema.safeParse(
      validScene({ textOverlay: { text: "Hi", position: "top", style: "minimal" } }),
    );
    assert.ok(r.success);
  });

  it("accepts a fade scene entry with non-zero fadeDurationMs", () => {
    const r = ExportSceneEntrySchema.safeParse(
      validScene({ transition: "fade", fadeDurationMs: 800, fadeStartMs: 4200 }),
    );
    assert.ok(r.success);
  });
});

describe("ExportSceneEntrySchema — invalid inputs", () => {
  it("rejects empty id", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ id: "" })).success);
  });

  it("rejects negative index", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ index: -1 })).success);
  });

  it("rejects unknown type", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ type: "audio" })).success);
  });

  it("rejects empty src", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ src: "" })).success);
  });

  it("rejects zero durationMs", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ durationMs: 0 })).success);
  });

  it("rejects negative durationMs", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ durationMs: -100 })).success);
  });

  it("rejects negative fadeDurationMs", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ fadeDurationMs: -1 })).success);
  });

  it("rejects unknown transition", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ transition: "dissolve" })).success);
  });

  it("rejects invalid textOverlay shape", () => {
    assert.ok(!ExportSceneEntrySchema.safeParse(validScene({ textOverlay: { text: "" } })).success);
  });
});

// ── ExportJobPayloadSchema — valid ────────────────────────────────────────────

describe("ExportJobPayloadSchema — valid inputs", () => {
  it("accepts a minimal single-scene payload", () => {
    assert.ok(ExportJobPayloadSchema.safeParse(validPayload()).success);
  });

  it("accepts a multi-scene payload", () => {
    const payload = validPayload({
      totalDurationMs: 15000,
      scenes: [
        validScene({ id: "a", startMs: 0, endMs: 5000 }),
        validScene({ id: "b", index: 1, startMs: 5000, endMs: 13000, durationMs: 8000 }),
        validScene({ id: "c", index: 2, startMs: 13000, endMs: 15000, durationMs: 2000 }),
      ],
    });
    assert.ok(ExportJobPayloadSchema.safeParse(payload).success);
  });

  it("accepts all aspectRatio variants", () => {
    for (const ar of ["16:9", "9:16", "1:1"] as const) {
      const r = ExportJobPayloadSchema.safeParse(validPayload({ aspectRatio: ar }));
      assert.ok(r.success, `aspectRatio ${ar} should be valid`);
    }
  });

  it("accepts a scene with a text overlay", () => {
    const payload = validPayload({
      scenes: [validScene({ textOverlay: { text: "Caption", position: "bottom", style: "subtitle" } })],
    });
    assert.ok(ExportJobPayloadSchema.safeParse(payload).success);
  });

  it("accepts a fade scene", () => {
    const payload = validPayload({
      totalDurationMs: 10000,
      scenes: [
        validScene({ id: "a", transition: "fade", fadeDurationMs: 800, fadeStartMs: 4200 }),
        validScene({ id: "b", index: 1, startMs: 5000, endMs: 10000, durationMs: 5000 }),
      ],
    });
    assert.ok(ExportJobPayloadSchema.safeParse(payload).success);
  });
});

// ── ExportJobPayloadSchema — invalid ──────────────────────────────────────────

describe("ExportJobPayloadSchema — invalid inputs", () => {
  it("rejects empty projectId", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse(validPayload({ projectId: "" })).success);
  });

  it("rejects unknown aspectRatio", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse(validPayload({ aspectRatio: "4:3" })).success);
  });

  it("rejects zero totalDurationMs", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse(validPayload({ totalDurationMs: 0 })).success);
  });

  it("rejects negative totalDurationMs", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse(validPayload({ totalDurationMs: -1000 })).success);
  });

  it("rejects empty scenes array", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse(validPayload({ scenes: [] })).success);
  });

  it("rejects missing required top-level fields", () => {
    assert.ok(!ExportJobPayloadSchema.safeParse({ projectId: "x", aspectRatio: "16:9" }).success);
  });

  it("rejects an invalid scene entry within the scenes array", () => {
    const payload = validPayload({
      scenes: [validScene({ durationMs: -1 })],
    });
    assert.ok(!ExportJobPayloadSchema.safeParse(payload).success);
  });
});
