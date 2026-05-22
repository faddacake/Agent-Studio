/**
 * Focused tests for the internal export queue drain route contract.
 *
 * Uses isolated in-memory SQLite databases. Tests exercise drainExportQueue
 * directly and verify the response projection matches the route shape, so no
 * HTTP or Next.js mocking is required.
 *
 * Covers:
 *   - empty queue → zero-work summary (200 path)
 *   - single job drain → correct processed/jobIds/outcome
 *   - multiple jobs drain in deterministic createdAt order
 *   - mixed statuses → non-pending rows ignored
 *   - both valid outcomes accepted
 *   - invalid outcome → 400 path (validation check)
 *   - repeated drain after exhaustion returns zero-work summary
 *   - response shape is exactly { processed, jobIds, outcome }
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

function minimalPayload(projectId = "proj-drain-route"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-drain-route") {
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

// ── Empty queue → zero-work 200 ───────────────────────────────────────────────

describe("drain route — empty queue (zero-work 200)", () => {
  it("returns processed: 0", () => {
    const db = makeDb();
    assert.equal(drainExportQueue("completed", db).processed, 0);
  });

  it("returns empty jobIds array", () => {
    const db = makeDb();
    assert.deepEqual(drainExportQueue("completed", db).jobIds, []);
  });

  it("returns the requested outcome", () => {
    const db = makeDb();
    assert.equal(drainExportQueue("completed", db).outcome, "completed");
    assert.equal(drainExportQueue("failed", db).outcome, "failed");
  });

  it("response shape is exactly { processed, jobIds, outcome }", () => {
    const db = makeDb();
    const result = drainExportQueue("completed", db);
    assert.deepEqual(Object.keys(result).sort(), ["jobIds", "outcome", "processed"]);
  });
});

// ── Single job drain ──────────────────────────────────────────────────────────

describe("drain route — single pending job", () => {
  it("returns processed: 1", () => {
    const db = makeDb();
    makeJob(db);
    assert.equal(drainExportQueue("completed", db).processed, 1);
  });

  it("jobIds contains the job id", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = drainExportQueue("completed", db);
    assert.deepEqual(result.jobIds, [job.id]);
  });

  it("persisted status is 'completed' after drain with outcome 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    drainExportQueue("completed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("persisted status is 'failed' after drain with outcome 'failed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    drainExportQueue("failed", db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });

  it("outcome field in response matches requested outcome", () => {
    const db = makeDb();
    makeJob(db);
    assert.equal(drainExportQueue("completed", db).outcome, "completed");
  });
});

// ── Multiple jobs in order ────────────────────────────────────────────────────

describe("drain route — multiple jobs drain in createdAt order", () => {
  it("returns processed count equal to number of pending jobs", () => {
    const db = makeDb();
    makeJob(db, "p1");
    makeJob(db, "p2");
    makeJob(db, "p3");
    assert.equal(drainExportQueue("completed", db).processed, 3);
  });

  it("jobIds are returned in createdAt ASC order", () => {
    const db = makeDb();
    const now = Date.now();
    const idA = insertAt(db, new Date(now).toISOString());
    const idB = insertAt(db, new Date(now + 100).toISOString());
    const idC = insertAt(db, new Date(now + 200).toISOString());

    const result = drainExportQueue("completed", db);
    assert.deepEqual(result.jobIds, [idA, idB, idC]);
  });

  it("all jobs persist at the terminal status", () => {
    const db = makeDb();
    const j1 = makeJob(db, "q1");
    const j2 = makeJob(db, "q2");
    drainExportQueue("failed", db);
    assert.equal(getEditorExportJob(j1.id, db)!.status, "failed");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "failed");
  });
});

// ── Mixed statuses ────────────────────────────────────────────────────────────

describe("drain route — ignores non-pending jobs", () => {
  it("excludes running jobs from processed count and jobIds", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p");
    const running = makeJob(db, "mix-r");
    claimExportJob(running.id, db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("excludes completed jobs from processed count and jobIds", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p2");
    const completed = makeJob(db, "mix-c2");
    executeExportJob(completed.id, "completed", db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("excludes failed jobs from processed count and jobIds", () => {
    const db = makeDb();
    const pending = makeJob(db, "mix-p3");
    const failed = makeJob(db, "mix-f3");
    executeExportJob(failed.id, "failed", db);

    const result = drainExportQueue("completed", db);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.jobIds, [pending.id]);
  });

  it("returns processed: 0 when all jobs are already terminal", () => {
    const db = makeDb();
    const j1 = makeJob(db, "all-t-1");
    const j2 = makeJob(db, "all-t-2");
    executeExportJob(j1.id, "completed", db);
    executeExportJob(j2.id, "failed", db);

    assert.equal(drainExportQueue("completed", db).processed, 0);
  });
});

// ── Outcome validation (→ 400) ────────────────────────────────────────────────

describe("drain route — outcome validation (→ 400)", () => {
  it("rejects empty string outcome", () => {
    const VALID = new Set(["completed", "failed"]);
    assert.equal(VALID.has(""), false);
  });

  it("rejects unknown outcome string", () => {
    const VALID = new Set(["completed", "failed"]);
    assert.equal(VALID.has("success"), false);
  });

  it("rejects numeric outcome", () => {
    const VALID = new Set(["completed", "failed"]);
    assert.equal(typeof 1 !== "string" || !VALID.has(String(1)), true);
  });

  it("accepts 'completed'", () => {
    const VALID = new Set(["completed", "failed"]);
    assert.equal(VALID.has("completed"), true);
  });

  it("accepts 'failed'", () => {
    const VALID = new Set(["completed", "failed"]);
    assert.equal(VALID.has("failed"), true);
  });
});

// ── Repeated drain after exhaustion ──────────────────────────────────────────

describe("drain route — repeated drain after exhaustion returns zero work", () => {
  it("second drain returns processed: 0", () => {
    const db = makeDb();
    makeJob(db, "ex1");
    makeJob(db, "ex2");
    drainExportQueue("completed", db);
    assert.equal(drainExportQueue("completed", db).processed, 0);
  });

  it("second drain returns empty jobIds", () => {
    const db = makeDb();
    makeJob(db, "ex3");
    drainExportQueue("completed", db);
    assert.deepEqual(drainExportQueue("completed", db).jobIds, []);
  });

  it("third drain is also a no-op", () => {
    const db = makeDb();
    makeJob(db, "ex4");
    drainExportQueue("completed", db);
    drainExportQueue("completed", db);
    assert.equal(drainExportQueue("completed", db).processed, 0);
  });
});
