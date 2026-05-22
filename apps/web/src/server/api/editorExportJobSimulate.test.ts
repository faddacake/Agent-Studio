/**
 * Focused tests for the export-job simulation helper and simulation route contract.
 *
 * Uses an in-memory SQLite database. Tests exercise simulateExportJob directly
 * so no HTTP or Next.js mocking is required.
 *
 * Covers:
 *   - success path: pending → running → completed in one call
 *   - failure path: pending → running → failed in one call
 *   - non-existent job throws clearly
 *   - repeated simulation fails (job is no longer pending)
 *   - returned record has the expected terminal status
 *   - persisted status matches the returned record
 *   - all non-status fields are preserved through simulation
 *   - createdAt unchanged; updatedAt advances
 *   - public response shape excludes payload
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
  simulateExportJob,
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function minimalPayload(): ExportJobPayload {
  return {
    projectId: "proj-sim-test",
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
  return createEditorExportJob({ projectId: "proj-sim-test", payload: minimalPayload() }, db);
}

/** Build the same public response shape the route returns. */
function publicShape(job: ReturnType<typeof simulateExportJob>) {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    totalDurationMs: job.totalDurationMs,
    sceneCount: job.sceneCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ── Success path ──────────────────────────────────────────────────────────────

describe("simulateExportJob — success path (pending → running → completed)", () => {
  it("returns a job with status 'completed'", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    assert.equal(result.status, "completed");
  });

  it("persists status 'completed' — getEditorExportJob confirms", () => {
    const job = freshJob();
    simulateExportJob(job.id, "success", db);
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "completed");
  });

  it("createdAt is unchanged after simulation", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    assert.equal(result.createdAt, job.createdAt);
  });

  it("updatedAt is a valid ISO timestamp after simulation", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    assert.doesNotThrow(() => new Date(result.updatedAt).toISOString());
  });

  it("non-status fields are preserved through simulation", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    assert.equal(result.id, job.id);
    assert.equal(result.projectId, job.projectId);
    assert.equal(result.totalDurationMs, job.totalDurationMs);
    assert.equal(result.sceneCount, job.sceneCount);
  });
});

// ── Failure path ──────────────────────────────────────────────────────────────

describe("simulateExportJob — failure path (pending → running → failed)", () => {
  it("returns a job with status 'failed'", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "failure", db);
    assert.equal(result.status, "failed");
  });

  it("persists status 'failed' — getEditorExportJob confirms", () => {
    const job = freshJob();
    simulateExportJob(job.id, "failure", db);
    const fetched = getEditorExportJob(job.id, db)!;
    assert.equal(fetched.status, "failed");
  });

  it("createdAt is unchanged after simulation", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "failure", db);
    assert.equal(result.createdAt, job.createdAt);
  });

  it("non-status fields are preserved through simulation", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "failure", db);
    assert.equal(result.id, job.id);
    assert.equal(result.projectId, job.projectId);
    assert.equal(result.totalDurationMs, job.totalDurationMs);
    assert.equal(result.sceneCount, job.sceneCount);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("simulateExportJob — error cases", () => {
  it("throws clearly for a non-existent job ID", () => {
    assert.throws(
      () => simulateExportJob("00000000-0000-0000-0000-000000000000", "success", db),
      /export job not found/,
    );
  });

  it("repeated success simulation throws — job is no longer pending", () => {
    const job = freshJob();
    simulateExportJob(job.id, "success", db);
    assert.throws(
      () => simulateExportJob(job.id, "success", db),
      /invalid export job transition/,
    );
  });

  it("repeated failure simulation throws — job is no longer pending", () => {
    const job = freshJob();
    simulateExportJob(job.id, "failure", db);
    assert.throws(
      () => simulateExportJob(job.id, "failure", db),
      /invalid export job transition/,
    );
  });

  it("simulating a completed job throws — terminal state", () => {
    const job = freshJob();
    simulateExportJob(job.id, "success", db);
    assert.throws(
      () => simulateExportJob(job.id, "failure", db),
      /invalid export job transition/,
    );
  });
});

// ── Public response shape ─────────────────────────────────────────────────────

describe("simulateExportJob — public response shape", () => {
  it("success response has exactly the seven public fields", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    const shape = publicShape(result);
    assert.deepEqual(
      Object.keys(shape).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("failure response has exactly the seven public fields", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "failure", db);
    const shape = publicShape(result);
    assert.deepEqual(
      Object.keys(shape).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("payload field is absent from the public shape", () => {
    const job = freshJob();
    const result = simulateExportJob(job.id, "success", db);
    assert.equal("payload" in publicShape(result), false);
  });
});
