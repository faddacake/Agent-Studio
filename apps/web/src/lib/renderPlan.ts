/**
 * renderPlan — canonical serialization of an editor scene list into an
 * explicit timeline model.
 *
 * `buildRenderPlan` is a pure function: it delegates all duration and fade math
 * to `sceneTiming` helpers and adds timeline position fields derived in a single
 * left-to-right pass. The result is deterministic, serialization-friendly, and
 * safe to import in tests, export pipelines, and React components.
 *
 * No new rules live here. Every value in a `SceneEntry` is either copied from
 * the source `Scene` or computed by an existing `sceneTiming` helper.
 */

import type { Scene, TextOverlay } from "./editorProjectTypes";
import { effectiveFadeDurationMs } from "./sceneTiming";

// ── Entry shape ───────────────────────────────────────────────────────────────

export interface SceneEntry {
  // ── Identity ────────────────────────────────────────────────────────────────
  id: string;
  index: number;
  type: "image" | "video";

  // ── Source ──────────────────────────────────────────────────────────────────
  /** Artifact path — served via /api/artifacts?path=<src>. */
  src: string;

  // ── Duration / timeline position ────────────────────────────────────────────
  /** Playback window in milliseconds (scene.duration × 1000). */
  durationMs: number;
  /** Absolute timeline start in ms. */
  startMs: number;
  /** Absolute timeline end in ms (startMs + durationMs). */
  endMs: number;

  // ── Transition ──────────────────────────────────────────────────────────────
  /**
   * Transition type into the next scene.
   * Defaults to "cut" when the scene has no explicit transition.
   */
  transition: "cut" | "fade";
  /**
   * Effective fade duration in ms.
   * 0 for cut transitions, 0 for the last scene, capped at 80 % of durationMs.
   * Computed via `effectiveFadeDurationMs` — no new rules here.
   */
  fadeDurationMs: number;
  /**
   * Absolute timeline position (ms) at which the cross-fade begins.
   * Equal to endMs − fadeDurationMs.
   * When fadeDurationMs is 0 this equals endMs (no fade window).
   */
  fadeStartMs: number;

  // ── Overlay ─────────────────────────────────────────────────────────────────
  /** Text-overlay payload, or null when the scene has no overlay. */
  textOverlay: TextOverlay | null;

  // ── Video context (UI-only; never used for playback timing) ─────────────────
  /**
   * Detected natural clip length in ms, or null for image scenes and video
   * scenes whose metadata has not yet been loaded.
   */
  naturalDurationMs: number | null;

  // ── Trim ─────────────────────────────────────────────────────────────────────
  /**
   * Trim start offset in ms — where in the source clip playback begins.
   * null means from the clip start (equivalent to 0). Only set for video scenes
   * where the user has explicitly trimmed the start.
   */
  trimStartMs: number | null;
}

// ── Plan shape ────────────────────────────────────────────────────────────────

export interface RenderPlan {
  /** Total timeline duration in ms — sum of all scene durations. */
  totalDurationMs: number;
  /** Ordered scene entries, one per scene in scene-list order. */
  readonly scenes: readonly SceneEntry[];
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Convert a scene list into a fully-resolved `RenderPlan`.
 *
 * Performs a single left-to-right pass: each entry receives absolute
 * `startMs`/`endMs` positions, the effective fade duration (via
 * `effectiveFadeDurationMs`), and the absolute `fadeStartMs`.
 *
 * @param scenes - Ordered array of editor scenes (may be empty).
 * @returns A `RenderPlan` with pre-computed timeline positions and fade windows.
 */
export function buildRenderPlan(scenes: Scene[]): RenderPlan {
  let cursor = 0;
  const entries: SceneEntry[] = scenes.map((scene, index) => {
    const durationMs = scene.duration * 1000;
    const startMs = cursor;
    const endMs = cursor + durationMs;
    const hasNext = index < scenes.length - 1;
    const fadeDurationMs = effectiveFadeDurationMs(scene, hasNext);

    cursor = endMs;

    return {
      id: scene.id,
      index,
      type: scene.type,
      src: scene.src,
      durationMs,
      startMs,
      endMs,
      transition: scene.transition ?? "cut",
      fadeDurationMs,
      fadeStartMs: endMs - fadeDurationMs,
      textOverlay: scene.textOverlay ?? null,
      naturalDurationMs:
        scene.naturalDuration !== undefined ? scene.naturalDuration * 1000 : null,
      trimStartMs:
        scene.trimStart !== undefined && scene.trimStart > 0 ? scene.trimStart * 1000 : null,
    };
  });

  return { totalDurationMs: cursor, scenes: entries };
}
