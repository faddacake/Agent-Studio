import { getDb, schema, sql } from "@iterastudio/db";

/**
 * Minimal payload shape for export-job queue messages.
 * The full export payload lives in the DB row — only the jobId travels
 * through BullMQ so the processor can look up and claim the correct row.
 */
export interface ExportJobProcessorData {
  jobId: string;
}

export interface ExportJobProcessorResult {
  jobId: string;
  /** Terminal status applied to the DB row. */
  status: "completed";
}

type Db = ReturnType<typeof getDb>;

/**
 * BullMQ processor for export-jobs queue messages.
 *
 * Mirrors the contract of `runExportJob` in
 * `apps/web/src/server/api/editorExportJobRunner.ts`.
 * Direct SQL is used here because `/worker` cannot import from
 * `apps/web`; the lifecycle semantics are identical.
 *
 *   pending → running   (atomic claim — fails fast on wrong status)
 *   running → completed (placeholder finish — renderer plugs in here)
 *
 * Throws on missing job or invalid lifecycle state so BullMQ marks the
 * queue job as failed.
 *
 * @param data - BullMQ job payload: `{ jobId }`.
 * @param db   - Optional DB instance (defaults to production DB; injectable
 *               for tests using the same pattern as the web-app helpers).
 */
export function processExportJob(
  data: ExportJobProcessorData,
  db?: Db,
): ExportJobProcessorResult {
  const _db = db ?? getDb();
  const { jobId } = data;
  const now = new Date().toISOString();

  // Atomic claim: pending → running.
  // Zero changes means either the job doesn't exist or is in the wrong state.
  const claimResult = _db.run(
    sql`UPDATE ${schema.editorExportJobs}
        SET status = 'running', updated_at = ${now}
        WHERE id = ${jobId} AND status = 'pending'`,
  );

  if ((claimResult as { changes: number }).changes === 0) {
    // Lazy lookup — only on failure to keep the happy path to one query.
    const row = _db.get(
      sql`SELECT id, status FROM ${schema.editorExportJobs} WHERE id = ${jobId}`,
    ) as { id: string; status: string } | undefined;

    if (!row) {
      throw new Error(`export job not found: ${jobId}`);
    }
    throw new Error(
      `cannot claim export job: ${jobId} (current status: ${row.status})`,
    );
  }

  // Finish: running → completed (placeholder — real renderer goes here).
  _db.run(
    sql`UPDATE ${schema.editorExportJobs}
        SET status = 'completed', updated_at = ${now}
        WHERE id = ${jobId} AND status = 'running'`,
  );

  return { jobId, status: "completed" };
}
