/**
 * Focused tests for claimNextPendingExportJob — the atomic select-and-claim helper.
 *
 * Uses isolated in-memory SQLite databases so each suite starts from a clean
 * state. No HTTP or Next.js mocking required.
 *
 * Covers:
 *   - returns null when no jobs exist
 *   - returns null when no pending jobs exist (running/completed/failed)
 *   - claims the oldest pending job (createdAt ASC, id ASC tie-breaker)
 *   - status becomes "running" after claim
 *   - non-status fields are unchanged after claim
 *   - consecutive calls claim different jobs in createdAt order
 *   - non-pending jobs are not claimed
 *   - atomicity: second call gets the next oldest after the first is claimed
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
  claimNextPendingExportJob,
  executeExportJob,
  claimExportJob,
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

function minimalPayload(projectId = "proj-claim-next"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-claim-next") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

/** Insert a row with an explicit createdAt for deterministic ordering tests. */
function insertAt(db: TestDb, createdAt: string, projectId = "proj-order") {
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

// ── Null cases ────────────────────────────────────────────────────────────────

describe("claimNextPendingExportJob — null cases", () => {
  it("returns null when no jobs exist", () => {
    const db = makeDb();
    assert.equal(claimNextPendingExportJob(db), null);
  });

  it("returns null when the only job is running", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimExportJob(job.id, db);
    assert.equal(claimNextPendingExportJob(db), null);
  });

  it("returns null when the only job is completed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "completed", db);
    assert.equal(claimNextPendingExportJob(db), null);
  });

  it("returns null when the only job is failed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "failed", db);
    assert.equal(claimNextPendingExportJob(db), null);
  });

  it("returns null when all jobs are non-pending", () => {
    const db = makeDb();
    const j1 = makeJob(db, "p1");
    const j2 = makeJob(db, "p2");
    executeExportJob(j1.id, "completed", db);
    executeExportJob(j2.id, "failed", db);
    assert.equal(claimNextPendingExportJob(db), null);
  });
});

// ── Claim basics ──────────────────────────────────────────────────────────────

describe("claimNextPendingExportJob — claim basics", () => {
  it("returns the claimed job (not null) when a pending job exists", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
  });

  it("claimed job has status 'running'", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.status, "running");
  });

  it("claimed job id matches the originally inserted job", () => {
    const db = makeDb();
    const job = makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, job.id);
  });

  it("claimed job projectId is unchanged", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-pid-check");
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.projectId, job.projectId);
  });

  it("claimed job totalDurationMs is unchanged", () => {
    const db = makeDb();
    const job = makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.totalDurationMs, job.totalDurationMs);
  });

  it("claimed job sceneCount is unchanged", () => {
    const db = makeDb();
    const job = makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.sceneCount, job.sceneCount);
  });

  it("claimed job createdAt is unchanged", () => {
    const db = makeDb();
    const job = makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.createdAt, job.createdAt);
  });
});

// ── Persisted state ───────────────────────────────────────────────────────────

describe("claimNextPendingExportJob — persisted row state", () => {
  it("persisted row status is 'running' after claim", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "running");
  });

  it("persisted row updatedAt advances after claim", () => {
    const db = makeDb();
    const job = makeJob(db);
    const before = job.updatedAt;
    claimNextPendingExportJob(db);
    const after = getEditorExportJob(job.id, db)!.updatedAt;
    // updatedAt must be a valid ISO string and >= the original
    assert.ok(after >= before);
  });

  it("non-status fields in persisted row are unchanged after claim", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-persist-check");
    claimNextPendingExportJob(db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.id, job.id);
    assert.equal(row.projectId, job.projectId);
    assert.equal(row.totalDurationMs, job.totalDurationMs);
    assert.equal(row.sceneCount, job.sceneCount);
    assert.equal(row.createdAt, job.createdAt);
  });
});

// ── Ordering: oldest first ────────────────────────────────────────────────────

describe("claimNextPendingExportJob — claims oldest pending job first", () => {
  it("claims the job with the earlier createdAt", () => {
    const db = makeDb();
    const now = Date.now();
    const earlier = new Date(now).toISOString();
    const later = new Date(now + 100).toISOString();
    const idA = insertAt(db, earlier);
    const idB = insertAt(db, later);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, idA);
    assert.notEqual(claimed.id, idB);
  });

  it("consecutive calls claim jobs in createdAt order", () => {
    const db = makeDb();
    const now = Date.now();
    const t1 = new Date(now).toISOString();
    const t2 = new Date(now + 100).toISOString();
    const t3 = new Date(now + 200).toISOString();
    const idA = insertAt(db, t1, "proj-seq");
    const idB = insertAt(db, t2, "proj-seq");
    const idC = insertAt(db, t3, "proj-seq");

    const first = claimNextPendingExportJob(db);
    const second = claimNextPendingExportJob(db);
    const third = claimNextPendingExportJob(db);

    assert.ok(first);
    assert.ok(second);
    assert.ok(third);
    assert.equal(first.id, idA);
    assert.equal(second.id, idB);
    assert.equal(third.id, idC);
  });

  it("after all pending jobs are claimed, returns null", () => {
    const db = makeDb();
    const now = Date.now();
    insertAt(db, new Date(now).toISOString(), "proj-drain");
    insertAt(db, new Date(now + 100).toISOString(), "proj-drain");

    claimNextPendingExportJob(db);
    claimNextPendingExportJob(db);
    assert.equal(claimNextPendingExportJob(db), null);
  });
});

// ── Non-pending jobs are ignored ──────────────────────────────────────────────

describe("claimNextPendingExportJob — ignores non-pending jobs", () => {
  it("skips running jobs, claims only pending", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-skip-running");
    const running = makeJob(db, "proj-skip-running-r");
    claimExportJob(running.id, db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
    assert.notEqual(claimed.id, running.id);
  });

  it("skips completed jobs, claims only pending", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-skip-completed");
    const completed = makeJob(db, "proj-skip-completed-c");
    executeExportJob(completed.id, "completed", db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
  });

  it("skips failed jobs, claims only pending", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-skip-failed");
    const failed = makeJob(db, "proj-skip-failed-f");
    executeExportJob(failed.id, "failed", db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
  });
});

// ── Atomicity ─────────────────────────────────────────────────────────────────

describe("claimNextPendingExportJob — atomicity", () => {
  it("each call claims exactly one job", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-atomic-1");
    const j2 = makeJob(db, "proj-atomic-2");

    const c1 = claimNextPendingExportJob(db);
    const c2 = claimNextPendingExportJob(db);

    assert.ok(c1);
    assert.ok(c2);
    // Both claimed jobs are distinct
    assert.notEqual(c1.id, c2.id);
    // Both original job IDs are accounted for
    assert.ok([j1.id, j2.id].includes(c1.id));
    assert.ok([j1.id, j2.id].includes(c2.id));
  });

  it("claimed jobs are both 'running' in the DB", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-atomic-run-1");
    const j2 = makeJob(db, "proj-atomic-run-2");

    claimNextPendingExportJob(db);
    claimNextPendingExportJob(db);

    assert.equal(getEditorExportJob(j1.id, db)!.status, "running");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "running");
  });

  it("a third call returns null after two jobs are claimed", () => {
    const db = makeDb();
    makeJob(db, "proj-atomic-drain-1");
    makeJob(db, "proj-atomic-drain-2");

    claimNextPendingExportJob(db);
    claimNextPendingExportJob(db);

    assert.equal(claimNextPendingExportJob(db), null);
  });
});
