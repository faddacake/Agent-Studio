/**
 * Tests for the scene-timeline timing utility.
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FADE_MS,
  MIN_SCENE_DURATION_S,
  clampDurationS,
  totalDurationMs,
  sceneStartMs,
  effectiveTimelineMs,
  effectiveFadeDurationMs,
  computeFadeProgress,
  activeSceneIndex,
} from "./sceneTiming";
import type { Scene } from "./editorProjectTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeScene(overrides: Partial<Scene> & Pick<Scene, "duration">): Scene {
  return {
    id: "s",
    type: "image",
    src: "a.jpg",
    transition: "cut",
    ...overrides,
  };
}

const cut5  = makeScene({ duration: 5 });
const cut10 = makeScene({ duration: 10 });
const fade5 = makeScene({ duration: 5, transition: "fade" });
const fade5custom = makeScene({ duration: 5, transition: "fade", fadeDurationMs: 1200 });
const fadeTiny = makeScene({ duration: 1, transition: "fade" }); // default 800 ms > 50% → capped at 500

// ── totalDurationMs ───────────────────────────────────────────────────────────

describe("totalDurationMs", () => {
  it("returns 0 for empty scenes", () => {
    assert.equal(totalDurationMs([]), 0);
  });

  it("sums scene durations in ms", () => {
    assert.equal(totalDurationMs([cut5, cut10]), 15_000);
  });
});

// ── sceneStartMs ──────────────────────────────────────────────────────────────

describe("sceneStartMs", () => {
  it("returns 0 for index 0", () => {
    assert.equal(sceneStartMs([cut5, cut10], 0), 0);
  });

  it("returns duration of prior scenes", () => {
    assert.equal(sceneStartMs([cut5, cut10], 1), 5_000);
    assert.equal(sceneStartMs([cut5, cut10], 2), 15_000);
  });

  it("handles out-of-bounds index gracefully", () => {
    assert.equal(sceneStartMs([cut5], 5), 5_000);
  });
});

// ── effectiveFadeDurationMs ───────────────────────────────────────────────────

describe("effectiveFadeDurationMs", () => {
  it("returns 0 for cut transition", () => {
    assert.equal(effectiveFadeDurationMs(cut5, true), 0);
  });

  it("returns 0 for last scene (no next scene)", () => {
    assert.equal(effectiveFadeDurationMs(fade5, false), 0);
  });

  it("uses DEFAULT_FADE_MS when fadeDurationMs is absent", () => {
    // 5 s scene → 50% cap = 2500 ms; DEFAULT_FADE_MS = 800 ms → 800 wins
    assert.equal(effectiveFadeDurationMs(fade5, true), DEFAULT_FADE_MS);
  });

  it("uses custom fadeDurationMs", () => {
    // fade5custom: fadeDurationMs=1200, 50% cap=2500 → 1200 wins
    assert.equal(effectiveFadeDurationMs(fade5custom, true), 1200);
  });

  it("caps at 50% of scene duration", () => {
    // fadeTiny: 1 s → 50% cap = 500 ms; DEFAULT_FADE_MS = 800 → capped to 500
    assert.equal(effectiveFadeDurationMs(fadeTiny, true), 500);
  });

  it("caps a custom fadeDurationMs that exceeds 50% of scene duration", () => {
    const scene = makeScene({ duration: 2, transition: "fade", fadeDurationMs: 2000 });
    // 50% of 2000 ms = 1000 ms cap
    assert.equal(effectiveFadeDurationMs(scene, true), 1000);
  });
});

// ── computeFadeProgress ───────────────────────────────────────────────────────

describe("computeFadeProgress", () => {
  it("returns 0 for a cut scene at any time", () => {
    assert.equal(computeFadeProgress(cut5, true, 4_999), 0);
  });

  it("returns 0 for the last fade scene (no next scene)", () => {
    assert.equal(computeFadeProgress(fade5, false, 4_999), 0);
  });

  it("returns 0 before the fade window starts", () => {
    // fade5: 5000 ms, fadeMs=800 → window starts at 4200
    assert.equal(computeFadeProgress(fade5, true, 4_000), 0);
    assert.equal(computeFadeProgress(fade5, true, 4_200), 0);
  });

  it("returns progress > 0 inside the fade window", () => {
    // at 4200 + 400 = 4600 ms → progress = 400/800 = 0.5
    assert.equal(computeFadeProgress(fade5, true, 4_600), 0.5);
  });

  it("returns 1 at scene end", () => {
    assert.equal(computeFadeProgress(fade5, true, 5_000), 1);
  });

  it("clamps sceneElapsedMs beyond scene duration to 1", () => {
    assert.equal(computeFadeProgress(fade5, true, 9_999), 1);
  });

  it("uses custom fadeDurationMs for progress", () => {
    // fade5custom: 5000 ms, fadeMs=1200 → window starts at 3800
    // at 4400 ms → progress = (4400-3800)/1200 = 600/1200 = 0.5
    assert.equal(computeFadeProgress(fade5custom, true, 4_400), 0.5);
  });

  it("respects 50% cap when computing progress", () => {
    // fadeTiny: 1000 ms, effectiveFadeMs=500 → window starts at 500
    // at 750 ms → progress = (750-500)/500 = 0.5
    assert.equal(computeFadeProgress(fadeTiny, true, 750), 0.5);
  });
});

// ── activeSceneIndex ──────────────────────────────────────────────────────────

describe("activeSceneIndex", () => {
  const scenes = [cut5, cut10]; // 0–5000 ms → scene 0; 5000–15000 ms → scene 1

  it("returns 0 for empty scenes array", () => {
    assert.equal(activeSceneIndex([], 1000), 0);
  });

  it("returns 0 at time 0", () => {
    assert.equal(activeSceneIndex(scenes, 0), 0);
  });

  it("returns 0 within the first scene", () => {
    assert.equal(activeSceneIndex(scenes, 4_999), 0);
  });

  it("returns 1 at the boundary between scenes", () => {
    assert.equal(activeSceneIndex(scenes, 5_000), 1);
  });

  it("returns 1 within the second scene", () => {
    assert.equal(activeSceneIndex(scenes, 10_000), 1);
  });

  it("returns last index when time exceeds total duration", () => {
    assert.equal(activeSceneIndex(scenes, 99_999), 1);
  });
});

// ── effectiveTimelineMs ───────────────────────────────────────────────────────
// This is the canonical position used by the progress bar, elapsed display,
// and resume clock — covers seek-while-paused and seek-while-playing scenarios.

describe("effectiveTimelineMs", () => {
  // Two scenes: cut5 (0–5000 ms) + cut10 (5000–15000 ms)
  const two = [cut5, cut10];

  it("returns 0 at the very start", () => {
    assert.equal(effectiveTimelineMs(two, 0, 0), 0);
  });

  it("returns mid-scene position within scene 0", () => {
    assert.equal(effectiveTimelineMs(two, 0, 2_000), 2_000);
  });

  it("returns correct absolute position within scene 1", () => {
    // scene 1 starts at 5000; offset 3000 → absolute 8000
    assert.equal(effectiveTimelineMs(two, 1, 3_000), 8_000);
  });

  it("clamps seekOffsetMs to scene duration (seek past scene end)", () => {
    // scene 0 is 5000 ms; seek offset 9000 → clamped to 5000 → absolute 5000
    assert.equal(effectiveTimelineMs(two, 0, 9_000), 5_000);
  });

  it("returns totalDurationMs when at end of final scene", () => {
    // scene 1 is 10000 ms; offset 10000 → absolute 5000+10000 = 15000
    assert.equal(effectiveTimelineMs(two, 1, 10_000), 15_000);
  });

  it("handles exact scene-boundary seek (offset 0 on scene 1)", () => {
    assert.equal(effectiveTimelineMs(two, 1, 0), 5_000);
  });

  it("returns 0 for empty scenes array", () => {
    assert.equal(effectiveTimelineMs([], 0, 0), 0);
  });

  it("position agrees with activeSceneIndex round-trip", () => {
    // Build absolute position, then recover scene index — must match
    const absPos = effectiveTimelineMs(two, 1, 2_000); // 7000
    assert.equal(activeSceneIndex(two, absPos), 1);
    assert.equal(absPos - sceneStartMs(two, 1), 2_000);
  });
});

// ── clampDurationS ────────────────────────────────────────────────────────────
// Tests the canonical duration-validation helper used by every edit surface.

describe("clampDurationS — rounding", () => {
  it("rounds to 0.1 s precision (rounds up at 0.05)", () => {
    assert.equal(clampDurationS(5.55), 5.6);
  });

  it("rounds to 0.1 s precision (rounds down below 0.05)", () => {
    assert.equal(clampDurationS(5.54), 5.5);
  });

  it("passes through an integer without change", () => {
    assert.equal(clampDurationS(5), 5);
  });

  it("passes through exactly 0.1 (MIN)", () => {
    assert.equal(clampDurationS(0.1), 0.1);
  });
});

describe("clampDurationS — minimum enforcement", () => {
  it("clamps 0 to MIN_SCENE_DURATION_S", () => {
    assert.equal(clampDurationS(0), MIN_SCENE_DURATION_S);
  });

  it("clamps a negative value to MIN_SCENE_DURATION_S", () => {
    assert.equal(clampDurationS(-5), MIN_SCENE_DURATION_S);
  });

  it("clamps a value below MIN to MIN_SCENE_DURATION_S", () => {
    assert.equal(clampDurationS(0.04), MIN_SCENE_DURATION_S);
  });

  it("clamps 0.05 (rounds to 0.1) to exactly MIN_SCENE_DURATION_S", () => {
    assert.equal(clampDurationS(0.05), MIN_SCENE_DURATION_S);
  });
});

// ── Duration semantics — image vs video ───────────────────────────────────────
// Verify that timing helpers treat image and video scene.duration identically
// (both are plain playback-window seconds; type is irrelevant to timing math).

describe("duration semantics — image and video scenes use the same timing math", () => {
  const imgScene  = makeScene({ duration: 5, type: "image" });
  const vidScene  = makeScene({ duration: 5, type: "video" });

  it("totalDurationMs treats image and video duration identically", () => {
    assert.equal(totalDurationMs([imgScene]), totalDurationMs([vidScene]));
  });

  it("sceneStartMs is independent of scene type", () => {
    const imgTwo = [makeScene({ id: "a", duration: 3, type: "image" }), imgScene];
    const vidTwo = [makeScene({ id: "a", duration: 3, type: "video" }), vidScene];
    assert.equal(sceneStartMs(imgTwo, 1), sceneStartMs(vidTwo, 1));
  });

  it("effectiveTimelineMs agrees across types for the same duration and offset", () => {
    const imgList = [imgScene];
    const vidList = [vidScene];
    assert.equal(effectiveTimelineMs(imgList, 0, 2_000), effectiveTimelineMs(vidList, 0, 2_000));
  });
});

// ── Fade cap at MIN_SCENE_DURATION_S ─────────────────────────────────────────

describe("effectiveFadeDurationMs — fade cap with MIN-duration scene", () => {
  const minFadeScene = makeScene({ duration: MIN_SCENE_DURATION_S, transition: "fade" });
  // 50% of 0.1 s = 50 ms; DEFAULT_FADE_MS (800) is capped there
  const expectedCap = MIN_SCENE_DURATION_S * 1000 * 0.5; // 50

  it("caps fade at 50% of MIN_SCENE_DURATION_S (50 ms)", () => {
    assert.equal(effectiveFadeDurationMs(minFadeScene, true), expectedCap);
  });

  it("fade progress at scene end = 1 for a min-duration fade scene", () => {
    const elapsed = MIN_SCENE_DURATION_S * 1000; // at scene end
    assert.equal(computeFadeProgress(minFadeScene, true, elapsed), 1);
  });
});
