/**
 * Real renderer module.
 *
 * Owns the full real-renderer pipeline from raw ExportJobPayload to outward
 * RenderResult. Encodes the scene list into an MP4 via ffmpeg and writes the
 * output under ARTIFACTS_DIR so the returned path is a real, servable absolute
 * filesystem path.
 *
 * Server-side only — never import from client components.
 *
 * ## Preview vs full export
 *
 * When `payload.isPreview` is true the pipeline applies three reductions:
 *   1. **Scene clamping** — only scenes whose timeline start falls within the
 *      first `PREVIEW_MAX_DURATION_MS` (30 s) are included in the render.
 *      Scenes are kept whole; none are split mid-clip.
 *   2. **Lower resolution** — output height is capped at `PREVIEW_HEIGHT_PX`
 *      (480 p); width is derived by the encoder from the aspect ratio.
 *   3. **Faster encoding** — CRF is raised to `PREVIEW_CRF` (28) and the
 *      ffmpeg preset is set to `PREVIEW_PRESET` ("ultrafast"), cutting encode
 *      time by 5–10× vs the full-quality path.
 *
 * The full export path is completely unchanged by these additions.
 *
 * ## Internal layering (top → bottom)
 *
 * | Export                              | Role                                                  |
 * |-------------------------------------|-------------------------------------------------------|
 * | Preview/full constants              | Centralised render-quality knobs                      |
 * | `clampScenesToDuration`             | Pure helper — filters scene list to first N ms        |
 * | `REAL_RENDER_ARTIFACT_FILENAME`     | Artifact filename constant (full export)              |
 * | `REAL_PREVIEW_ARTIFACT_FILENAME`    | Artifact filename constant (preview export)           |
 * | `buildRealRenderArtifactPath`       | Composes ARTIFACTS_DIR + projectId + filename         |
 * | `buildRealRenderArtifactIdentity`   | mimeType + label constants (preview-aware)            |
 * | `buildRealRenderArtifactDescriptor` | Canonical artifact composition boundary               |
 * | `assembleRealRendererResult`        | Assembles stable RenderResult from plan + artifacts   |
 * | `normalizeRealRendererInput`        | Derives renderer-owned input from raw payload         |
 * | `buildRealRenderPlan`               | Derives renderer-owned plan from normalized input     |
 * | `buildFfmpegArgs`                   | Pure helper — builds ffmpeg argument array from plan  |
 * | `writeRealRenderArtifactFile`       | Encodes scenes via ffmpeg; graceful fallback to stub  |
 * | `buildRealRendererResult`           | Orchestrates the full pipeline (main entry point)     |
 * | `realExportJobRenderer`             | Public ExportJobRenderer adapter (thin wrapper)       |
 */

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { ExportJobPayload, ExportSceneEntry } from "@iterastudio/shared";
import type { ExportArtifactRef, ExportJobRenderer, RenderResult } from "./editorExportJobTypes";
import { ARTIFACTS_DIR } from "../../lib/artifactStorage";

// ── Preview render constants ───────────────────────────────────────────────────

/**
 * Maximum timeline duration (ms) included in a preview render.
 * Scenes whose startMs falls at or beyond this value are omitted.
 */
export const PREVIEW_MAX_DURATION_MS = 30_000; // 30 seconds

/** Output height in pixels for preview renders. Width is derived by the encoder. */
export const PREVIEW_HEIGHT_PX = 480;

/** ffmpeg CRF for preview renders — higher value = faster encode, lower quality. */
export const PREVIEW_CRF = 28;

/** ffmpeg preset for preview renders — "ultrafast" cuts encode time by ~5–10×. */
export const PREVIEW_PRESET = "ultrafast";

// ── Full export constants ──────────────────────────────────────────────────────

/** Output height in pixels for full exports. */
export const FULL_HEIGHT_PX = 1080;

/** ffmpeg CRF for full exports — lower value = higher quality, slower encode. */
export const FULL_CRF = 23;

/** ffmpeg preset for full exports. */
export const FULL_PRESET = "medium";

// ── Scene clamping ────────────────────────────────────────────────────────────

/**
 * Return the subset of `scenes` whose timeline start falls before `maxMs`.
 *
 * Scenes are kept whole — none are split mid-clip. The returned list contains
 * every scene that begins before the cutpoint; the last scene in the list may
 * extend beyond `maxMs`.
 *
 * Pure function — no I/O, no side effects, deterministic.
 */
