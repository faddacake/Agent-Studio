/**
 * sceneTiming — pure scene-timeline utilities.
 *
 * Single source of truth for playback bounds, fade windows, and fade progress.
 * No React dependency; safe to import in tests, export pipelines, and components.
 */

import type { Scene } from "./editorProjectTypes";

/** Default fade duration when scene.fadeDurationMs is not set. */
export const DEFAULT_FADE_MS = 800;

/** Minimum allowed scene duration in seconds (applies to both image and video scenes). */
export const MIN_SCENE_DURATION_S = 0.1;

/**
 * Default scene durations (seconds) used when inserting a new artifact as a scene.
 * Video default is a round number that the auto-detection will immediately correct
 * once the clip's metadata loads; image default is a comfortable display window.
 */
export const DEFAULT_VIDEO_DURATION_S = 10;
export const DEFAULT_IMAGE_DURATION_S = 5;

/**
 * Clamp and round a raw duration value to 0.1 s precision, enforcing
 * MIN_SCENE_DURATION_S as the lower bound.
 * Use this in every place that accepts user duration input.
 */
export function clampDurationS(val: number): number {
  const rounded = Math.round(val * 10) / 10;
  return Math.max(MIN_SCENE_DURATION_S, rounded);
}

/** Sum of all scene durations in milliseconds. */
export function totalDurationMs(scenes: Scene[]): number {
  return scenes.reduce((s, sc) => s + sc.duration * 1000, 0);
}

/** Timeline start time (ms) for the scene at `index`. */
export function sceneStartMs(scenes: Scene[], index: number): number {
  let ms = 0;
  for (let i = 0; i < index && i < scenes.length; i++) {
    ms += scenes[i]!.duration * 1000;
  }
  return ms;
}

/**
 * Maximum fraction of a scene's duration that a crossfade may consume.
 *
 * At 0.8 a fade can start as early as 20 % into the scene, giving smooth
 * dissolves on short clips while still preventing the scene from being
 * invisible for its entire playback window.
 */
const FADE_CAP_FRACTION = 0.8;

/**
 * Effective fade duration (ms) for a scene.
 *
 * Rules:
 * - Returns 0 when `transition !== "fade"` or the scene is the last one.
 * - Uses `scene.fadeDurationMs ?? DEFAULT_FADE_MS`.
 * - Capped at FADE_CAP_FRACTION (80 %) of the scene's own duration so the
 *   outgoing clip is visible for at least 20 % of its runtime before the
 *   dissolve begins.
 */
export function effectiveFadeDurationMs(scene: Scene, hasNextScene: boolean): number {
  if (scene.transition !== "fade" || !hasNextScene) return 0;
  const authored = scene.fadeDurationMs ?? DEFAULT_FADE_MS;
  return Math.min(authored, scene.duration * 1000 * FADE_CAP_FRACTION);
}

/**
 * Returns true when the authored fade duration is larger than the cap allows.
 * Used by SceneInspector to show a "capped" hint so users understand why their
 * authored value is not fully applied during playback and export.
 */
export function authoredFadeIsClipped(scene: Scene, hasNextScene: boolean): boolean {
  if (scene.transition !== "fade" || !hasNextScene) return false;
  const authored = scene.fadeDurationMs ?? DEFAULT_FADE_MS;
  return authored > scene.duration * 1000 * FADE_CAP_FRACTION;
}

/**
 * Fade progress [0, 1] for a scene given scene-relative elapsed time.
 *
 * Returns 0 for cut transitions, the last scene, or while still inside the
 * non-fade portion of the scene. Reaches 1 exactly at scene end.
 */
export function computeFadeProgress(
  scene: Scene,
  hasNextScene: boolean,
  sceneElapsedMs: number,
): number {
  const durMs = scene.duration * 1000;
  const clampedElapsed = Math.min(sceneElapsedMs, durMs);
  const fadeMs = effectiveFadeDurationMs(scene, hasNextScene);
  if (fadeMs <= 0) return 0;
  const fadeWindowStart = durMs - fadeMs;
  if (clampedElapsed <= fadeWindowStart) return 0;
  return Math.min((clampedElapsed - fadeWindowStart) / fadeMs, 1);
}

/**
 * Canonical effective timeline position (ms) from EditorShell playback state.
 *
 * Combines `sceneStartMs` with the intra-scene `seekOffsetMs`, clamping the
 * offset to the scene's own duration so the result is always in [0, totalDurationMs].
 * This is the single value that progress bars, elapsed displays, and the resume
 * clock should all derive from.
 */
export function effectiveTimelineMs(
  scenes: Scene[],
  playIndex: number,
  seekOffsetMs: number,
): number {
  const prior = sceneStartMs(scenes, playIndex);
  const dur = (scenes[playIndex]?.duration ?? 0) * 1000;
  return prior + Math.min(seekOffsetMs, dur);
}

/**
 * Active scene index for a given absolute timeline time (ms).
 *
 * Returns the last valid index when `timeMs` is at or beyond the total duration.
 */
export function activeSceneIndex(scenes: Scene[], timeMs: number): number {
  if (scenes.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    acc += scenes[i]!.duration * 1000;
    if (timeMs < acc) return i;
  }
  return scenes.length - 1;
}
