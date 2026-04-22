/**
 * exportPayload — pure builder that converts a `RenderPlan` into a minimal
 * `ExportJobPayload` suitable for backend rendering.
 *
 * Rules:
 * - All timing, transition, and overlay fields are read directly from the plan.
 * - UI-only context fields (naturalDurationMs) are intentionally omitted.
 * - No timing math is re-derived here; the plan's pre-computed values are used as-is.
 */

import type { RenderPlan } from "./renderPlan";
import type { AspectRatio, AudioTrack } from "./editorProjectTypes";
import type { ExportJobPayload, ExportSceneEntry } from "@aistudio/shared";

export type { ExportJobPayload, ExportSceneEntry };

/**
 * Convert a pre-built `RenderPlan` into the minimal `ExportJobPayload`
 * that a backend renderer consumes.
 *
 * @param plan - The canonical render plan from `buildRenderPlan`.
 * @param projectId - ID of the source editor project.
 * @param aspectRatio - Output aspect ratio for the renderer.
 * @param options.isPreview - When true, signals the renderer to produce a
 *   fast low-resolution proxy (e.g. 480p, first 30 s only).
 */
export function buildExportPayload(
  plan: RenderPlan,
  projectId: string,
  aspectRatio: AspectRatio,
  options?: { isPreview?: boolean; audioTrack?: AudioTrack | null },
): ExportJobPayload {
  const scenes: ExportSceneEntry[] = plan.scenes.map((entry) => ({
    id: entry.id,
    index: entry.index,
    type: entry.type,
    src: entry.src,
    durationMs: entry.durationMs,
    startMs: entry.startMs,
    endMs: entry.endMs,
    transition: entry.transition,
    fadeDurationMs: entry.fadeDurationMs,
    fadeStartMs: entry.fadeStartMs,
    textOverlay: entry.textOverlay,
    ...(entry.trimStartMs != null && entry.trimStartMs > 0
      ? { trimStartMs: entry.trimStartMs }
      : {}),
  }));

  return {
    projectId,
    aspectRatio,
    totalDurationMs: plan.totalDurationMs,
    scenes,
    ...(options?.audioTrack ? { audioTrack: options.audioTrack } : {}),
    ...(options?.isPreview ? { isPreview: true } : {}),
  };
}
