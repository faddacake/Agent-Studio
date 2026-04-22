/**
 * exportJob — minimal export-job payload contract for the video editor.
 *
 * Derived from `RenderPlan`; contains only what a renderer needs.
 * UI-only fields (e.g. naturalDurationMs) are intentionally excluded.
 *
 * The Zod schemas serve as both runtime validators and the single source of
 * truth for TypeScript types (via z.infer). Backend consumers should import
 * these schemas directly to validate incoming job payloads.
 */

import { z } from "zod";

// ── Text overlay ──────────────────────────────────────────────────────────────

export const ExportTextOverlaySchema = z.object({
  text: z.string().min(1),
  position: z.enum(["top", "center", "bottom"]),
  style: z.enum(["subtitle", "title", "minimal"]),
});

export type ExportTextOverlay = z.infer<typeof ExportTextOverlaySchema>;

// ── Per-scene entry ───────────────────────────────────────────────────────────

export const ExportSceneEntrySchema = z.object({
  /** Scene ID — matches the editor project scene. */
  id: z.string().min(1),
  /** Zero-based position in the scene list. */
  index: z.number().int().min(0),
  /** Media type — determines how the source file is decoded. */
  type: z.enum(["image", "video"]),
  /** Artifact path, served via /api/artifacts?path=<src>. */
  src: z.string().min(1),
  /** Playback window in milliseconds. */
  durationMs: z.number().positive(),
  /** Absolute timeline start in ms. */
  startMs: z.number().min(0),
  /** Absolute timeline end in ms (startMs + durationMs). */
  endMs: z.number().positive(),
  /** Transition type into the next scene. */
  transition: z.enum(["cut", "fade"]),
  /**
   * Effective fade duration in ms.
   * 0 for cuts and the last scene; capped at 50% of durationMs.
   */
  fadeDurationMs: z.number().min(0),
  /**
   * Absolute timeline position (ms) at which the cross-fade begins.
   * Equals endMs when fadeDurationMs is 0.
   */
  fadeStartMs: z.number().min(0),
  /** Text overlay payload, or null when the scene has no overlay. */
  textOverlay: ExportTextOverlaySchema.nullable(),
  /**
   * Trim start offset in milliseconds — where in the source clip playback begins.
   * 0 or absent means from the clip start. Only meaningful for video scenes.
   * The trim window is [trimStartMs, trimStartMs + durationMs].
   */
  trimStartMs: z.number().min(0).optional(),
});

export type ExportSceneEntry = z.infer<typeof ExportSceneEntrySchema>;

// ── Job payload ───────────────────────────────────────────────────────────────

export const ExportJobPayloadSchema = z.object({
  /** ID of the source editor project. */
  projectId: z.string().min(1),
  /** Output aspect ratio — determines renderer dimensions. */
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  /** Total timeline duration in ms — sum of all scene durations. */
  totalDurationMs: z.number().positive(),
  /** Ordered scene entries; at least one scene is required. */
  scenes: z.array(ExportSceneEntrySchema).min(1),
  /**
   * Optional audio/voiceover track to mix into the exported video.
   * Artifact path is served via /api/artifacts?path=<src>.
   */
  audioTrack: z.object({
    src: z.string().min(1),
    volume: z.number().min(0).max(1),
  }).optional(),
  /**
   * When true, the renderer should produce a fast low-resolution proxy
   * (e.g. 480p, limited to the first 30 s of the timeline).
   * Omitted or false for full-quality exports.
   */
  isPreview: z.boolean().optional(),
});

export type ExportJobPayload = z.infer<typeof ExportJobPayloadSchema>;
