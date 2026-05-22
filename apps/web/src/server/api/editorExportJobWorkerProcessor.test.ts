/**
 * Focused tests for the export-job BullMQ worker processor contract.
 *
 * Uses isolated in-memory SQLite databases. Tests exercise processExportJob
 * directly — no live Redis, no BullMQ Worker instance required.
 *
 * Covers:
 *   - queued { jobId } drives the matching DB row through the lifecycle
 *   - successful processing reaches status "completed" in the DB
 *   - result shape contains exactly { jobId, status }
 *   - processor only uses jobId from the payload (no other queue data needed)
 *   - missing DB row → throws clearly (BullMQ will mark job failed)
 *   - job already running → throws (lifecycle guard enforced)
 *   - job already completed → throws (lifecycle guard enforced)
 *   - job already failed → throws (lifecycle guard enforced)
 *   - non-status DB fields are unchanged after processing
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import {
  createEditorExportJob,
  getEditorExportJob,
  claimExportJob,
  executeExportJob,
} from "./editorExportJobs";
import { processExportJob } from "./editorExportJobProcessor";
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

function makeDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIGRATION_SQL);
  return drizzle(sqlite, { schema });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function minimalPayload(projectId = "proj-processor"): ExportJobPayload {
  return {
    projectId,
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

function makeJob(db: TestDb, projectId = "proj-processor") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

// ── Successful processing ─────────────────────────────────────────────────────

describe("processExportJob — successful processing", () => {
  it("returns a result with status 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = processExportJob({ jobId: job.id }, db);
    assert.equal(result.status, "completed");
  });

  it("result jobId matches the input jobId", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = processExportJob({ jobId: job.id }, db);
    assert.equal(result.jobId, job.id);
  });

  it("persisted row status is 'completed' after processing", () => {
    const db = makeDb();
    const job = makeJob(db);
    processExportJob({ jobId: job.id }, db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("persisted row updatedAt advances after processing", () => {
    const db = makeDb();
    const job = makeJob(db);
    const before = job.updatedAt;
    processExportJob({ jobId: job.id }, db);
    const after = getEditorExportJob(job.id, db)!.updatedAt;
    assert.ok(after >= before);
  });

  it("non-status fields in persisted row are unchanged after processing", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-field-check");
    processExportJob({ jobId: job.id }, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.id, job.id);
    assert.equal(row.projectId, job.projectId);
    assert.equal(row.totalDurationMs, job.totalDurationMs);
    assert.equal(row.sceneCount, job.sceneCount);
    assert.equal(row.createdAt, job.createdAt);
  });
});

// ── Result shape ──────────────────────────────────────────────────────────────

describe("processExportJob — result shape", () => {
  it("result has exactly three fields: jobId, renderResult, and status", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = processExportJob({ jobId: job.id }, db);
    assert.deepEqual(Object.keys(result).sort(), ["jobId", "renderResult", "status"]);
  });

  it("processor payload only requires jobId — no other queue data needed", () => {
    const db = makeDb();
    const job = makeJob(db);
    // Passing only { jobId } is sufficient — no payload, no scene data
    const result = processExportJob({ jobId: job.id }, db);
    assert.ok(result);
  });
});

// ── Error cases — BullMQ will mark job failed on throw ────────────────────────

describe("processExportJob — error cases (→ BullMQ job failure)", () => {
  it("throws with 'not found' message for a missing DB row", () => {
    const db = makeDb();
    assert.throws(
      () => processExportJob({ jobId: "00000000-0000-0000-0000-000000000000" }, db),
      /export job not found/,
    );
  });

  it("throws for a job that is already running", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimExportJob(job.id, db);
    assert.throws(
      () => processExportJob({ jobId: job.id }, db),
      /invalid export job transition/,
    );
  });

  it("throws for a job that is already completed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "completed", db);
    assert.throws(
      () => processExportJob({ jobId: job.id }, db),
      /invalid export job transition/,
    );
  });

  it("throws for a job that is already failed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "failed", db);
    assert.throws(
      () => processExportJob({ jobId: job.id }, db),
      /invalid export job transition/,
    );
  });
});

// ── Multiple jobs — each processed independently ─────────────────────────────

describe("processExportJob — multiple independent jobs", () => {
  it("processes two separate jobs without interference", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-multi-1");
    const j2 = makeJob(db, "proj-multi-2");

    processExportJob({ jobId: j1.id }, db);
    processExportJob({ jobId: j2.id }, db);

    assert.equal(getEditorExportJob(j1.id, db)!.status, "completed");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "completed");
  });

  it("processing one job does not affect another pending job", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-isolate-1");
    const j2 = makeJob(db, "proj-isolate-2");

    processExportJob({ jobId: j1.id }, db);

    assert.equal(getEditorExportJob(j2.id, db)!.status, "pending");
  });
});
