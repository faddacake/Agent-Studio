/**
 * EditorProject types — used by the Video Editor V1 persistence layer.
 *
 * Scenes reference artifacts by path only; the artifact system remains the
 * source of truth. No artifact data is duplicated here.
 */

export type AspectRatio = "16:9" | "9:16" | "1:1";

export interface TextOverlay {
  text: string;
  position: "top" | "center" | "bottom";
  style: "subtitle" | "title" | "minimal";
}

export interface Scene {
  id: string;
  /** "image" | "video" — determines how the scene is rendered in the editor. */
  type: "image" | "video";
  /** Absolute artifact path — served via /api/artifacts?path=<src>. */
  src: string;
  /**
   * Scene duration in seconds — the playback window on the timeline.
   *
   * For **image** scenes: how long the image is displayed.
   * For **video** scenes: how long the scene occupies the timeline. The video
   *   plays from its beginning for this many seconds. If shorter than the clip's
   *   natural length the video is cut off when the scene advances; if longer the
   *   video freezes on its last frame. This is NOT a trim of the source file.
   *
   * Minimum: MIN_SCENE_DURATION_S (0.1 s). Precision: 0.1 s.
   */
  duration: number;
  /**
   * Detected natural duration of the video clip in seconds, populated once on
   * first metadata load. Absent for image scenes or before metadata has loaded.
   * Never used for playback timing — `duration` is always the authoritative
   * playback window.
   */
  naturalDuration?: number;
  /**
   * Trim start offset in seconds — where in the source clip playback begins.
   * Defaults to 0 (from clip start). Only meaningful for video scenes.
   * The trim window is [trimStart, trimStart + duration]; constrained to
   * [0, naturalDuration - duration].
   */
  trimStart?: number;
  textOverlay?: TextOverlay;
  /** Simple cut-or-fade transition into the next scene. */
  transition?: "cut" | "fade";
  /** Fade duration in milliseconds. Only used when transition === "fade". Defaults to 800 ms. */
  fadeDurationMs?: number;
}

export interface AudioTrack {
  /** Absolute artifact path — served via /api/artifacts?path=<src>. */
  src: string;
  /** Volume level 0–1. */
  volume: number;
}

export interface EditorProject {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  scenes: Scene[];
  audioTrack?: AudioTrack;
  createdAt: string;
  updatedAt: string;
}

// ── Input shapes ────────────────────────────────────────────────────────────

export interface CreateEditorProjectInput {
  name: string;
  aspectRatio?: AspectRatio;
  scenes?: Scene[];
  audioTrack?: AudioTrack;
}

export interface UpdateEditorProjectInput {
  name?: string;
  aspectRatio?: AspectRatio;
  scenes?: Scene[];
  /** Passing null clears the audio track. */
  audioTrack?: AudioTrack | null;
}
