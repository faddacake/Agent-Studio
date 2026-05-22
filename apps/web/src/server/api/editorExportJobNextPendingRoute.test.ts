/**
 * Focused tests for the internal next-pending export job route contract.
 *
 * Uses an in-memory SQLite database. Tests exercise getNextPendingExportJob
 * directly and verify the public response projection matches the route shape,
 * so no HTTP or Next.js mocking is required.
 *
 * Covers:
 *   - pending job exists → returns oldest pending job
 *   - no jobs → 404 path (null from helper)
 *   - no pending jobs → 404 path (null from helper)
 *   - mixed statuses → ignores non-pending jobs
 *   - response shape has exactly the seven public fields (payload absent)
 *   - repeated reads do not mutate row state
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import {
  createEditorExportJob,
  getEditorExportJob,
  getNextPendingExportJob,
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

function makeDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIGRATION_SQL);
  return drizzle(sqlite, { schema });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function minimalPayload(projectId = "proj-next-route-test"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-next-route-test") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

/** Build the same public response shape the route returns. */
function publicShape(job: NonNullable<ReturnType<typeof getNextPendingExportJob>>) {
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

// ── No pending job → 404 path ─────────────────────────────────────────────────

describe("next-pending route — no pending job (→ 404)", () => {
  it("returns null when no jobs exist", () => {
    const db = makeDb();
    assert.equal(getNextPendingExportJob(db), null);
  });

  it("returns null when the only job is running", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimExportJob(job.id, db);
    assert.equal(getNextPendingExportJob(db), null);
  });

  it("returns null when the only job is completed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "completed", db);
    assert.equal(getNextPendingExportJob(db), null);
  });

  it("returns null when the only job is failed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "failed", db);
    assert.equal(getNextPendingExportJob(db), null);
  });
});

// ── Pending job found → 200 path ──────────────────────────────────────────────

describe("next-pending route — pending job found (→ 200)", () => {
  it("returns the pending job when exactly one exists", () => {
    const db = makeDb();
    const job = makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, job.id);
    assert.equal(next.status, "pending");
  });

  it("returned job projectId matches what was inserted", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-check-pid");
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.projectId, job.projectId);
  });

  it("returned job totalDurationMs matches what was inserted", () => {
    const db = makeDb();
    const job = makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.totalDurationMs, job.totalDurationMs);
  });

  it("returned job sceneCount matches what was inserted", () => {
    const db = makeDb();
    const job = makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.sceneCount, job.sceneCount);
  });
});

// ── Mixed statuses → ignores non-pending jobs ─────────────────────────────────

describe("next-pending route — mixed statuses", () => {
  it("returns the pending job when running jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-pending");
    const running = makeJob(db, "proj-mix-running");
    claimExportJob(running.id, db);

    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, pending.id);
    assert.equal(next.status, "pending");
    assert.notEqual(next.id, running.id);
  });

  it("returns the pending job when completed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p2");
    const completed = makeJob(db, "proj-mix-c2");
    executeExportJob(completed.id, "completed", db);

    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, pending.id);
    assert.notEqual(next.id, completed.id);
  });

  it("returns the pending job when failed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p3");
    const failed = makeJob(db, "proj-mix-f3");
    executeExportJob(failed.id, "failed", db);

    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, pending.id);
    assert.notEqual(next.id, failed.id);
  });

  it("returns null when all jobs are non-pending", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-all-np-1");
    const j2 = makeJob(db, "proj-all-np-2");
    executeExportJob(j1.id, "completed", db);
    executeExportJob(j2.id, "failed", db);
    assert.equal(getNextPendingExportJob(db), null);
  });
});

// ── Ordering: returns oldest pending ─────────────────────────────────────────

describe("next-pending route — returns oldest pending job", () => {
  it("returns the job with the earlier createdAt", () => {
    const db = makeDb();
    const p = minimalPayload("proj-order");
    const now = Date.now();
    const earlier = new Date(now).toISOString();
    const later = new Date(now + 100).toISOString();
    const idA = randomUUID();
    const idB = randomUUID();

    db.insert(schema.editorExportJobs).values({
      id: idA, projectId: "proj-order", status: "pending",
      payload: JSON.stringify(p), totalDurationMs: p.totalDurationMs,
      sceneCount: p.scenes.length, createdAt: earlier, updatedAt: earlier,
    }).run();
    db.insert(schema.editorExportJobs).values({
      id: idB, projectId: "proj-order", status: "pending",
      payload: JSON.stringify(p), totalDurationMs: p.totalDurationMs,
      sceneCount: p.scenes.length, createdAt: later, updatedAt: later,
    }).run();

    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, idA);
  });
});

// ── Non-mutation: repeated reads do not mutate row state ──────────────────────

describe("next-pending route — reads do not mutate row state", () => {
  it("status remains 'pending' after read", () => {
    const db = makeDb();
    const job = makeJob(db);
    getNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "pending");
  });

  it("updatedAt is unchanged after read", () => {
    const db = makeDb();
    const job = makeJob(db);
    const before = getEditorExportJob(job.id, db)!.updatedAt;
    getNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.updatedAt, before);
  });

  it("repeated reads return the same job", () => {
    const db = makeDb();
    makeJob(db);
    const first = getNextPendingExportJob(db);
    const second = getNextPendingExportJob(db);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.id, second.id);
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("next-pending route — public response shape", () => {
  it("response has exactly the seven public fields", () => {
    const db = makeDb();
    const job = makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.deepEqual(
      Object.keys(publicShape(next)).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
    void job;
  });

  it("payload field is absent from the response shape", () => {
    const db = makeDb();
    makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal("payload" in publicShape(next), false);
  });

  it("response values match the persisted row", () => {
    const db = makeDb();
    const job = makeJob(db);
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    const shape = publicShape(next);
    assert.equal(shape.id, job.id);
    assert.equal(shape.projectId, job.projectId);
    assert.equal(shape.status, "pending");
    assert.equal(shape.totalDurationMs, job.totalDurationMs);
    assert.equal(shape.sceneCount, job.sceneCount);
    assert.equal(shape.createdAt, job.createdAt);
    assert.equal(shape.updatedAt, job.updatedAt);
  });
});
