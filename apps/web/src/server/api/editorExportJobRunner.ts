/**
 * Internal export runner — the single execution seam for queued export jobs.
 *
 * This is the one place where "executing an export job" is defined.
 * Both the testable processor path and the BullMQ worker processor mirror
 * this contract. When a real renderer is introduced, replace the `render`
 * default with the real adapter — the call site in `runExportJob` is stable.
 *
 * Server-side only — never import from client components.
 */

import { getDb } from "@iterastudio/db";
import type { ExportJobPayload } from "@iterastudio/shared";
import { ExportJobPayloadSchema } from "@iterastudio/shared";
import { getExportJobRenderer, type ExportJobRenderer, type RenderResult } from "./editorExportJobRenderer";
import { executeExportJob, getEditorExportJob, setExportJobRenderResult } from "./editorExportJobs";
import type { ExportArtifactRef, PersistedRenderResult } from "./editorExportJobTypes";

export type { PersistedRenderResult };

type Db = ReturnType<typeof getDb>;

export interface ExportRunnerResult {
  jobId: string;
  /** Terminal status the job was driven to. */
  status: "completed" | "failed";
  /**
   * Normalised render result — the stable stored contract derived from the
   * adapter output. Present on every successful execution path.
   */
  renderResult: PersistedRenderResult;
}

/**
 * Run a persisted export job through the worker-shaped lifecycle.
 *
 * Steps:
 *   1. Load the persisted job row — DB is the sole source of truth for the
 *      render input. The queue carries only { jobId }.
 *   2. Validate the stored payload against ExportJobPayloadSchema — the exact
 *      contract the renderer will consume. Fails early and clearly if invalid.
 *   3. Call the renderer adapter with the validated payload.
 *      Real renderer replaces `renderExportJob` via the `render` parameter.
 *   4. Advance the lifecycle: pending → running → completed.
 *
 * Throws if:
 *   - the job row does not exist
 *   - the stored payload fails schema validation
 *   - the renderer adapter throws
 *   - the lifecycle transition is invalid (already running/terminal)
 *
 * @param jobId  - Persisted export job UUID to execute.
 * @param db     - Optional DB instance (defaults to production DB; pass a test
 *                 DB in tests).
 * @param render - Optional renderer adapter; defaults to the placeholder.
 *                 Inject a real renderer or a test spy here.
 */
export function runExportJob(
  jobId: string,
  db?: Db,
  render: ExportJobRenderer = getExportJobRenderer(),
): ExportRunnerResult {
  const _db = db ?? getDb();

  // 1. Load the persisted job row — DB is source of truth for the render input.
  const job = getEditorExportJob(jobId, _db);
  if (!job) {
    throw new Error(`export job not found: ${jobId}`);
  }

  // 2. Validate the render input contract before advancing the lifecycle.
  //    The payload stored on the row must satisfy ExportJobPayloadSchema.
  //    Fail early and clearly if it does not.
  const parsed = ExportJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    throw new Error(
      `export job payload invalid for job ${jobId}: ${parsed.error.message}`,
    );
  }

  // 3. Call the renderer adapter with the validated payload.
  //    The job row has not been claimed yet — a renderer failure here leaves
  //    the job pending so the queue can retry.
  //    Normalise the raw adapter output into the stable PersistedRenderResult
  //    contract immediately; nothing downstream sees RenderResult directly.
  const raw: RenderResult = render(parsed.data);

  // Validate artifact refs: keep only entries that carry both path and mimeType.
  const artifacts: ExportArtifactRef[] = (raw.artifacts ?? []).filter(
    (a) => typeof a.path === "string" && a.path.length > 0 &&
           typeof a.mimeType === "string" && a.mimeType.length > 0,
  );

  const renderResult: PersistedRenderResult = {
    sceneCount: raw.sceneCount,
    totalDurationMs: raw.totalDurationMs,
    artifacts,
  };

  // 4. Advance the lifecycle: pending → running → completed.
  //    executeExportJob composes claimExportJob + finishExportJob and throws
  //    if the lifecycle transition is invalid.
  const finished = executeExportJob(jobId, "completed", _db);

  // 5. Persist the normalised render result onto the completed row.
  //    The runner is the sole normalisation authority; this is the sole write.
  setExportJobRenderResult(jobId, renderResult, _db);

  return { jobId: finished.id, status: finished.status as "completed" | "failed", renderResult };
}