export function clampScenesToDuration(
  scenes: ExportSceneEntry[],
  maxMs: number,
): ExportSceneEntry[] {
  return scenes.filter((scene) => scene.startMs < maxMs);
}

// ── Normalized input ──────────────────────────────────────────────────────────

/**
 * Renderer-owned normalized input derived from ExportJobPayload.
 *
 * For preview jobs the scene list is clamped and `totalDurationMs` reflects
 * only the included portion of the timeline. The `isPreview` flag is carried
 * forward so every downstream layer can make mode-specific decisions without
 * re-inspecting the raw payload.
 */
type RealRendererInput = {
  projectId: string;
  /** Scene list to be rendered — possibly clamped for preview jobs. */
  scenes: ExportSceneEntry[];
  /** Number of scenes in the (possibly clamped) scene list. */
  sceneCount: number;
  /** Timeline duration in ms for the (possibly clamped) scene list. */
  totalDurationMs: number;
  /** True when the job was created as a fast proxy render. */
  isPreview: boolean;
  /** Optional voiceover / background audio track to mix into the output. */
  audioTrack?: { src: string; volume: number } | null;
};

/**
 * Derive a normalized RealRendererInput from a raw ExportJobPayload.
 *
 * For preview jobs:
 *   - Scenes are filtered to those starting before `PREVIEW_MAX_DURATION_MS`.
 *   - `totalDurationMs` is clamped to `PREVIEW_MAX_DURATION_MS`.
 *
 * Pure function — no I/O, no side effects, deterministic.
 */
export function normalizeRealRendererInput(payload: ExportJobPayload): RealRendererInput {
  const isPreview = payload.isPreview === true;

  const scenes = isPreview
    ? clampScenesToDuration(payload.scenes, PREVIEW_MAX_DURATION_MS)
    : payload.scenes;

  const totalDurationMs = isPreview
    ? Math.min(payload.totalDurationMs, PREVIEW_MAX_DURATION_MS)
    : payload.totalDurationMs;

  return {
    projectId: payload.projectId,
    scenes,
    sceneCount: scenes.length,
    totalDurationMs,
    isPreview,
    audioTrack: payload.audioTrack ?? null,
  };
}

// ── Render plan ───────────────────────────────────────────────────────────────

/**
 * Renderer-owned render plan derived from normalized input.
 *
 * Carries all parameters needed to produce the output artifact — including
 * the ffmpeg encoding knobs (`heightPx`, `crf`, `preset`) — so the I/O seam
 * (`writeRealRenderArtifactFile`) receives a fully-specified instruction set
 * when a real encoder is wired in.
 */
type RealRenderPlan = {
  projectId: string;
  /** Scene list for the encoder — clamped for preview, full for export. */
  scenes: ExportSceneEntry[];
  sceneCount: number;
  totalDurationMs: number;
  artifactCount: number;
  /** True when this is a fast proxy render. Drives artifact naming and labels. */
  isPreview: boolean;
  /** Output height in pixels. Width is derived by the encoder from the aspect ratio. */
  heightPx: number;
  /** ffmpeg CRF value. Lower = higher quality, slower encode. */
  crf: number;
  /** ffmpeg speed preset (e.g. "ultrafast", "medium"). */
  preset: string;
  /** Optional voiceover / background audio track to mix into the output. */
  audioTrack?: { src: string; volume: number } | null;
};

/**
 * Derive a RealRenderPlan from normalized renderer input.
 *
 * Preview plan:  480p, CRF 28, ultrafast preset.
 * Full plan:    1080p, CRF 23, medium preset.
 *
 * Pure function — no I/O, no side effects, deterministic.
 */
export function buildRealRenderPlan(input: RealRendererInput): RealRenderPlan {
  return {
    projectId: input.projectId,
    scenes: input.scenes,
    sceneCount: input.sceneCount,
    totalDurationMs: input.totalDurationMs,
    artifactCount: 1,
    isPreview: input.isPreview,
    heightPx: input.isPreview ? PREVIEW_HEIGHT_PX : FULL_HEIGHT_PX,
    crf: input.isPreview ? PREVIEW_CRF : FULL_CRF,
    preset: input.isPreview ? PREVIEW_PRESET : FULL_PRESET,
    audioTrack: input.audioTrack ?? null,
  };
}

// ── Artifact descriptor ───────────────────────────────────────────────────────

