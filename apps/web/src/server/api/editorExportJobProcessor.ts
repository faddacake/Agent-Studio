/**
 * Export-job processor — thin adapter between BullMQ job data and the runner.
 *
 * Unwraps the `{ jobId }` BullMQ payload and delegates execution to
 * `runExportJob`, the single authoritative execution seam.
 *
 * Server-side only — never import from client components.
 */

import { getDb } from "@iterastudio/db";
import { runExportJob, type ExportRunnerResult } from "./editorExportJobRunner";

type Db = ReturnType<typeof getDb>;

export interface ExportJobProcessorData {
  /** Persisted export job UUID from the BullMQ payload. */
  jobId: string;
}

export function processExportJob(
  data: ExportJobProcessorData,
  db?: Db,
): ExportRunnerResult {
  return runExportJob(data.jobId, db);
}
