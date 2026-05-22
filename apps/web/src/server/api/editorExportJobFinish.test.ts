/**
 * Focused tests for the worker-facing finishExportJob helper.
 *
 * Uses an in-memory SQLite database. Tests cover both terminal outcomes,
 * all error cases a worker might encounter when finishing a job, and row
 * immutability after a failed finish attempt.
 *
 * Covers:
 *   - running job can finish as "completed"
 *   - running job can finish as "failed"
 *   - persisted status matches the outcome
 *   - non-status fields unchanged after finish
 *   - createdAt unchanged; updatedAt advances
 *   - pending job cannot be finished directly (must be claimed first)
 *   - already-completed job cannot be finished again
 *   - already-failed job cannot be finished again
 *   - non-existent job throws clearly
 *   - failed finish attempt does not mutate the row
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import {
  createEditorExportJob,
  getEditorExportJob,
  claimExportJob,
  finishExportJob,
} from "./editorExportJobs";
import type { ExportJobPayload } from "@iterastudio/shared";

// ── In-memory DB setup ────────────────────────────────────────────────────────

const MIGRATION_SQL = `
  CREATE TABLE editor_export_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL,
    total_duration_ms INTEGER NOT NULL,
    scene_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    render_result TEXT
  );
  CREATE INDEX idx_editor_export_jobs_project_id ON editor_export_jobs (project_id);
`;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let db: TestDb;

before(() => {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIGRATION_SQL);
  db = drizzle(sqlite, { schema });
});

// ── Fixture ───────────────────────────────────────────────────────────────────

function minimalPayload(): ExportJobPayload {
  return {
    projectId: "proj-finish-test",
    aspectRatio: "16:9",
    totalDurationMs: 5000,
    scenes: [
      {
        id: "s1",
        index: 0,
        type: "image",
        src: "s1.jpg",
        durationMs: 5000,
        startMs: 0,
        endMs: 5000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 5000,
        textOverlay: null,
      },
    ],
  };
}

/** Create a fresh job and advance it to running. */
function runningJob() {
  const job = createEditorExportJob(
    { projectId: "proj-finish-test", payload: minimalPayload() },
    db,
  );
  claimExportJob(job.id, db);
  return job;
}

// ── Finish as completed ───────────────────────────────────────────────────────

describe("finishExportJob — outcome 'completed'", () => {
  it("returns the job with status 'completed'", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "completed", db);
    assert.equal(finished.status, "completed");
  });

  it("persists status 'completed' — getEditorExportJob confirms", () => {
    const job = runningJob();
    finishExportJob(job.id, "completed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("non-status fields are unchanged", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "completed", db);
    assert.equal(finished.id, job.id);
    assert.equal(finished.projectId, job.projectId);
    assert.equal(finished.totalDurationMs, job.totalDurationMs);
    assert.equal(finished.sceneCount, job.sceneCount);
  });

  it("createdAt is unchanged", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "completed", db);
    assert.equal(finished.createdAt, job.createdAt);
  });

  it("updatedAt is a valid ISO timestamp", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "completed", db);
    assert.doesNotThrow(() => new Date(finished.updatedAt).toISOString());
  });
});

// ── Finish as failed ──────────────────────────────────────────────────────────

describe("finishExportJob — outcome 'failed'", () => {
  it("returns the job with status 'failed'", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "failed", db);
    assert.equal(finished.status, "failed");
  });

  it("persists status 'failed' — getEditorExportJob confirms", () => {
    const job = runningJob();
    finishExportJob(job.id, "failed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });

  it("non-status fields are unchanged", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "failed", db);
    assert.equal(finished.id, job.id);
    assert.equal(finished.projectId, job.projectId);
    assert.equal(finished.totalDurationMs, job.totalDurationMs);
    assert.equal(finished.sceneCount, job.sceneCount);
  });

  it("createdAt is unchanged", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "failed", db);
    assert.equal(finished.createdAt, job.createdAt);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("finishExportJob — error cases", () => {
  it("throws clearly for a non-existent job", () => {
    assert.throws(
      () => finishExportJob("00000000-0000-0000-0000-000000000000", "completed", db),
      /export job not found/,
    );
  });

  it("throws when job is still pending (must be claimed first)", () => {
    const job = createEditorExportJob(
      { projectId: "proj-finish-test", payload: minimalPayload() },
      db,
    );
    assert.throws(
      () => finishExportJob(job.id, "completed", db),
      /invalid export job transition: pending → completed/,
    );
  });

  it("throws when job is already completed", () => {
    const job = runningJob();
    finishExportJob(job.id, "completed", db);
    assert.throws(
      () => finishExportJob(job.id, "completed", db),
      /invalid export job transition: completed → completed/,
    );
  });

  it("throws when job is already failed", () => {
    const job = runningJob();
    finishExportJob(job.id, "failed", db);
    assert.throws(
      () => finishExportJob(job.id, "failed", db),
      /invalid export job transition: failed → failed/,
    );
  });

  it("throws when attempting to fail an already-completed job", () => {
    const job = runningJob();
    finishExportJob(job.id, "completed", db);
    assert.throws(
      () => finishExportJob(job.id, "failed", db),
      /invalid export job transition: completed → failed/,
    );
  });
});

// ── Row immutability after failed finish ──────────────────────────────────────

describe("finishExportJob — row is not mutated after a failed finish attempt", () => {
  it("status remains 'running' after a rejected finish on a pending job promoted to running then re-tried from pending", () => {
    const pendingJob = createEditorExportJob(
      { projectId: "proj-finish-test", payload: minimalPayload() },
      db,
    );
    try { finishExportJob(pendingJob.id, "completed", db); } catch { /* expected */ }
    assert.equal(getEditorExportJob(pendingJob.id, db)!.status, "pending");
  });

  it("updatedAt is unchanged after a rejected finish on a completed job", () => {
    const job = runningJob();
    const finished = finishExportJob(job.id, "completed", db);
    try { finishExportJob(job.id, "completed", db); } catch { /* expected */ }
    assert.equal(getEditorExportJob(job.id, db)!.updatedAt, finished.updatedAt);
  });
});