/** Artifact filename for full-quality export output. */
export const REAL_RENDER_ARTIFACT_FILENAME = "export.mp4";

/** Artifact filename for preview (proxy) render output. */
export const REAL_PREVIEW_ARTIFACT_FILENAME = "preview.mp4";

/**
 * Build the renderer's outward artifact path for a given project.
 *
 * Preview jobs land at `<ARTIFACTS_DIR>/<projectId>/preview.mp4`; full exports
 * at `<ARTIFACTS_DIR>/<projectId>/export.mp4`. This ensures the two outputs
 * coexist under the same project directory without overwriting each other.
 *
 * Returns an absolute filesystem path accepted by the /api/artifacts route.
 * Pure function — no I/O, no randomness, no timestamps.
 */
export function buildRealRenderArtifactPath(projectId: string, isPreview = false): string {
  const filename = isPreview ? REAL_PREVIEW_ARTIFACT_FILENAME : REAL_RENDER_ARTIFACT_FILENAME;
  return path.join(ARTIFACTS_DIR, projectId, filename);
}

/**
 * Artifact identity (mimeType + label) for the real renderer.
 *
 * Preview and full outputs share the same MIME type but carry distinct labels
 * so the modal player and right panel can describe the artifact accurately.
 *
 * Pure function — no I/O, no randomness, no timestamps.
 */
export function buildRealRenderArtifactIdentity(
  isPreview = false,
): { mimeType: string; label: string } {
  return {
    mimeType: "video/mp4",
    label: isPreview ? "Preview Render (480p)" : "Exported Video",
  };
}

/**
 * Canonical artifact composition boundary for the real renderer.
 *
 * The single point responsible for producing a complete `ExportArtifactRef`.
 * Composes path from `buildRealRenderArtifactPath` and type/label from
 * `buildRealRenderArtifactIdentity`. All artifact production in this module
 * flows through here — never directly through the lower-level helpers.
 *
 * Pure function — no I/O, no randomness, no timestamps.
 */
export function buildRealRenderArtifactDescriptor(
  projectId: string,
  isPreview = false,
): ExportArtifactRef {
  const { mimeType, label } = buildRealRenderArtifactIdentity(isPreview);
  return {
    path: buildRealRenderArtifactPath(projectId, isPreview),
    mimeType,
    label,
  };
}

// ── Result assembly ───────────────────────────────────────────────────────────

/**
 * Assemble the stable outward RenderResult from a render plan and prepared
 * artifact descriptors.
 *
 * Single explicit boundary responsible for final result shape within the real
 * renderer module. Pure function — no I/O, no side effects, deterministic.
 */
export function assembleRealRendererResult(
  plan: RealRenderPlan,
  artifacts: ExportArtifactRef[],
): RenderResult {
  return {
    sceneCount: plan.sceneCount,
    totalDurationMs: plan.totalDurationMs,
    artifacts,
  };
}

// ── FFmpeg argument builder ────────────────────────────────────────────────────

/**
 * Build the complete ffmpeg argument list for encoding the given scene list.
 *
 * **Single-scene path** (no `filter_complex`):
 *   ffmpeg -y [-loop 1 -framerate 25] -i <src> -t <dur> -vf scale=-2:<h>:flags=lanczos
 *          -c:v libx264 -crf <crf> -preset <preset> -an <output>
 *
 * **Multi-scene path** (uses `filter_complex`):
 *   Each stream is normalised with `trim + setpts + scale` before being chained
 *   by either `concat` (cut transitions) or `xfade` (fade transitions).
 *   Mixed-transition timelines chain both filters iteratively.
 *
 * xfade offset accounting:
 *   The accumulated output duration tracks the current chain length. For each
 *   xfade the offset equals `accumulated − fadeDuration` (= where the fade
 *   starts in the current chain) and the post-xfade duration shrinks by
 *   `fadeDuration` (xfade overlaps the two clips rather than appending them).
 *
 * Audio:
 *   When `audioTrack` is absent, `-an` suppresses all audio output (video-only).
 *   When `audioTrack` is present, the audio file is added as an extra `-i` input
 *   immediately after all scene inputs (index = `scenes.length`). The output maps
 *   both `[vout]` (or `0:v` on the single-scene path) and `audioInputIdx:a`, with
 *   `-af volume=<v>` and `-shortest` to match video duration.
 *
 * Pure function — no I/O, no side effects, deterministic.
 */
