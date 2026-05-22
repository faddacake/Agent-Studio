/**
 * Data access functions for EditorExportJob.
 * Called by the /api/editor-projects/[id]/export route handler.
 * Server-side only — never import from client components.
 */

import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";
import type { ExportJobPayload } from "@iterastudio/shared";
import type { PersistedRenderResult } from "./editorExportJobTypes";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExportJobStatus = "pending" | "running" | "completed" | "failed";

// Explicit allowed predecessors for each target status.
// Transitions not listed here are rejected with a clear error.
const ALLOWED_FROM: Record<ExportJobStatus, readonly ExportJobStatus[]> = {
  pending:   [],               // creation only — never transitioned into
  running:   ["pending"],
  completed: ["running"],
  failed:    ["running"],
};

export interface EditorExportJob {
  id: string;
  projectId: string;
  status: ExportJobStatus;
  /** Validated export payload — the exact data a renderer will consume. */
  payload: ExportJobPayload;
  totalDurationMs: number;
  sceneCount: number;
  /**
   * Normalised render result written by the runner after successful execution.
   * Null for pending, running, failed, or any job that has not yet been rendered.
   */
  renderResult: PersistedRenderResult | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof getDb>;

function parseRow(row: typeof schema.editorExportJobs.$inferSelect): EditorExportJob {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as ExportJobStatus,
    payload: JSON.parse(row.payload as string) as ExportJobPayload,
    totalDurationMs: row.totalDurationMs,
    sceneCount: row.sceneCount,
    renderResult: row.renderResult
      ? (JSON.parse(row.renderResult as string) as PersistedRenderResult)
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Persist a new export job record with status "pending".
 * The validated payload is stored verbatim as JSON.
 *
 * @param input.projectId - Source editor project ID.
 * @param input.payload   - Validated ExportJobPayload from the schema.
 * @param db              - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function createEditorExportJob(
  input: { projectId: string; payload: ExportJobPayload },
  db?: Db,
): EditorExportJob {
  const _db = db ?? getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  _db
    .insert(schema.editorExportJobs)
    .values({
      id,
      projectId: input.projectId,
      status: "pending",
      payload: JSON.stringify(input.payload),
      totalDurationMs: input.payload.totalDurationMs,
      sceneCount: input.payload.scenes.length,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    id,
    projectId: input.projectId,
    status: "pending",
    payload: input.payload,
    totalDurationMs: input.payload.totalDurationMs,
    sceneCount: input.payload.scenes.length,
    renderResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fetch a single export job by ID.
 * Returns null if no matching row exists.
 *
 * `renderResult` is returned as parsed structured data — never as a raw JSON
 * string. Callers must not parse `renderResult` manually.
 *
 * @param id - Job UUID.
 * @param db - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function getEditorExportJob(id: string, db?: Db): EditorExportJob | null {
  const _db = db ?? getDb();
  const row = _db
    .select()
    .from(schema.editorExportJobs)
    .where(eq(schema.editorExportJobs.id, id))
    .get();
  return row ? parseRow(row) : null;
}

/**
 * Write the normalised render result onto a completed export job row.
 *
 * Called exclusively by the runner after successful execution. The runner is
 * the sole normalisation authority; this function is the sole write path.
 *
 * Throws if the job does not exist.
 * Does not enforce lifecycle state — the runner is responsible for calling
 * this only after the job has been driven to "completed".
 *
 * @param id           - Job UUID.
 * @param renderResult - Normalised PersistedRenderResult from the runner.
 * @param db           - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function setExportJobRenderResult(
  id: string,
  renderResult: PersistedRenderResult,
  db?: Db,
): EditorExportJob {
  const _db = db ?? getDb();
  const now = new Date().toISOString();
  _db
    .update(schema.editorExportJobs)
    .set({ renderResult: JSON.stringify(renderResult), updatedAt: now })
    .where(eq(schema.editorExportJobs.id, id))
    .run();
  const updated = getEditorExportJob(id, _db);
  if (!updated) {
    throw new Error(`export job not found after renderResult write: ${id}`);
  }
  return updated;
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Return the oldest pending export job without claiming or mutating it.
 * Returns null when no pending job exists.
 *
 * Ordering: `createdAt ASC`, then `id ASC` as a deterministic tie-breaker.
 * Read-only — no side effects on the row.
 *
 * @param db - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function getNextPendingExportJob(db?: Db): EditorExportJob | null {
  const _db = db ?? getDb();
  const row = _db
    .select()
    .from(schema.editorExportJobs)
    .where(eq(schema.editorExportJobs.status, "pending"))
    .orderBy(schema.editorExportJobs.createdAt, schema.editorExportJobs.id)
    .limit(1)
    .get();
  return row ? parseRow(row) : null;
}

/**
 * Atomically select and claim the next pending export job.
 *
 * Finds the oldest pending job (createdAt ASC, id ASC tie-breaker) and
 * transitions it to `running` within a single database transaction.
 * Returns the claimed job or null when no pending job exists.
 *
 * Selection and claiming are guaranteed to be atomic — no concurrent caller
 * can claim the same job between the SELECT and the status UPDATE.
 *
 * This is the first true queue-consumer boundary. Do not call `claimExportJob`
 * separately on the same job — use this helper instead.
 *
 * @param db - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function claimNextPendingExportJob(db?: Db): EditorExportJob | null {
  const _db = db ?? getDb();
  return _db.transaction((tx) => {
    const txDb = tx as unknown as Db;
    const job = getNextPendingExportJob(txDb);
    if (!job) return null;
    return claimExportJob(job.id, txDb);
  });
}

// ── Status transitions ────────────────────────────────────────────────────────

/**
 * Apply a status transition, enforcing the allowed-predecessor rule.
 * Throws if the job does not exist or the transition is invalid.
 * Updates `status` and `updatedAt`; returns the updated record.
 */
function transitionJob(id: string, to: ExportJobStatus, db?: Db): EditorExportJob {
  const _db = db ?? getDb();
  const job = getEditorExportJob(id, _db);

  if (!job) {
    throw new Error(`export job not found: ${id}`);
  }

  const allowed = ALLOWED_FROM[to];
  if (!allowed.includes(job.status)) {
    throw new Error(
      `invalid export job transition: ${job.status} → ${to} (allowed from: ${allowed.join(", ") || "none"})`,
    );
  }

  const now = new Date().toISOString();
  _db
    .update(schema.editorExportJobs)
    .set({ status: to, updatedAt: now })
    .where(eq(schema.editorExportJobs.id, id))
    .run();

  return { ...job, status: to, updatedAt: now };
}

/**
 * Transition a pending job to running.
 * Throws if the job is not currently pending.
 */
export function markExportJobRunning(id: string, db?: Db): EditorExportJob {
  return transitionJob(id, "running", db);
}

/**
 * Transition a running job to completed.
 * Throws if the job is not currently running.
 */
export function markExportJobCompleted(id: string, db?: Db): EditorExportJob {
  return transitionJob(id, "completed", db);
}

/**
 * Transition a running job to failed.
 * Throws if the job is not currently running.
 */
export function markExportJobFailed(id: string, db?: Db): EditorExportJob {
  return transitionJob(id, "failed", db);
}

// ── Worker claim ─────────────────────────────────────────────────────────────

/**
 * Worker-facing entry point for starting an export job.
 *
 * Atomically verifies the job is `pending` and transitions it to `running`.
 * This is the single sanctioned way for a worker to claim a job; all guard
 * logic is enforced by the underlying transition helper.
 *
 * Throws if:
 *   - the job does not exist
 *   - the job is already `running` (already claimed by another worker)
 *   - the job is terminal (`completed` or `failed`)
 *
 * @param id - Job UUID to claim.
 * @param db - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function claimExportJob(id: string, db?: Db): EditorExportJob {
  return markExportJobRunning(id, db);
}

// ── Worker finish ─────────────────────────────────────────────────────────────

/**
 * Worker-facing entry point for finishing a claimed export job.
 *
 * Requires the job to be `running` (i.e. already claimed) and transitions it
 * to the requested terminal status. This is the single sanctioned way for a
 * worker to report a final outcome; all guard logic is enforced by the
 * underlying transition helpers.
 *
 * Throws if:
 *   - the job does not exist
 *   - the job is still `pending` (must be claimed first)
 *   - the job is already terminal (`completed` or `failed`)
 *
 * @param id      - Job UUID to finish.
 * @param outcome - Terminal status to apply: "completed" or "failed".
 * @param db      - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function finishExportJob(
  id: string,
  outcome: "completed" | "failed",
  db?: Db,
): EditorExportJob {
  return outcome === "completed"
    ? markExportJobCompleted(id, db)
    : markExportJobFailed(id, db);
}

// ── Execution driver ──────────────────────────────────────────────────────────

/**
 * Internal execution driver — the first worker-shaped export path.
 *
 * Composes the two worker-facing primitives into one atomic in-process call:
 *   1. claimExportJob  (pending → running)
 *   2. finishExportJob (running → completed | failed)
 *
 * This is the exact sequence a real worker will follow. No rendering,
 * no queue, no artifacts — the outcome is supplied explicitly so the
 * lifecycle can be exercised end-to-end before real execution is wired in.
 *
 * Throws (via the underlying helpers) if:
 *   - the job does not exist
 *   - the job cannot be claimed (not pending)
 *   - the job cannot be finished (already terminal after claim, or invalid outcome)
 *
 * @param id      - Job UUID to execute.
 * @param outcome - Terminal status to apply: "completed" or "failed".
 * @param db      - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function executeExportJob(
  id: string,
  outcome: "completed" | "failed",
  db?: Db,
): EditorExportJob {
  claimExportJob(id, db);
  return finishExportJob(id, outcome, db);
}

// ── Simulation ────────────────────────────────────────────────────────────────

/**
 * Advance a pending job through the full lifecycle in one synchronous call.
 * Used by the internal simulation route to exercise the transition chain
 * without real rendering or queue infrastructure.
 *
 * - "success": pending → running → completed
 * - "failure": pending → running → failed
 *
 * Throws (via the underlying helpers) if the job does not exist or is not
 * currently pending (e.g. already transitioned by a prior simulation call).
 */
export function simulateExportJob(
  id: string,
  outcome: "success" | "failure",
  db?: Db,
): EditorExportJob {
  markExportJobRunning(id, db);
  return outcome === "success"
    ? markExportJobCompleted(id, db)
    : markExportJobFailed(id, db);
}

// ── Worker-loop skeleton ───────────────────────────────────────────────────────

export interface DrainExportQueueResult {
  /** Number of jobs claimed and driven to terminal status. */
  processed: number;
  /** IDs of each processed job, in claim order (oldest-first). */
  jobIds: string[];
  /** Terminal status applied to every processed job. */
  outcome: "completed" | "failed";
}

/**
 * Internal worker-loop skeleton — drains all pending export jobs in-process.
 *
 * Repeatedly claims and finishes pending jobs until no pending job remains:
 *   1. claimNextPendingExportJob  (atomic select + pending → running)
 *   2. finishExportJob            (running → completed | failed)
 *   repeat until step 1 returns null
 *
 * Synchronous. No renderer, no ffmpeg, no artifacts, no retries, no delays.
 * This is the closest pre-queue stand-in for a real worker loop.
 *
 * @param outcome - Terminal status to apply to every processed job.
 * @param db      - Optional DB instance (defaults to production DB; pass a test DB in tests).
 */
export function drainExportQueue(
  outcome: "completed" | "failed",
  db?: Db,
): DrainExportQueueResult {
  const jobIds: string[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const claimed = claimNextPendingExportJob(db);
    if (!claimed) break;
    finishExportJob(claimed.id, outcome, db);
    jobIds.push(claimed.id);
  }

  return { processed: jobIds.length, jobIds, outcome };
}
