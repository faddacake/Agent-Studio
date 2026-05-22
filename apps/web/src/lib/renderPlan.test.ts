/**
 * Tests for the render-plan serialization layer.
 *
 * Each suite targets one aspect of the contract: timeline positions, fade
 * windows, overlay payloads, video context, and cross-cutting invariants that
 * must hold regardless of scene composition.
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRenderPlan } from "./renderPlan";
import type { Scene, TextOverlay } from "./editorProjectTypes";
import { DEFAULT_FADE_MS } from "./sceneTiming";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function img(id: string, duration = 5, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "image", src: `${id}.jpg`, duration, ...overrides };
}

function vid(id: string, duration = 10, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "video", src: `${id}.mp4`, duration, ...overrides };
}

const overlay: TextOverlay = { text: "Hello", position: "bottom", style: "subtitle" };

// ── Empty timeline ────────────────────────────────────────────────────────────

describe("buildRenderPlan — empty scene list", () => {
  it("returns zero total duration and empty scenes array", () => {
    const plan = buildRenderPlan([]);
    assert.equal(plan.totalDurationMs, 0);
    assert.equal(plan.scenes.length, 0);
  });
});

// ── Single image scene ────────────────────────────────────────────────────────

describe("buildRenderPlan — single image scene", () => {
  const plan = buildRenderPlan([img("a", 5)]);
  const entry = plan.scenes[0]!;

  it("has one scene entry", () => assert.equal(plan.scenes.length, 1));
  it("totalDurationMs equals scene duration in ms", () => assert.equal(plan.totalDurationMs, 5000));

  it("entry fields match source scene", () => {
    assert.equal(entry.id, "a");
    assert.equal(entry.index, 0);
    assert.equal(entry.type, "image");
    assert.equal(entry.src, "a.jpg");
  });

  it("startMs = 0, endMs = 5000, durationMs = 5000", () => {
    assert.equal(entry.startMs, 0);
    assert.equal(entry.endMs, 5000);
    assert.equal(entry.durationMs, 5000);
  });

  it("transition defaults to cut when absent", () => assert.equal(entry.transition, "cut"));
  it("fadeDurationMs = 0 (last scene, no fade)", () => assert.equal(entry.fadeDurationMs, 0));
  it("fadeStartMs equals endMs when fadeDurationMs is 0", () => assert.equal(entry.fadeStartMs, entry.endMs));
  it("textOverlay is null", () => assert.equal(entry.textOverlay, null));
  it("naturalDurationMs is null for image scene", () => assert.equal(entry.naturalDurationMs, null));
});

// ── Single video scene ────────────────────────────────────────────────────────

describe("buildRenderPlan — single video scene", () => {
  const scene = vid("v", 12, { naturalDuration: 28.5 });
  const plan = buildRenderPlan([scene]);
  const entry = plan.scenes[0]!;

  it("type is video", () => assert.equal(entry.type, "video"));
  it("src is the artifact path", () => assert.equal(entry.src, "v.mp4"));
  it("durationMs = 12000", () => assert.equal(entry.durationMs, 12000));
  it("naturalDurationMs = 28500 (naturalDuration * 1000)", () => assert.equal(entry.naturalDurationMs, 28500));
  it("naturalDurationMs is null when naturalDuration is absent", () => {
    const plan2 = buildRenderPlan([vid("v2", 10)]);
    assert.equal(plan2.scenes[0]!.naturalDurationMs, null);
  });
});

// ── Timeline positions — three scenes ────────────────────────────────────────

describe("buildRenderPlan — timeline positions (three scenes)", () => {
  // [A:5s, B:8s, C:3s] → total 16 s
  const plan = buildRenderPlan([img("a", 5), img("b", 8), img("c", 3)]);
  const [a, b, c] = plan.scenes;

  it("totalDurationMs = 16000", () => assert.equal(plan.totalDurationMs, 16000));
  it("scene count = 3", () => assert.equal(plan.scenes.length, 3));

  it("A: startMs=0, endMs=5000", () => {
    assert.equal(a!.startMs, 0);
    assert.equal(a!.endMs, 5000);
  });

  it("B: startMs=5000, endMs=13000", () => {
    assert.equal(b!.startMs, 5000);
    assert.equal(b!.endMs, 13000);
  });

  it("C: startMs=13000, endMs=16000", () => {
    assert.equal(c!.startMs, 13000);
    assert.equal(c!.endMs, 16000);
  });

  it("entries are in scene-list order (index matches position)", () => {
    assert.equal(a!.index, 0);
    assert.equal(b!.index, 1);
    assert.equal(c!.index, 2);
  });

  it("consecutive endMs/startMs are contiguous", () => {
    assert.equal(a!.endMs, b!.startMs);
    assert.equal(b!.endMs, c!.startMs);
  });

  it("totalDurationMs equals last entry endMs", () => {
    assert.equal(plan.totalDurationMs, c!.endMs);
  });
});

// ── Cut transition ────────────────────────────────────────────────────────────

describe("buildRenderPlan — cut transition", () => {
  const plan = buildRenderPlan([
    img("a", 5, { transition: "cut" }),
    img("b", 5),
  ]);
  const a = plan.scenes[0]!;

  it("transition is cut", () => assert.equal(a.transition, "cut"));
  it("fadeDurationMs = 0 for cut", () => assert.equal(a.fadeDurationMs, 0));
  it("fadeStartMs = endMs for cut", () => assert.equal(a.fadeStartMs, a.endMs));
});

// ── Fade transition — default duration ────────────────────────────────────────

describe("buildRenderPlan — fade with default fadeDurationMs", () => {
  // Scene A (5 s, fade) → B (5 s): default 800 ms fade, 50% cap = 2500 ms → 800 wins
  const plan = buildRenderPlan([
    img("a", 5, { transition: "fade" }),
    img("b", 5),
  ]);
  const a = plan.scenes[0]!;
  const b = plan.scenes[1]!;

  it("transition is fade", () => assert.equal(a.transition, "fade"));
  it("fadeDurationMs equals DEFAULT_FADE_MS", () => assert.equal(a.fadeDurationMs, DEFAULT_FADE_MS));
  it("fadeStartMs = endMs − fadeDurationMs", () => {
    assert.equal(a.fadeStartMs, a.endMs - DEFAULT_FADE_MS);
  });
  it("last scene has fadeDurationMs = 0 even if transition = fade", () => {
    assert.equal(b.fadeDurationMs, 0);
  });
});

// ── Fade transition — custom duration ────────────────────────────────────────

describe("buildRenderPlan — fade with custom fadeDurationMs", () => {
  const custom = 1200;
  const plan = buildRenderPlan([
    img("a", 5, { transition: "fade", fadeDurationMs: custom }),
    img("b", 5),
  ]);
  const a = plan.scenes[0]!;

  it("fadeDurationMs uses authored value", () => assert.equal(a.fadeDurationMs, custom));
  it("fadeStartMs = endMs − 1200", () => assert.equal(a.fadeStartMs, a.endMs - custom));
});

// ── Fade cap at 50% of durationMs ────────────────────────────────────────────

describe("buildRenderPlan — fade cap (authored fade > 50% of scene duration)", () => {
  // Scene is 1 s → 50% cap = 500 ms; authored DEFAULT_FADE_MS (800) exceeds cap
  const plan = buildRenderPlan([
    img("a", 1, { transition: "fade" }),
    img("b", 5),
  ]);
  const a = plan.scenes[0]!;

  it("fadeDurationMs is capped at 50% of durationMs", () => {
    assert.equal(a.fadeDurationMs, a.durationMs * 0.5);
  });

  it("fadeStartMs = endMs − cap", () => {
    assert.equal(a.fadeStartMs, a.endMs - a.fadeDurationMs);
  });
});

// ── Last scene — no fade regardless of transition ────────────────────────────

describe("buildRenderPlan — last scene never has a fade", () => {
  const plan = buildRenderPlan([
    img("a", 5),
    img("b", 5, { transition: "fade" }), // last — fade suppressed
  ]);
  const b = plan.scenes[1]!;

  it("fadeDurationMs = 0 on last scene", () => assert.equal(b.fadeDurationMs, 0));
  it("transition field still preserved as authored", () => assert.equal(b.transition, "fade"));
  it("fadeStartMs = endMs (no window)", () => assert.equal(b.fadeStartMs, b.endMs));
});

// ── Text overlay preservation ─────────────────────────────────────────────────

describe("buildRenderPlan — text overlay", () => {
  const plan = buildRenderPlan([
    img("a", 5, { textOverlay: overlay }),
    img("b", 5),
  ]);
  const a = plan.scenes[0]!;
  const b = plan.scenes[1]!;

  it("textOverlay is preserved with all fields", () => {
    assert.deepEqual(a.textOverlay, overlay);
  });

  it("textOverlay is null when absent", () => {
    assert.equal(b.textOverlay, null);
  });
});

// ── Mixed image and video ─────────────────────────────────────────────────────

describe("buildRenderPlan — mixed image and video scenes", () => {
  const plan = buildRenderPlan([
    img("a", 5),
    vid("v", 12),
    img("b", 3),
  ]);

  it("types are preserved in order", () => {
    assert.equal(plan.scenes[0]!.type, "image");
    assert.equal(plan.scenes[1]!.type, "video");
    assert.equal(plan.scenes[2]!.type, "image");
  });

  it("timeline positions are contiguous regardless of type", () => {
    assert.equal(plan.scenes[1]!.startMs, 5000);
    assert.equal(plan.scenes[2]!.startMs, 17000);
    assert.equal(plan.totalDurationMs, 20000);
  });
});

// ── Invariants ────────────────────────────────────────────────────────────────

describe("buildRenderPlan — invariants hold for arbitrary scene lists", () => {
  const scenes = [
    img("a", 3, { transition: "fade" }),
    vid("v", 7, { transition: "fade", fadeDurationMs: 500, naturalDuration: 20 }),
    img("b", 2, { textOverlay: overlay }),
    img("c", 5),
  ];
  const plan = buildRenderPlan(scenes);

  it("scene count matches input", () => assert.equal(plan.scenes.length, scenes.length));

  it("totalDurationMs = sum of all durationMs", () => {
    const sum = plan.scenes.reduce((acc, e) => acc + e.durationMs, 0);
    assert.equal(plan.totalDurationMs, sum);
  });

  it("totalDurationMs = last entry endMs", () => {
    const last = plan.scenes[plan.scenes.length - 1]!;
    assert.equal(plan.totalDurationMs, last.endMs);
  });

  it("every entry: endMs = startMs + durationMs", () => {
    for (const e of plan.scenes) {
      assert.equal(e.endMs, e.startMs + e.durationMs, `failed for scene ${e.id}`);
    }
  });

  it("every entry: fadeStartMs = endMs − fadeDurationMs", () => {
    for (const e of plan.scenes) {
      assert.equal(e.fadeStartMs, e.endMs - e.fadeDurationMs, `failed for scene ${e.id}`);
    }
  });

  it("every entry: fadeDurationMs ≤ durationMs * 0.5", () => {
    for (const e of plan.scenes) {
      assert.ok(
        e.fadeDurationMs <= e.durationMs * 0.5,
        `fade ${e.fadeDurationMs} exceeds 50% cap for scene ${e.id}`,
      );
    }
  });

  it("last entry has fadeDurationMs = 0", () => {
    const last = plan.scenes[plan.scenes.length - 1]!;
    assert.equal(last.fadeDurationMs, 0);
  });

  it("index field matches array position", () => {
    plan.scenes.forEach((e, i) => assert.equal(e.index, i));
  });
});

// ── Duration semantics consistency ────────────────────────────────────────────

describe("buildRenderPlan — duration semantics stay consistent with sceneTiming rules", () => {
  it("durationMs = scene.duration * 1000 for image scenes", () => {
    const plan = buildRenderPlan([img("a", 7.5)]);
    assert.equal(plan.scenes[0]!.durationMs, 7500);
  });

  it("durationMs = scene.duration * 1000 for video scenes", () => {
    const plan = buildRenderPlan([vid("v", 15)]);
    assert.equal(plan.scenes[0]!.durationMs, 15000);
  });

  it("totalDurationMs matches manual sum for all types", () => {
    const plan = buildRenderPlan([img("a", 3), vid("v", 8), img("b", 2)]);
    assert.equal(plan.totalDurationMs, 13000);
  });
});
