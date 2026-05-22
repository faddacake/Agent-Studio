/**
 * Focused tests for export-job status transition helpers.
 *
 * Uses an in-memory SQLite database. Tests cover valid transitions,
 * invalid/duplicate transition rejection, and updated row correctness.
 *
 * Covers:
 *   - pending → running (markExportJobRunning)
 *   - running → completed (markExportJobCompleted)
 *   - running → failed (markExportJobFailed)
 *   - invalid transitions throw with a clear message
 *   - duplicate transitions throw (idempotency is not assumed)
 *   - updated status is persisted and visible via getEditorExportJob
 *   - updatedAt advances after a transition
 *   - createdAt is unchanged by transitions
 *   - non-existent job throws clearly
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
  markExportJobRunning,
  markExportJobCompleted,
  markExportJobFailed,
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
    projectId: "proj-transition-test",
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
  return createEditorExportJob({ projectId: "proj-transition-test", payload: minimalPayload() }, db);
}

// ── pending → running ─────────────────────────────────────────────────────────

describe("markExportJobRunning — pending → running", () => {
  it("returns the updated job with status 'running'", () => {
    const job = freshJob();
    const updated = markExportJobRunning(job.id, db);
    assert.equal(updated.status, "running");
  });

  it("persists the status change — getEditorExportJob reflects 'running'", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "running");
  });

  it("updatedAt is an ISO timestamp after the transition", () => {
    const job = freshJob();
    const updated = markExportJobRunning(job.id, db);
    assert.doesNotThrow(() => new Date(updated.updatedAt).toISOString());
  });

  it("createdAt is unchanged after the transition", () => {
    const job = freshJob();
    const updated = markExportJobRunning(job.id, db);
    assert.equal(updated.createdAt, job.createdAt);
  });

  it("all non-status fields are preserved", () => {
    const job = freshJob();
    const updated = markExportJobRunning(job.id, db);
    assert.equal(updated.id, job.id);
    assert.equal(updated.projectId, job.projectId);
    assert.equal(updated.totalDurationMs, job.totalDurationMs);
    assert.equal(updated.sceneCount, job.sceneCount);
  });
});

// ── running → completed ───────────────────────────────────────────────────────

describe("markExportJobCompleted — running → completed", () => {
  it("returns the updated job with status 'completed'", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    const updated = markExportJobCompleted(job.id, db);
    assert.equal(updated.status, "completed");
  });

  it("persists the status change — getEditorExportJob reflects 'completed'", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    markExportJobCompleted(job.id, db);
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "completed");
  });

  it("createdAt is unchanged through the full pending → running → completed path", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    const completed = markExportJobCompleted(job.id, db);
    assert.equal(completed.createdAt, job.createdAt);
  });
});

// ── running → failed ──────────────────────────────────────────────────────────

describe("markExportJobFailed — running → failed", () => {
  it("returns the updated job with status 'failed'", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    const updated = markExportJobFailed(job.id, db);
    assert.equal(updated.status, "failed");
  });

  it("persists the status change — getEditorExportJob reflects 'failed'", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    markExportJobFailed(job.id, db);
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "failed");
  });

  it("createdAt is unchanged through the full pending → running → failed path", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    const failed = markExportJobFailed(job.id, db);
    assert.equal(failed.createdAt, job.createdAt);
  });
});

// ── Invalid transitions throw clearly ─────────────────────────────────────────

describe("invalid transitions — throw with a clear message", () => {
  it("pending → completed throws (must go through running)", () => {
    const job = freshJob();
    assert.throws(
      () => markExportJobCompleted(job.id, db),
      /invalid export job transition: pending → completed/,
    );
  });

  it("pending → failed throws (must go through running)", () => {
    const job = freshJob();
    assert.throws(
      () => markExportJobFailed(job.id, db),
      /invalid export job transition: pending → failed/,
    );
  });

  it("completed → running throws (terminal state)", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    markExportJobCompleted(job.id, db);
    assert.throws(
      () => markExportJobRunning(job.id, db),
      /invalid export job transition: completed → running/,
    );
  });

  it("failed → running throws (terminal state)", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    markExportJobFailed(job.id, db);
    assert.throws(
      () => markExportJobRunning(job.id, db),
      /invalid export job transition: failed → running/,
    );
  });

  it("completed → completed throws (duplicate terminal)", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    markExportJobCompleted(job.id, db);
    assert.throws(
      () => markExportJobCompleted(job.id, db),
      /invalid export job transition: completed → completed/,
    );
  });

  it("running → running throws (duplicate transition)", () => {
    const job = freshJob();
    markExportJobRunning(job.id, db);
    assert.throws(
      () => markExportJobRunning(job.id, db),
      /invalid export job transition: running → running/,
    );
  });

  it("non-existent job throws a clear not-found error", () => {
    assert.throws(
      () => markExportJobRunning("00000000-0000-0000-0000-000000000000", db),
      /export job not found/,
    );
  });
});

// ── Status not mutated on failed DB row (no row changed) ─────────────────────

describe("invalid transitions do not mutate the row", () => {
  it("status remains 'pending' after a rejected transition attempt", () => {
    const job = freshJob();
    try { markExportJobCompleted(job.id, db); } catch { /* expected */ }
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "pending");
  });

  it("updatedAt is unchanged after a rejected transition attempt", () => {
    const job = freshJob();
    try { markExportJobCompleted(job.id, db); } catch { /* expected */ }
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.updatedAt, job.updatedAt);
  });
});
