/**
 * Shared internal types for the export job execution pipeline.
 *
 * Contains the renderer contract types (`RenderResult`, `ExportJobRenderer`)
 * and the persisted contract type (`PersistedRenderResult`) so all layers can
 * import from one location without circular dependencies.
 *
 * Server-side only — never import from client components.
 */

import type { ExportJobPayload } from "@iterastudio/shared";

// ── Artifact reference ────────────────────────────────────────────────────────

/**
 * A reference to a single render output artifact.
 *
 * Pure reference contract — no storage, no DB linkage. `path` is the opaque
 * route or file path at which the artifact will be available. When a real
 * renderer is introduced it will populate this with a real storage path;
 * until then the placeholder adapter returns a deterministic mock path.
 */
export interface ExportArtifactRef {
  /** Route or file path at which the artifact is accessible. */
  path: string;
  /** MIME type of the artifact (e.g. "video/mp4"). */
  mimeType: string;
  /** Optional human-readable label for display. */
  label?: string;
}

// ── Renderer contract ─────────────────────────────────────────────────────────

/**
 * The raw result produced by a renderer adapter before runner normalisation.
 * Distinct from `PersistedRenderResult` so the renderer and stored contracts
 * can evolve independently.
 */
export interface RenderResult {
  /** Number of scenes rendered. */
  sceneCount: number;
  /** Total timeline duration in ms. */
  totalDurationMs: number;
  /** Artifact references produced by this render pass. */
  artifacts: ExportArtifactRef[];
}

/**
 * Named contract for any renderer adapter accepted by the runner.
 *
 * The placeholder, test spies, and future real renderers all satisfy this type.
 */
export type ExportJobRenderer = (payload: ExportJobPayload) => RenderResult;

// ── Persisted render result ───────────────────────────────────────────────────

/**
 * Stable stored contract for the result of a completed render step.
 *
 * Contains only the fields that are guaranteed by every renderer variant.
 * `artifacts` carries zero or more artifact references normalised by the
 * runner; a real renderer will populate these with actual output paths.
 */
export interface PersistedRenderResult {
  /** Number of scenes processed. Normalised from the adapter output. */
  sceneCount: number;
  /** Total timeline duration in ms. Normalised from the adapter output. */
  totalDurationMs: number;
  /** Artifact references produced by the renderer. Empty for the placeholder. */
  artifacts: ExportArtifactRef[];
}
