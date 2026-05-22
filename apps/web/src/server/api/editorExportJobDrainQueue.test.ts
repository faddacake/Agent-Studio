/**
 * Focused tests for drainExportQueue — the internal worker-loop skeleton.
 *
 * Uses isolated in-memory SQLite databases so each test starts clean.
 *
 * Covers:
 *   - empty queue → zero work, correct summary shape
 *   - single pending job drains correctly
 *   - multiple pending jobs drain in deterministic createdAt order
 *   - mixed statuses — non-pending jobs ignored, only pending drained
 *   - all drained rows persist terminal status correctly
 *   - summary matches actual persisted state
 *   - repeated calls after exhaustion do no additional work
 *   - outcome "completed" and "failed" both apply correctly
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
  drainExportQueue,
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

function minimalPayload(projectId = "proj-drain"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-drain") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

function insertAt(db: TestDb, createdAt: string, projectId = "proj-drain-order") {
  const id = randomUUID();
  const p = minimalPayload(projectId);
  db.insert(schema.editorExportJobs).values({
    id, projectId, status: "pending",
    payload: JSON.stringify(p),
    totalDurationMs: p.totalDurationMs,
    sceneCount: p.scenes.length,
    createdAt, updatedAt: createdAt,
  }).run();
  return id;
}

// ── Empty queue ───────────────────────────────────────────────────────────────

describe("drainExportQueue — empty queue", () => {
  it("returns processed: 0 when no jobs exist", () => {
    const db = makeDb();
    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 0);
  });

  it("returns empty jobIds array when no jobs exist", () => {
    const db = makeDb();
    const result = drainExportQueue("completed", db);
    assert.deepEqual(result.jobIds, []);
  });

  it("returns the requested outcome in the summary", () => {
    const db = makeDb();
    assert.equal(drainExportQueue("completed", db).outcome, "completed");
    assert.equal(drainExportQueue("failed", db).outcome, "failed");
  });

  it("summary has exactly the three expected fields", () => {
    const db = makeDb();
    const result = drainExportQueue("completed", db);
    assert.deepEqual(Object.keys(result).sort(), ["jobIds", "outcome", "processed"]);
  });
});

// ── Single pending job ────────────────────────────────────────────────────────

describe("drainExportQueue — single pending job", () => {
  it("returns processed: 1", () => {
    const db = makeDb();
    makeJob(db);
    assert.equal(drainExportQueue("completed", db).processed, 1);
  });

  it("jobIds contains the job's id", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = drainExportQueue("completed", db);
    assert.deepEqual(result.jobIds, [job.id]);
  });

  it("persisted row status matches the requested outcome ('completed')", () => {
    const db = makeDb();
    const job = makeJob(db);
    drainExportQueue("completed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("persisted row status matches the requested outcome ('failed')", () => {
    const db = makeDb();
    const job = makeJob(db);
    drainExportQueue("failed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });

  it("second call after drain returns processed: 0", () => {
    const db = makeDb();
    makeJob(db);
    drainExportQueue("completed", db);
    assert.equal(drainExportQueue("completed", db).processed, 0);
  });
});

// ── Multiple pending jobs ─────────────────────────────────────────────────────

describe("drainExportQueue — multiple pending jobs", () => {
  it("returns processed count equal to the number of pending jobs", () => {
    const db = makeDb();
    makeJob(db, "p1");
    makeJob(db, "p2");
    makeJob(db, "p3");
    assert.equal(drainExportQueue("completed", db).processed, 3);
  });

  it("drains jobs in createdAt ASC order", () => {
    const db = makeDb();
    const now = Date.now();
    const idA = insertAt(db, new Date(now).toISOString());
    const idB = insertAt(db, new Date(now + 100).toISOString());
    const idC = insertAt(db, new Date(now + 200).toISOString());

    const result = drainExportQueue("completed", db);
    assert.deepEqual(result.jobIds, [idA, idB, idC]);
  });

  it("all drained jobs persist as 'completed'", () => {
    const db = makeDb();
    const j1 = makeJob(db, "q1");
    const j2 = makeJob(db, "q2");
    drainExportQueue("completed", db);
    assert.equal(getEditorExportJob(j1.id, db)!.status, "completed");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "completed");
  });

  it("all drained jobs persist as 'failed'", () => {
    const db = makeDb();
    const j1 = makeJob(db, "f1");
    const j2 = makeJob(db, "f2");
    drainExportQueue("failed", db);
    assert.equal(getEditorExportJob(j1.id, db)!.status, "failed");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "failed");
  });

  it("jobIds length matches processed count", () => {
    const db = makeDb();
    makeJob(db, "len1");
    makeJob(db, "len2");
    const result = drainExportQueue("completed", db);
    assert.equal(result.jobIds.length, result.processed);
  });

  it("second drain returns processed: 0 and empty jobIds", () => {
    const db = makeDb();
    makeJob(db, "x1");
    makeJob(db, "x2");
    drainExportQueue("completed", db);
    const second = drainExportQueue("completed", db);
    assert.equal(second.processed, 0);
    assert.deepEqual(second.jobIds, []);
  });
});

// ── Mixed statuses ────────────────────────────────────────────────────────────

describe("drainExportQueue — ignores non-pending jobs", () => {
  it("does not count already-running jobs", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p");
    const running = makeJob(db, "mix-r");
    claimExportJob(running.id, db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("does not count already-completed jobs", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p2");
    const completed = makeJob(db, "mix-c2");
    executeExportJob(completed.id, "completed", db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("does not count already-failed jobs", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p3");
    const failed = makeJob(db, "mix-f3");
    executeExportJob(failed.id, "failed", db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("returns processed: 0 when all jobs are non-pending", () => {
    const db = makeDb();
    const j1 = makeJob(db, "all-np-1");
    const j2 = makeJob(db, "all-np-2");
    executeExportJob(j1.id, "completed", db);
    executeExportJob(j2.id, "failed", db);

    assert.equal(drainExportQueue("completed", db).processed, 0);
  });
});

// ── Summary accuracy ──────────────────────────────────────────────────────────

describe("drainExportQueue — summary matches persisted state", () => {
  it("every id in jobIds is persisted at the requested terminal status", () => {
    const db = makeDb();
    makeJob(db, "acc1");
    makeJob(db, "acc2");
    makeJob(db, "acc3");

    const result = drainExportQueue("completed", db);
    for (const id of result.jobIds) {
      assert.equal(getEditorExportJob(id, db)!.status, "completed");
    }
  });

  it("jobIds contains no duplicates", () => {
    const db = makeDb();
    makeJob(db, "dup1");
    makeJob(db, "dup2");

    const result = drainExportQueue("completed", db);
    const unique = new Set(result.jobIds);
    assert.equal(unique.size, result.jobIds.length);
  });

  it("processed count equals number of jobs that were pending before the call", () => {
    const db = makeDb();
    makeJob(db, "cnt1");
    makeJob(db, "cnt2");
    const completed = makeJob(db, "cnt3");
    executeExportJob(completed.id, "completed", db);  // pre-existing terminal job

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 2);
  });
});
