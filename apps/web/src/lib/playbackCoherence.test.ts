/**
 * Tests for playback-state coherence helpers.
 *
 * Each describe block covers one mutation type; cases follow the rules
 * documented in playbackCoherence.ts.
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { afterRemove, afterMove, afterReorder, afterDurationEdit, resolvePlayStart, resolveReplay, resolveActiveId } from "./playbackCoherence";
import type { Scene } from "./editorProjectTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function s(id: string, duration = 5): Scene {
  return { id, type: "image", src: `${id}.jpg`, duration };
}

const A = s("a");
const B = s("b");
const C = s("c");
const three = [A, B, C]; // indices 0 → A, 1 → B, 2 → C

// ── afterRemove ───────────────────────────────────────────────────────────────

describe("afterRemove — empty timeline", () => {
  it("stops and resets when the only scene is removed", () => {
    const r = afterRemove([A], { playIndex: 0, seekOffsetMs: 1500 }, 0);
    assert.equal(r.stop, true);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 0);
    assert.equal(r.bump, false);
  });
});

describe("afterRemove — scene before active removed", () => {
  it("shifts playIndex down by 1, preserves seekOffsetMs", () => {
    const r = afterRemove(three, { playIndex: 2, seekOffsetMs: 700 }, 0);
    assert.equal(r.playIndex, 1);
    assert.equal(r.seekOffsetMs, 700);
    assert.equal(r.stop, false);
    assert.equal(r.bump, false);
  });

  it("handles adjacent predecessor removal", () => {
    const r = afterRemove(three, { playIndex: 1, seekOffsetMs: 200 }, 0);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 200);
    assert.equal(r.bump, false);
  });
});

describe("afterRemove — scene after active removed", () => {
  it("leaves playIndex and seekOffsetMs unchanged", () => {
    const r = afterRemove(three, { playIndex: 0, seekOffsetMs: 800 }, 2);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 800);
    assert.equal(r.stop, false);
    assert.equal(r.bump, false);
  });
});

describe("afterRemove — active scene invalidated", () => {
  it("lands on same index when a middle scene is removed (next scene steps in)", () => {
    // B (idx=1) removed from [A,B,C]; C takes index 1
    const r = afterRemove(three, { playIndex: 1, seekOffsetMs: 3000 }, 1);
    assert.equal(r.playIndex, 1);
    assert.equal(r.seekOffsetMs, 0);
    assert.equal(r.stop, false);
    assert.equal(r.bump, true);
  });

  it("clamps to new last when the last active scene is removed", () => {
    // C (idx=2) removed from [A,B,C]; new last is idx=1
    const r = afterRemove(three, { playIndex: 2, seekOffsetMs: 2000 }, 2);
    assert.equal(r.playIndex, 1);
    assert.equal(r.seekOffsetMs, 0);
    assert.equal(r.stop, false);
    assert.equal(r.bump, true);
  });

  it("clamps to 0 when first of two scenes is removed while playing first", () => {
    const r = afterRemove([A, B], { playIndex: 0, seekOffsetMs: 500 }, 0);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 0);
    assert.equal(r.stop, false);
    assert.equal(r.bump, true);
  });
});

// ── afterMove ─────────────────────────────────────────────────────────────────

describe("afterMove — boundary no-ops", () => {
  it("returns state unchanged when moving the first scene up", () => {
    const state = { playIndex: 0, seekOffsetMs: 100 };
    assert.deepEqual(afterMove(three, state, 0, "up"), state);
  });

  it("returns state unchanged when moving the last scene down", () => {
    const state = { playIndex: 2, seekOffsetMs: 100 };
    assert.deepEqual(afterMove(three, state, 2, "down"), state);
  });
});

describe("afterMove — active scene is the one being moved", () => {
  it("follows active scene moving up", () => {
    const r = afterMove(three, { playIndex: 1, seekOffsetMs: 400 }, 1, "up");
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 400);
  });

  it("follows active scene moving down", () => {
    const r = afterMove(three, { playIndex: 1, seekOffsetMs: 400 }, 1, "down");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 400);
  });
});

describe("afterMove — neighbor of active scene is moved into active's slot", () => {
  it("adjusts index when scene above active moves down", () => {
    // A (idx=0) moves down → swaps with B (idx=1); active was B → now at 0
    const r = afterMove(three, { playIndex: 1, seekOffsetMs: 300 }, 0, "down");
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 300);
  });

  it("adjusts index when scene below active moves up", () => {
    // C (idx=2) moves up → swaps with B (idx=1); active was B → now at 2
    const r = afterMove(three, { playIndex: 1, seekOffsetMs: 300 }, 2, "up");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 300);
  });
});

describe("afterMove — unrelated scene moved", () => {
  it("does not change playIndex when a non-adjacent scene is swapped", () => {
    // A (0) moves down; active is C (2) — unaffected
    const state = { playIndex: 2, seekOffsetMs: 100 };
    assert.deepEqual(afterMove(three, state, 0, "down"), state);
  });
});

// ── afterReorder ──────────────────────────────────────────────────────────────

describe("afterReorder", () => {
  it("follows the active scene to its new index", () => {
    // [A,B,C] → [C,A,B]; active was B (idx=1), now at idx=2
    const r = afterReorder(three, { playIndex: 1, seekOffsetMs: 200 }, [C, A, B]);
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 200);
  });

  it("preserves seekOffsetMs across reorder", () => {
    // [A,B,C] → [C,B,A]; active was A (idx=0), now at idx=2
    const r = afterReorder(three, { playIndex: 0, seekOffsetMs: 1500 }, [C, B, A]);
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 1500);
  });

  it("returns same playIndex when active scene stays in place", () => {
    // [A,B,C] → [A,C,B]; active is A (idx=0), stays at 0
    const state = { playIndex: 0, seekOffsetMs: 100 };
    const r = afterReorder(three, state, [A, C, B]);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 100);
  });

  it("handles full reversal", () => {
    // [A,B,C] → [C,B,A]; active was C (idx=2), now at idx=0
    const r = afterReorder(three, { playIndex: 2, seekOffsetMs: 0 }, [C, B, A]);
    assert.equal(r.playIndex, 0);
  });
});

// ── afterDurationEdit ─────────────────────────────────────────────────────────

describe("afterDurationEdit — active scene edited", () => {
  it("clamps seekOffsetMs when active scene duration shrinks below current position", () => {
    const r = afterDurationEdit({ playIndex: 1, seekOffsetMs: 4000 }, 1, 2);
    assert.equal(r.seekOffsetMs, 2000);
  });

  it("preserves seekOffsetMs when new duration exceeds current position", () => {
    const r = afterDurationEdit({ playIndex: 1, seekOffsetMs: 1000 }, 1, 5);
    assert.equal(r.seekOffsetMs, 1000);
  });

  it("sets seekOffsetMs to exactly newDuration*1000 when seek sits at old end", () => {
    const r = afterDurationEdit({ playIndex: 0, seekOffsetMs: 5000 }, 0, 3);
    assert.equal(r.seekOffsetMs, 3000);
  });

  it("preserves playIndex unchanged", () => {
    const r = afterDurationEdit({ playIndex: 2, seekOffsetMs: 1000 }, 2, 1);
    assert.equal(r.playIndex, 2);
  });
});

describe("afterDurationEdit — different scene edited", () => {
  it("returns state unchanged when a non-active scene duration changes", () => {
    const state = { playIndex: 1, seekOffsetMs: 3000 };
    assert.deepEqual(afterDurationEdit(state, 0, 1), state);
    assert.deepEqual(afterDurationEdit(state, 2, 1), state);
  });
});

// ── resolvePlayStart ──────────────────────────────────────────────────────────
// Covers seek-while-paused → play, scene-select → play, and resume semantics.

describe("resolvePlayStart — empty timeline", () => {
  it("returns 0,0 regardless of inputs", () => {
    assert.deepEqual(resolvePlayStart([], 0, 5000, "any"), { playIndex: 0, seekOffsetMs: 0 });
  });
});

describe("resolvePlayStart — resume on same scene (seek then play)", () => {
  it("preserves seekOffsetMs when selectedId matches playIndex scene", () => {
    // User scrubbed to 2s into scene B (idx=1), selectedId was updated to B by handleSeek
    const r = resolvePlayStart(three, 1, 2_000, "b");
    assert.equal(r.playIndex, 1);
    assert.equal(r.seekOffsetMs, 2_000);
  });

  it("preserves seekOffsetMs = 0 (normal resume at scene start)", () => {
    const r = resolvePlayStart(three, 0, 0, "a");
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 0);
  });

  it("preserves a mid-timeline offset when play is pressed after pause mid-scene", () => {
    const r = resolvePlayStart(three, 2, 3_500, "c");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 3_500);
  });
});

describe("resolvePlayStart — different scene selected (scene switch → play)", () => {
  it("resets seekOffsetMs to 0 when selectedId points to a different scene", () => {
    // Clock is on scene B (idx=1) with offset, but user selected scene C
    const r = resolvePlayStart(three, 1, 2_000, "c");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 0);
  });

  it("starts from scene 0 when selectedId is not found", () => {
    const r = resolvePlayStart(three, 2, 1_000, "nonexistent");
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 0);
  });

  it("starts from scene 0 when selectedId is null", () => {
    const r = resolvePlayStart(three, 1, 500, null);
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 0);
  });
});

// ── resolveReplay ─────────────────────────────────────────────────────────────
// Extends resolvePlayStart with a "restart from beginning when at/past end" rule.

describe("resolveReplay — empty timeline", () => {
  it("returns 0,0 regardless of inputs", () => {
    assert.deepEqual(resolveReplay([], 0, 5000, "any"), { playIndex: 0, seekOffsetMs: 0 });
  });
});

describe("resolveReplay — at natural end (parked seek)", () => {
  it("restarts from {0,0} when seekOffsetMs equals last scene duration (natural end park)", () => {
    // three = [A(5s), B(5s), C(5s)]; total = 15s
    // After natural end: playIndex=2, seekOffsetMs=5000 → effectiveTimelineMs=15000 = total
    const r = resolveReplay(three, 2, 5000, "c");
    assert.deepEqual(r, { playIndex: 0, seekOffsetMs: 0 });
  });

  it("restarts from {0,0} when seeked to exact timeline end", () => {
    // handleSeek(15000) → playIndex=2, seekOffsetMs=5000
    const r = resolveReplay(three, 2, 5000, "c");
    assert.deepEqual(r, { playIndex: 0, seekOffsetMs: 0 });
  });

  it("restarts from {0,0} when playIndex is at last scene and seek is beyond duration", () => {
    // seekOffsetMs > duration still triggers restart via effectiveTimelineMs clamping
    const r = resolveReplay(three, 2, 9999, "c");
    assert.deepEqual(r, { playIndex: 0, seekOffsetMs: 0 });
  });
});

describe("resolveReplay — mid-timeline (delegates to resolvePlayStart)", () => {
  it("preserves seekOffsetMs when resuming mid-scene on same scene", () => {
    const r = resolveReplay(three, 1, 2_000, "b");
    assert.equal(r.playIndex, 1);
    assert.equal(r.seekOffsetMs, 2_000);
  });

  it("resets seekOffsetMs to 0 when a different scene is selected", () => {
    const r = resolveReplay(three, 1, 2_000, "c");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 0);
  });

  it("does not restart when seek is at start of last scene (not yet ended)", () => {
    // playIndex=2, seekOffsetMs=0 → effectiveTimelineMs=10000 < 15000
    const r = resolveReplay(three, 2, 0, "c");
    assert.equal(r.playIndex, 2);
    assert.equal(r.seekOffsetMs, 0);
  });

  it("does not restart when mid-timeline with seek at scene boundary", () => {
    // playIndex=0, seekOffsetMs=5000 → effectiveTimelineMs=5000 < 15000
    const r = resolveReplay(three, 0, 5000, "a");
    assert.equal(r.playIndex, 0);
    assert.equal(r.seekOffsetMs, 5000);
  });
});

// ── resolveActiveId ───────────────────────────────────────────────────────────
// These tests cover every mode transition documented in the active-scene authority model:
// paused (click, scrub, step), playing (advance, step), and boundary cases.

describe("resolveActiveId — paused mode", () => {
  it("returns selectedId's scene when paused and selection matches a scene", () => {
    assert.equal(resolveActiveId(three, 0, "b", false), "b");
  });

  it("returns selectedId even when it differs from playIndex while paused", () => {
    // clock is at playIndex=2 (C) but user has selected A
    assert.equal(resolveActiveId(three, 2, "a", false), "a");
  });

  it("returns selectedId = null when paused and nothing selected", () => {
    assert.equal(resolveActiveId(three, 0, null, false), null);
  });

  it("returns selectedId after seek while paused (handleSeek syncs selectedId)", () => {
    // After seeking to scene B while paused: playIndex=1, selectedId="b"
    assert.equal(resolveActiveId(three, 1, "b", false), "b");
  });

  it("returns selectedId after step while paused", () => {
    // After stepping to C: playIndex=2, selectedId="c"
    assert.equal(resolveActiveId(three, 2, "c", false), "c");
  });
});

describe("resolveActiveId — playing mode", () => {
  it("returns scenes[playIndex].id when playing, ignoring selectedId", () => {
    // selectedId still points to A, but player is on B (idx=1)
    assert.equal(resolveActiveId(three, 1, "a", true), "b");
  });

  it("returns scenes[0].id when playing from start", () => {
    assert.equal(resolveActiveId(three, 0, "a", true), "a");
  });

  it("returns the advanced scene after playIndex increments", () => {
    // Scene advance: playIndex=2, selectedId="a" (not updated mid-play)
    assert.equal(resolveActiveId(three, 2, "a", true), "c");
  });

  it("returns scenes[playIndex].id during scrub while playing", () => {
    // Scrub moved playIndex to 1 while playing
    assert.equal(resolveActiveId(three, 1, "c", true), "b");
  });
});

describe("resolveActiveId — boundary cases", () => {
  it("returns null when scenes is empty", () => {
    assert.equal(resolveActiveId([], 0, null, false), null);
    assert.equal(resolveActiveId([], 0, null, true), null);
  });

  it("returns null when playIndex is out of bounds while playing", () => {
    // e.g. last scene was just deleted; safety-net effect hasn't run yet
    assert.equal(resolveActiveId([A], 5, "a", true), null);
  });

  it("returns selectedId when paused regardless of playIndex validity", () => {
    assert.equal(resolveActiveId([A], 5, "a", false), "a");
  });

  it("after natural playback end: isPlaying=false, selectedId synced to last scene", () => {
    // EditorShell syncs selectedId=scenes[playIndex].id on natural end
    // then isPlaying becomes false → authority = selectedId = last scene
    assert.equal(resolveActiveId(three, 2, "c", false), "c");
  });
});
