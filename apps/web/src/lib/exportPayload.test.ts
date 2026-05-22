/**
 * Tests for the export-payload builder.
 *
 * Verifies that `buildExportPayload` maps `RenderPlan` fields faithfully,
 * drops UI-only data, and preserves ordering, transitions, fade windows,
 * and overlay payloads correctly for all scene-type combinations.
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRenderPlan } from "./renderPlan";
import { buildExportPayload } from "./exportPayload";
import type { Scene } from "./editorProjectTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function img(id: string, duration = 5, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "image", src: `${id}.jpg`, duration, ...overrides };
}

function vid(id: string, duration = 10, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "video", src: `${id}.mp4`, duration, ...overrides };
}

const overlay = { text: "Hello", position: "bottom" as const, style: "subtitle" as const };
const PROJECT_ID = "proj-123";
const ASPECT = "16:9" as const;

// ── Basic structure ───────────────────────────────────────────────────────────

describe("buildExportPayload — top-level fields", () => {
  const plan = buildRenderPlan([img("a", 5), img("b", 8)]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);

  it("projectId is forwarded", () => assert.equal(payload.projectId, PROJECT_ID));
  it("aspectRatio is forwarded", () => assert.equal(payload.aspectRatio, ASPECT));
  it("totalDurationMs matches plan", () => assert.equal(payload.totalDurationMs, plan.totalDurationMs));
  it("scene count matches plan", () => assert.equal(payload.scenes.length, plan.scenes.length));
});

// ── Per-scene field mapping ───────────────────────────────────────────────────

describe("buildExportPayload — scene field mapping", () => {
  const scenes = [img("a", 5), vid("v", 12, { naturalDuration: 30 })];
  const plan = buildRenderPlan(scenes);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);

  it("id, index, type, src are copied from plan", () => {
    const e = payload.scenes[0]!;
    assert.equal(e.id, "a");
    assert.equal(e.index, 0);
    assert.equal(e.type, "image");
    assert.equal(e.src, "a.jpg");
  });

  it("durationMs, startMs, endMs are copied from plan", () => {
    const e = payload.scenes[1]!;
    assert.equal(e.durationMs, plan.scenes[1]!.durationMs);
    assert.equal(e.startMs, plan.scenes[1]!.startMs);
    assert.equal(e.endMs, plan.scenes[1]!.endMs);
  });

  it("transition and fadeDurationMs are copied from plan", () => {
    const e = payload.scenes[0]!;
    assert.equal(e.transition, plan.scenes[0]!.transition);
    assert.equal(e.fadeDurationMs, plan.scenes[0]!.fadeDurationMs);
  });

  it("fadeStartMs is copied from plan", () => {
    const e = payload.scenes[0]!;
    assert.equal(e.fadeStartMs, plan.scenes[0]!.fadeStartMs);
  });
});

// ── naturalDurationMs omitted ─────────────────────────────────────────────────

describe("buildExportPayload — UI-only fields are omitted", () => {
  const plan = buildRenderPlan([vid("v", 10, { naturalDuration: 28.5 })]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const entry = payload.scenes[0]!;

  it("naturalDurationMs is not present in export entry", () => {
    assert.ok(!("naturalDurationMs" in entry), "naturalDurationMs should be absent");
  });
});

// ── Cut transition ────────────────────────────────────────────────────────────

describe("buildExportPayload — cut transition", () => {
  const plan = buildRenderPlan([img("a", 5, { transition: "cut" }), img("b", 5)]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const a = payload.scenes[0]!;

  it("transition is cut", () => assert.equal(a.transition, "cut"));
  it("fadeDurationMs = 0", () => assert.equal(a.fadeDurationMs, 0));
  it("fadeStartMs = endMs", () => assert.equal(a.fadeStartMs, a.endMs));
});

// ── Fade transition — default ─────────────────────────────────────────────────

describe("buildExportPayload — fade with default duration", () => {
  const plan = buildRenderPlan([
    img("a", 5, { transition: "fade" }),
    img("b", 5),
  ]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const a = payload.scenes[0]!;

  it("transition is fade", () => assert.equal(a.transition, "fade"));
  it("fadeDurationMs > 0", () => assert.ok(a.fadeDurationMs > 0));
  it("fadeStartMs = endMs − fadeDurationMs", () => {
    assert.equal(a.fadeStartMs, a.endMs - a.fadeDurationMs);
  });
});

// ── Fade transition — custom ──────────────────────────────────────────────────

describe("buildExportPayload — fade with custom fadeDurationMs", () => {
  const plan = buildRenderPlan([
    img("a", 5, { transition: "fade", fadeDurationMs: 1200 }),
    img("b", 5),
  ]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const a = payload.scenes[0]!;

  it("fadeDurationMs = 1200", () => assert.equal(a.fadeDurationMs, 1200));
  it("fadeStartMs = endMs − 1200", () => assert.equal(a.fadeStartMs, a.endMs - 1200));
});

// ── Last scene — no fade ──────────────────────────────────────────────────────

describe("buildExportPayload — last scene fade is suppressed", () => {
  const plan = buildRenderPlan([
    img("a", 5),
    img("b", 5, { transition: "fade" }),
  ]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const b = payload.scenes[1]!;

  it("fadeDurationMs = 0 on last scene", () => assert.equal(b.fadeDurationMs, 0));
  it("transition field preserved as authored", () => assert.equal(b.transition, "fade"));
  it("fadeStartMs = endMs", () => assert.equal(b.fadeStartMs, b.endMs));
});

// ── Overlay preservation ──────────────────────────────────────────────────────

describe("buildExportPayload — text overlay", () => {
  const plan = buildRenderPlan([
    img("a", 5, { textOverlay: overlay }),
    img("b", 5),
  ]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);

  it("textOverlay is preserved with all fields", () => {
    assert.deepEqual(payload.scenes[0]!.textOverlay, overlay);
  });

  it("textOverlay is null when absent", () => {
    assert.equal(payload.scenes[1]!.textOverlay, null);
  });
});

// ── Mixed image and video ─────────────────────────────────────────────────────

describe("buildExportPayload — mixed scene types", () => {
  const plan = buildRenderPlan([img("a", 5), vid("v", 12), img("b", 3)]);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);

  it("types are preserved in order", () => {
    assert.equal(payload.scenes[0]!.type, "image");
    assert.equal(payload.scenes[1]!.type, "video");
    assert.equal(payload.scenes[2]!.type, "image");
  });

  it("totalDurationMs = 20000", () => assert.equal(payload.totalDurationMs, 20000));

  it("scenes are contiguous", () => {
    assert.equal(payload.scenes[1]!.startMs, 5000);
    assert.equal(payload.scenes[2]!.startMs, 17000);
  });
});

// ── Aspect ratio variants ─────────────────────────────────────────────────────

describe("buildExportPayload — aspect ratio", () => {
  const plan = buildRenderPlan([img("a", 5)]);

  it("forwards 16:9", () => assert.equal(buildExportPayload(plan, "p", "16:9").aspectRatio, "16:9"));
  it("forwards 9:16", () => assert.equal(buildExportPayload(plan, "p", "9:16").aspectRatio, "9:16"));
  it("forwards 1:1",  () => assert.equal(buildExportPayload(plan, "p", "1:1").aspectRatio, "1:1"));
});

// ── Invariants ────────────────────────────────────────────────────────────────

describe("buildExportPayload — structural invariants", () => {
  const scenes: Scene[] = [
    img("a", 3, { transition: "fade" }),
    vid("v", 7, { transition: "fade", fadeDurationMs: 500 }),
    img("b", 2, { textOverlay: overlay }),
    img("c", 5),
  ];
  const plan = buildRenderPlan(scenes);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);

  it("totalDurationMs = sum of durationMs", () => {
    const sum = payload.scenes.reduce((acc: number, e) => acc + e.durationMs, 0);
    assert.equal(payload.totalDurationMs, sum);
  });

  it("every entry: endMs = startMs + durationMs", () => {
    for (const e of payload.scenes) {
      assert.equal(e.endMs, e.startMs + e.durationMs, `failed for ${e.id}`);
    }
  });

  it("every entry: fadeStartMs = endMs − fadeDurationMs", () => {
    for (const e of payload.scenes) {
      assert.equal(e.fadeStartMs, e.endMs - e.fadeDurationMs, `failed for ${e.id}`);
    }
  });

  it("index field matches array position", () => {
    payload.scenes.forEach((e: { index: number }, i: number) => assert.equal(e.index, i));
  });

  it("last scene fadeDurationMs = 0", () => {
    const last = payload.scenes[payload.scenes.length - 1]!;
    assert.equal(last.fadeDurationMs, 0);
  });
});
