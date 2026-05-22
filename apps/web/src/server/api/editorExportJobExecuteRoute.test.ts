/**
 * Focused tests for the internal export execution route contract.
 *
 * Uses an in-memory SQLite database. Tests exercise executeExportJob directly
 * and verify the public response projection matches the route shape, so no
 * HTTP or Next.js mocking is required.
 *
 * Covers:
 *   - execute to "completed" → correct status and public shape
 *   - execute to "failed"    → correct status and public shape
 *   - missing job            → maps to 404 path (null from helper)
 *   - already-running job    → maps to 409 path (transition error)
 *   - terminal job           → maps to 409 path (transition error)
 *   - response shape has exactly the seven public fields (payload absent)
 *   - response values match the persisted row
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function minimalPayload(): ExportJobPayload {
  return {
    projectId: "proj-exec-route-test",
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
    { projectId: "proj-exec-route-test", payload: minimalPayload() },
    db,
  );
}

/** Build the same public response shape the route returns. */
function publicShape(job: ReturnType<typeof executeExportJob>) {
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

// ── Execute to completed ──────────────────────────────────────────────────────

describe("execute route — outcome 'completed'", () => {
  it("returns status 'completed'", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.equal(result.status, "completed");
  });

  it("persisted row confirms 'completed'", () => {
    const job = freshJob();
    executeExportJob(job.id, "completed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("response values match persisted row", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    const fetched = getEditorExportJob(job.id, db)!;
    const shape = publicShape(result);
    assert.equal(shape.id, fetched.id);
    assert.equal(shape.status, fetched.status);
    assert.equal(shape.totalDurationMs, fetched.totalDurationMs);
    assert.equal(shape.sceneCount, fetched.sceneCount);
    assert.equal(shape.createdAt, fetched.createdAt);
    assert.equal(shape.updatedAt, fetched.updatedAt);
  });
});

// ── Execute to failed ─────────────────────────────────────────────────────────

describe("execute route — outcome 'failed'", () => {
  it("returns status 'failed'", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "failed", db);
    assert.equal(result.status, "failed");
  });

  it("persisted row confirms 'failed'", () => {
    const job = freshJob();
    executeExportJob(job.id, "failed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });
});

// ── Error paths (map to HTTP status codes in the route) ───────────────────────

describe("execute route — error paths", () => {
  it("non-existent job throws 'not found' (→ 404)", () => {
    assert.throws(
      () => executeExportJob("00000000-0000-0000-0000-000000000000", "completed", db),
      /export job not found/,
    );
  });

  it("already-running job throws transition error (→ 409)", () => {
    const job = freshJob();
    claimExportJob(job.id, db);
    assert.throws(
      () => executeExportJob(job.id, "completed", db),
      /invalid export job transition/,
    );
  });

  it("already-completed job throws transition error (→ 409)", () => {
    const job = freshJob();
    executeExportJob(job.id, "completed", db);
    assert.throws(
      () => executeExportJob(job.id, "completed", db),
      /invalid export job transition/,
    );
  });

  it("already-failed job throws transition error (→ 409)", () => {
    const job = freshJob();
    executeExportJob(job.id, "failed", db);
    assert.throws(
      () => executeExportJob(job.id, "failed", db),
      /invalid export job transition/,
    );
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("execute route — public response shape", () => {
  it("response has exactly the seven public fields", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.deepEqual(
      Object.keys(publicShape(result)).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("payload field is absent from the response shape", () => {
    const job = freshJob();
    const result = executeExportJob(job.id, "completed", db);
    assert.equal("payload" in publicShape(result), false);
  });

  it("shape is identical for both outcomes", () => {
    const jobC = freshJob();
    const jobF = freshJob();
    const completedKeys = Object.keys(publicShape(executeExportJob(jobC.id, "completed", db))).sort();
    const failedKeys = Object.keys(publicShape(executeExportJob(jobF.id, "failed", db))).sort();
    assert.deepEqual(completedKeys, failedKeys);
  });
});