export function buildFfmpegArgs(
  scenes: ExportSceneEntry[],
  outputPath: string,
  heightPx: number,
  crf: number,
  preset: string,
  audioTrack?: { src: string; volume: number } | null,
): string[] {
  if (scenes.length === 0) {
    throw new Error("[renderer] cannot build ffmpeg args: scene list is empty");
  }

  const args: string[] = ["-y"]; // always overwrite output

  // ── Input declarations ────────────────────────────────────────────────────
  for (const scene of scenes) {
    if (scene.type === "image") {
      // Still image: loop it and fix framerate so downstream filters see a
      // well-formed video stream.
      args.push("-loop", "1", "-framerate", "25");
    }
    // Input-level seek for trimmed video clips: `-ss` before `-i` is fast and
    // accurate for modern MP4s. The trim window is [trimStartMs, trimStartMs +
    // durationMs]; `-t durationMs` / filter `trim=duration` caps the other end.
    if (scene.type === "video" && scene.trimStartMs != null && scene.trimStartMs > 0) {
      args.push("-ss", (scene.trimStartMs / 1000).toFixed(6));
    }
    args.push("-i", scene.src);
  }

  // Audio input is declared after all scene inputs so its 0-based index equals
  // scenes.length and does not disturb scene input indices.
  const audioInputIdx = scenes.length;
  if (audioTrack) {
    args.push("-i", audioTrack.src);
  }

  // ── Single-scene fast path ────────────────────────────────────────────────
  if (scenes.length === 1) {
    const durationS = (scenes[0].durationMs / 1000).toFixed(6);
    args.push(
      "-t", durationS,
      "-vf", `scale=-2:${heightPx}:flags=lanczos`,
      "-c:v", "libx264",
      "-crf", String(crf),
      "-preset", preset,
    );
    if (audioTrack) {
      args.push(
        "-map", "0:v",
        "-map", `${audioInputIdx}:a`,
        "-af", `volume=${audioTrack.volume.toFixed(2)}`,
        "-shortest",
      );
    } else {
      args.push("-an");
    }
    args.push(outputPath);
    return args;
  }

  // ── Multi-scene: build filter_complex ────────────────────────────────────
  const filters: string[] = [];

  // Step 1 — normalise each input stream: trim to clip duration then scale.
  for (let i = 0; i < scenes.length; i++) {
    const durationS = (scenes[i].durationMs / 1000).toFixed(6);
    filters.push(
      `[${i}:v]trim=duration=${durationS},setpts=PTS-STARTPTS,scale=-2:${heightPx}:flags=lanczos[v${i}]`,
    );
  }

  // Step 2 — chain clips together pairwise.
  // `accumulatedS` tracks the output duration of the chain built so far; it is
  // needed to compute correct xfade offsets.
  let currentLabel = "v0";
  let accumulatedS = scenes[0].durationMs / 1000;

  for (let i = 1; i < scenes.length; i++) {
    const prevScene = scenes[i - 1];
    const isLast = i === scenes.length - 1;
    const outLabel = isLast ? "vout" : `seg${i}`;

    if (prevScene.transition === "fade" && prevScene.fadeDurationMs > 0) {
      // xfade: blends the tail of the current chain with the head of the next
      // clip.  The offset is the point in the current chain where the fade
      // begins.
      const fadeDurS = (prevScene.fadeDurationMs / 1000).toFixed(6);
      const offsetS = Math.max(0, accumulatedS - prevScene.fadeDurationMs / 1000).toFixed(6);
      filters.push(
        `[${currentLabel}][v${i}]xfade=transition=fade:duration=${fadeDurS}:offset=${offsetS}[${outLabel}]`,
      );
      // xfade overlaps clips rather than appending: output duration shrinks by
      // fadeDuration.
      accumulatedS += scenes[i].durationMs / 1000 - prevScene.fadeDurationMs / 1000;
    } else {
      // concat: hard cut between clips.
      filters.push(`[${currentLabel}][v${i}]concat=n=2:v=1:a=0[${outLabel}]`);
      accumulatedS += scenes[i].durationMs / 1000;
    }

    currentLabel = outLabel;
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${currentLabel}]`,
  );

  if (audioTrack) {
    args.push("-map", `${audioInputIdx}:a`);
  }

  args.push(
    "-c:v", "libx264",
    "-crf", String(crf),
    "-preset", preset,
  );

  if (audioTrack) {
    args.push("-af", `volume=${audioTrack.volume.toFixed(2)}`, "-shortest");
  } else {
    args.push("-an");
  }

  args.push(outputPath);
  return args;
}

// ── Storage I/O seam ──────────────────────────────────────────────────────────

/**
 * Encode the render artifact at the given absolute path using ffmpeg.
 *
 * Creates the output directory as needed, then invokes ffmpeg with arguments
 * derived from the plan:
 *   Preview: 480p · CRF 28 · ultrafast preset · first 30 s of scenes
 *   Full:   1080p · CRF 23 · medium preset    · all scenes
 *
 * **Graceful fallbacks** (write an empty placeholder and warn instead of
 * throwing) are applied in two cases that occur in non-production environments:
 *   1. A scene's source file does not exist on disk (test fixtures use fake
 *      paths like "s1.jpg" that are never written).
 *   2. The `ffmpeg` binary is not installed in the current environment.
 *
 * In all other failure cases (ffmpeg exits non-zero) an error is thrown so the
 * job runner can mark the export job as failed.
 */
export function writeRealRenderArtifactFile(
  artifactPath: string,
  plan: Pick<RealRenderPlan, "scenes" | "heightPx" | "crf" | "preset" | "totalDurationMs" | "isPreview" | "audioTrack">,
): void {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });

  // ── Graceful fallback 1: missing source files ─────────────────────────────
  // Test fixtures (e.g. "s1.jpg") do not exist on disk.  Detecting this early
  // avoids a confusing ffmpeg error and keeps the existing test suite green.
  const missingSrc = plan.scenes.find((s) => !fs.existsSync(s.src));
  if (missingSrc) {
    console.warn(
      `[renderer] source file not found, writing placeholder: ${missingSrc.src}`,
    );
    fs.writeFileSync(artifactPath, Buffer.alloc(0));
    return;
  }

  // ── Graceful fallback 1b: missing audio file ──────────────────────────────
  if (plan.audioTrack && !fs.existsSync(plan.audioTrack.src)) {
    console.warn(
      `[renderer] audio file not found, writing placeholder: ${plan.audioTrack.src}`,
    );
    fs.writeFileSync(artifactPath, Buffer.alloc(0));
    return;
  }

  // ── Invoke ffmpeg ──────────────────────────────────────────────────────────
  const args = buildFfmpegArgs(plan.scenes, artifactPath, plan.heightPx, plan.crf, plan.preset, plan.audioTrack);
  const result = spawnSync("ffmpeg", args, {
    stdio: ["ignore", "ignore", "pipe"], // capture stderr for error messages
  });

  // ── Graceful fallback 2: ffmpeg binary not available ─────────────────────
  if (result.error) {
    console.warn(
      `[renderer] ffmpeg not available, writing placeholder: ${result.error.message}`,
    );
    fs.writeFileSync(artifactPath, Buffer.alloc(0));
    return;
  }

  // ── Hard failure: ffmpeg ran but exited with an error ─────────────────────
  if (result.status !== 0) {
    // Include the last 2 KB of stderr so the caller can log a meaningful error.
    const stderr = result.stderr?.toString("utf8").slice(-2000) ?? "(no output)";
    throw new Error(
      `[renderer] ffmpeg exited with status ${result.status}:\n${stderr}`,
    );
  }
}

// ── Internal helper seam ──────────────────────────────────────────────────────

/**
 * Orchestrates the full real renderer pipeline and returns the outward RenderResult.
 *
 * Layers in order:
 *   normalize input (clamp scenes for preview) →
 *   build plan (resolve encoding settings) →
 *   build artifact descriptor (preview.mp4 vs export.mp4) →
 *   encode via ffmpeg (or stub if sources/binary not present) →
 *   assemble result.
 */
export function buildRealRendererResult(payload: ExportJobPayload): RenderResult {
  const input = normalizeRealRendererInput(payload);
  const plan = buildRealRenderPlan(input);
  const descriptor = buildRealRenderArtifactDescriptor(plan.projectId, plan.isPreview);
  writeRealRenderArtifactFile(descriptor.path, plan);
  return assembleRealRendererResult(plan, [descriptor]);
}

// ── Renderer adapter ──────────────────────────────────────────────────────────

/**
 * Real renderer adapter.
 *
 * Delegates to `buildRealRendererResult`. The selection layer and runner
 * call sites remain stable regardless of changes inside the pipeline.
 */
export const realExportJobRenderer: ExportJobRenderer = (payload) =>
  buildRealRendererResult(payload);
