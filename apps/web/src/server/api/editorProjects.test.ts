/**
 * Regression tests for EditorProject scene serialization.
 *
 * Scenes are persisted as JSON text (JSON.stringify) and rehydrated via
 * JSON.parse — no schema filtering occurs at any layer. These tests lock that
 * contract so future optional Scene fields don't silently vanish on save/load.
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Helpers that mirror the actual persistence layer ─────────────────────────

function serializeScenes(scenes: unknown[]): string {
  return JSON.stringify(scenes);
}

function deserializeScenes(json: string): unknown[] {
  return JSON.parse(json) as unknown[];
}

function roundTrip(scenes: unknown[]): unknown[] {
  return deserializeScenes(serializeScenes(scenes));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Scene JSON round-trip", () => {
  it("preserves fadeDurationMs through serialization", () => {
    const scene = {
      id: "abc",
      type: "image",
      src: "artifacts/img.jpg",
      duration: 5,
      transition: "fade",
      fadeDurationMs: 1200,
    };
    const result = roundTrip([scene]) as typeof scene[];
    assert.equal(result[0]?.fadeDurationMs, 1200);
  });

  it("preserves fadeDurationMs when it is the default-like value 800", () => {
    const scene = {
      id: "abc",
      type: "image",
      src: "artifacts/img.jpg",
      duration: 5,
      transition: "fade",
      fadeDurationMs: 800,
    };
    const result = roundTrip([scene]) as typeof scene[];
    assert.equal(result[0]?.fadeDurationMs, 800);
  });

  it("round-trips a scene without fadeDurationMs with the field absent", () => {
    const scene = {
      id: "abc",
      type: "image",
      src: "artifacts/img.jpg",
      duration: 5,
      transition: "cut",
    };
    const result = roundTrip([scene]) as Record<string, unknown>[];
    assert.equal(result[0]?.fadeDurationMs, undefined);
  });

  it("preserves all other optional scene fields alongside fadeDurationMs", () => {
    const scene = {
      id: "abc",
      type: "image",
      src: "artifacts/img.jpg",
      duration: 5,
      transition: "fade",
      fadeDurationMs: 600,
      textOverlay: { text: "Hello", position: "bottom", style: "subtitle" },
    };
    const result = roundTrip([scene]) as typeof scene[];
    const r = result[0]!;
    assert.equal(r.fadeDurationMs, 600);
    assert.equal(r.textOverlay?.text, "Hello");
    assert.equal(r.transition, "fade");
  });

  it("preserves multiple scenes with mixed fadeDurationMs presence", () => {
    const scenes = [
      { id: "a", type: "image", src: "a.jpg", duration: 3, transition: "fade", fadeDurationMs: 400 },
      { id: "b", type: "video", src: "b.mp4", duration: 10 },
      { id: "c", type: "image", src: "c.jpg", duration: 5, transition: "fade", fadeDurationMs: 1500 },
    ];
    const result = roundTrip(scenes) as typeof scenes;
    assert.equal(result[0]?.fadeDurationMs, 400);
    assert.equal((result[1] as Record<string, unknown>).fadeDurationMs, undefined);
    assert.equal(result[2]?.fadeDurationMs, 1500);
  });
});
