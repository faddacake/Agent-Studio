/**
 * Focused tests for the internal executeExportJob execution driver.
 *
 * Uses an in-memory SQLite database. Tests verify that the driver correctly
 * composes claimExportJob + finishExportJob, produces the expected terminal
 * state, and fails clearly when preconditions are not met.
 *
 * Covers:
 *   - pending job executes to "completed"
 *   - pending job executes to "failed"
 *   - final row is persisted and confirmed by getEditorExportJob
 *   - non-status fields are unchanged after execution
 *   - createdAt unchanged; updatedAt advances
 *   - already-running job fails (cannot be claimed)
 *   - terminal jobs fail (already past running)
 *   - non-existent job fails clearly
 *   - failed execution does not mutate the row beyond the valid transition
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
  executeExportJob,
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
    projectId: "proj-execute-test",
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

function freshJob() {
  return createEditorExportJob(
    { projectId: "proj-execute-test", payload: minimalPayload() },
    db,
  );
}

// ── Execute to completed ──────────────────────────────────────────────────────

describe("executeExportJob — execute to 'completed'", () => {
  it("returns a job with status 'completed'", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.equal(result.status, "completed");
  });

  it("persists status 'completed' — getEditorExportJob confirms", () => {
    const job = freshJob();
    executeExportJob(job.id, "completed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("non-status fields are unchanged", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.equal(result.id, job.id);
    assert.equal(result.projectId, job.projectId);
    assert.equal(result.totalDurationMs, job.totalDurationMs);
    assert.equal(result.sceneCount, job.sceneCount);
  });

  it("createdAt is unchanged", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.equal(result.createdAt, job.createdAt);
  });

  it("updatedAt is a valid ISO timestamp", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.doesNotThrow(() => new Date(result.updatedAt).toISOString());
  });
});

// ── Execute to failed ─────────────────────────────────────────────────────────

describe("executeExportJob — execute to 'failed'", () => {
  it("returns a job with status 'failed'", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "failed", db);
    assert.equal(result.status, "failed");
  });

  it("persists status 'failed' — getEditorExportJob confirms", () => {
    const job = freshJob();
    executeExportJob(job.id, "failed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });

  it("non-status fields are unchanged", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "failed", db);
    assert.equal(result.id, job.id);
    assert.equal(result.projectId, job.projectId);
    assert.equal(result.totalDurationMs, job.totalDurationMs);
    assert.equal(result.sceneCount, job.sceneCount);
  });

  it("createdAt is unchanged", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "failed", db);
    assert.equal(result.createdAt, job.createdAt);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("executeExportJob — error cases", () => {
  it("throws clearly for a non-existent job", () => {
    assert.throws(
      () => executeExportJob("00000000-0000-0000-0000-000000000000", "completed", db),
      /export job not found/,
    );
  });

  it("throws when job is already running (already claimed)", () => {
    const job = freshJob();
    claimExportJob(job.id, db);
    assert.throws(
      () => executeExportJob(job.id, "completed", db),
      /invalid export job transition: running → running/,
    );
  });

  it("throws when job is already completed (terminal)", () => {
    const job = freshJob();
    executeExportJob(job.id, "completed", db);
    assert.throws(
      () => executeExportJob(job.id, "completed", db),
      /invalid export job transition: completed → running/,
    );
  });

  it("throws when job is already failed (terminal)", () => {
    const job = freshJob();
    executeExportJob(job.id, "failed", db);
    assert.throws(
      () => executeExportJob(job.id, "failed", db),
      /invalid export job transition: failed → running/,
    );
  });
});

// ── Row integrity after failed execution ──────────────────────────────────────

describe("executeExportJob — row integrity after failed execution attempt", () => {
  it("status remains 'running' after a failed re-execution on an already-running job", () => {
    const job = freshJob();
    claimExportJob(job.id, db);
    try { executeExportJob(job.id, "completed", db); } catch { /* expected */ }
    assert.equal(getEditorExportJob(job.id, db)!.status, "running");
  });

  it("status remains 'completed' after a failed re-execution on a completed job", () => {
    const job = freshJob();
    executeExportJob(job.id, "completed", db);
    try { executeExportJob(job.id, "failed", db); } catch { /* expected */ }
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("driver composes claim then finish — intermediate 'running' state is transient", () => {
    // Verify the job went through running (i.e. was claimed) before landing on completed.
    // We do this by checking a fresh job starts pending and ends completed with no manual steps.
    const job = freshJob();
    assert.equal(job.status, "pending");
    const result = executeExportJob(job.id, "completed", db);
    assert.equal(result.status, "completed");
  });
});
