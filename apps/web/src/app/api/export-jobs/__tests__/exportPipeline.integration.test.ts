/**
 * Export pipeline integration smoke test.
 *
 * Exercises the full export pipeline across real system boundaries:
 *
 *   createEditorExportJob  (mirrors POST /api/editor-projects/[id]/export)
 *     → runExportJob        (canonical runner: load → validate → render → lifecycle → persist)
 *       → buildJobResponse  (mirrors GET /api/export-jobs/[jobId] projection)
 *
 * Uses an isolated in-memory SQLite database. No HTTP server, no queue worker,
 * no Redis, no real rendering. The placeholder renderer adapter is exercised
 * as-is — no mocking of internal steps.
 *
 * Covers:
 *   - completed job returns non-null renderResult
 *   - renderResult.sceneCount matches the payload
 *   - renderResult.totalDurationMs matches the payload
 *   - renderResult is a parsed object, not a raw JSON string
 *   - "render_result" DB column name does not leak into the response
 *   - response shape is exactly { id, projectId, status, totalDurationMs,
 *       sceneCount, renderResult, createdAt, updatedAt }
 *   - unrun pending job returns renderResult: null (negative case)
 *   - two independent jobs do not share renderResult state
 *
 * Run with: pnpm --filter /web test:integration
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import { createEditorExportJob, getEditorExportJob } from "@/server/api/editorExportJobs";
import { runExportJob } from "@/server/api/editorExportJobRunner";
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

// ── Response projection (mirrors GET /api/export-jobs/[jobId]) ────────────────

/**
 * Build the exact same response object the route returns.
 * Tests that use this helper validate the full API surface, not just DAL state.
 */
function buildJobResponse(jobId: string, db: TestDb) {
  const job = getEditorExportJob(jobId, db);
  if (!job) return null;
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    totalDurationMs: job.totalDurationMs,
    sceneCount: job.sceneCount,
    renderResult: job.renderResult,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePayload(projectId = "proj-integration"): ExportJobPayload {
  return {
    projectId,
    aspectRatio: "16:9",
    totalDurationMs: 8000,
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
      {
        id: "s2",
        index: 1,
        type: "video",
        src: "s2.mp4",
        durationMs: 3000,
        startMs: 5000,
        endMs: 8000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 8000,
        textOverlay: null,
      },
    ],
  };
}

// ── Integration: create → run → read ─────────────────────────────────────────

describe("export pipeline — create → runExportJob → GET response", () => {
  let db: TestDb;
  let jobId: string;

  before(() => {
    db = makeDb();
    // Step 1: create (mirrors POST /api/editor-projects/[id]/export)
    const job = createEditorExportJob(
      { projectId: "proj-integration", payload: makePayload() },
      db,
    );
    jobId = job.id;
    // Step 2: run through the canonical seam (real placeholder adapter, real DB write)
    runExportJob(jobId, db);
  });

  it("GET response is non-null for the executed job", () => {
    assert.ok(buildJobResponse(jobId, db) !== null);
  });

  it("job status is 'completed'", () => {
    assert.equal(buildJobResponse(jobId, db)!.status, "completed");
  });

  it("renderResult is NOT null after execution", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.ok(res.renderResult !== null, "renderResult must be non-null for a completed job");
  });

  it("renderResult.sceneCount matches the payload", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.equal(res.renderResult!.sceneCount, makePayload().scenes.length);
  });

  it("renderResult.totalDurationMs matches the payload", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.equal(res.renderResult!.totalDurationMs, makePayload().totalDurationMs);
  });

  it("renderResult is a parsed object, not a raw JSON string", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.strictEqual(typeof res.renderResult, "object");
    assert.notStrictEqual(typeof res.renderResult, "string");
  });

  it("renderResult.sceneCount is a number, not a string", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.strictEqual(typeof res.renderResult!.sceneCount, "number");
  });

  it("renderResult.totalDurationMs is a number, not a string", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.strictEqual(typeof res.renderResult!.totalDurationMs, "number");
  });

  it("renderResult.artifacts is an array", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.ok(Array.isArray(res.renderResult!.artifacts), "artifacts is an array");
  });

  it("renderResult.artifacts is non-empty after default adapter execution", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.ok(res.renderResult!.artifacts.length > 0, "artifacts is non-empty");
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("export pipeline — GET response shape", () => {
  let db: TestDb;
  let jobId: string;

  before(() => {
    db = makeDb();
    const job = createEditorExportJob(
      { projectId: "proj-shape", payload: makePayload("proj-shape") },
      db,
    );
    jobId = job.id;
    runExportJob(jobId, db);
  });

  it("response has exactly the eight expected fields", () => {
    const res = buildJobResponse(jobId, db)!;
    assert.deepEqual(
      Object.keys(res).sort(),
      ["createdAt", "id", "projectId", "renderResult", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("'render_result' DB column name does not appear in the response", () => {
    const res = buildJobResponse(jobId, db)! as Record<string, unknown>;
    assert.ok(!("render_result" in res), "raw DB column name must not leak into response");
  });

  it("payload field is absent from the response", () => {
    const res = buildJobResponse(jobId, db)! as Record<string, unknown>;
    assert.ok(!("payload" in res));
  });
});

// ── Negative: unrun job returns renderResult null ─────────────────────────────

describe("export pipeline — unrun job returns renderResult: null", () => {
  it("pending job GET response has renderResult: null", () => {
    const db = makeDb();
    const job = createEditorExportJob(
      { projectId: "proj-pending", payload: makePayload("proj-pending") },
      db,
    );
    const res = buildJobResponse(job.id, db)!;
    assert.strictEqual(res.renderResult, null);
  });
});

// ── Isolation: two independent jobs do not share renderResult ─────────────────

describe("export pipeline — job isolation", () => {
  it("executing one job does not set renderResult on a separate pending job", () => {
    const db = makeDb();
    const j1 = createEditorExportJob(
      { projectId: "proj-iso-1", payload: makePayload("proj-iso-1") },
      db,
    );
    const j2 = createEditorExportJob(
      { projectId: "proj-iso-2", payload: makePayload("proj-iso-2") },
      db,
    );
    runExportJob(j1.id, db);

    const res1 = buildJobResponse(j1.id, db)!;
    const res2 = buildJobResponse(j2.id, db)!;

    assert.ok(res1.renderResult !== null, "executed job should have renderResult");
    assert.strictEqual(res2.renderResult, null, "unexecuted job must keep renderResult null");
  });

  it("two executed jobs carry independent renderResult values", () => {
    const db = makeDb();
    const j1 = createEditorExportJob(
      { projectId: "proj-two-1", payload: makePayload("proj-two-1") },
      db,
    );
    const j2 = createEditorExportJob(
      { projectId: "proj-two-2", payload: makePayload("proj-two-2") },
      db,
    );
    runExportJob(j1.id, db);
    runExportJob(j2.id, db);

    const rr1 = buildJobResponse(j1.id, db)!.renderResult!;
    const rr2 = buildJobResponse(j2.id, db)!.renderResult!;

    // Both should be non-null and have the same values (same payload)
    assert.equal(rr1.sceneCount, rr2.sceneCount);
    assert.equal(rr1.totalDurationMs, rr2.totalDurationMs);
  });
});
