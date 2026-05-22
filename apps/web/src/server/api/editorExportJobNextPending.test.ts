/**
 * Focused tests for the getNextPendingExportJob selection helper.
 *
 * Uses an in-memory SQLite database. Tests verify correct filtering,
 * stable ordering, non-mutation, and null behaviour on empty/exhausted queues.
 *
 * Covers:
 *   - returns null when no jobs exist
 *   - returns null when no pending jobs exist (all running/completed/failed)
 *   - returns the single pending job when one exists
 *   - returns the oldest pending job (createdAt ASC) when multiple are present
 *   - ignores running, completed, and failed jobs
 *   - selection does not change the row's status or updatedAt
 *   - after a job is claimed the next pending job shifts to the following one
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it, before } from "node:test";
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
let db: TestDb;

before(() => {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIGRATION_SQL);
  db = drizzle(sqlite, { schema });
});

// ── Fixture ───────────────────────────────────────────────────────────────────

function minimalPayload(projectId = "proj-next-test"): ExportJobPayload {
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

function makeJob(projectId = "proj-next-test") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

// ── Null cases ────────────────────────────────────────────────────────────────

describe("getNextPendingExportJob — null cases", () => {
  // Use a fresh isolated DB for these tests to avoid interference from other suites.
  let isolatedDb: TestDb;

  before(() => {
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION_SQL);
    isolatedDb = drizzle(sqlite, { schema });
  });

  it("returns null when no jobs exist", () => {
    assert.equal(getNextPendingExportJob(isolatedDb), null);
  });

  it("returns null when the only job is running", () => {
    const job = createEditorExportJob({ projectId: "p", payload: minimalPayload("p") }, isolatedDb);
    claimExportJob(job.id, isolatedDb);
    assert.equal(getNextPendingExportJob(isolatedDb), null);
  });

  it("returns null when the only job is completed", () => {
    const job = createEditorExportJob({ projectId: "p2", payload: minimalPayload("p2") }, isolatedDb);
    executeExportJob(job.id, "completed", isolatedDb);
    assert.equal(getNextPendingExportJob(isolatedDb), null);
  });

  it("returns null when the only job is failed", () => {
    const job = createEditorExportJob({ projectId: "p3", payload: minimalPayload("p3") }, isolatedDb);
    executeExportJob(job.id, "failed", isolatedDb);
    assert.equal(getNextPendingExportJob(isolatedDb), null);
  });
});

// ── Selection correctness ─────────────────────────────────────────────────────

describe("getNextPendingExportJob — selection correctness", () => {
  it("returns the pending job when exactly one exists", () => {
    const job = makeJob();
    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.id, job.id);
    assert.equal(next.status, "pending");
  });

  it("returns only the pending job when others are non-pending", () => {
    const pending = makeJob();
    const running = makeJob();
    claimExportJob(running.id, db);

    const next = getNextPendingExportJob(db);
    assert.ok(next);
    assert.equal(next.status, "pending");
    // Must not return the running job
    assert.notEqual(next.id, running.id);
    // Should be our pending job (or an earlier one from the shared DB)
    const fetched = getEditorExportJob(next.id, db)!;
    assert.equal(fetched.status, "pending");
    // Suppress unused variable warning
    void pending;
  });

  it("ignores running jobs", () => {
    const job = makeJob();
    claimExportJob(job.id, db);
    // Any result from the shared DB must not be the running job
    const next = getNextPendingExportJob(db);
    if (next !== null) {
      assert.notEqual(next.id, job.id);
      assert.equal(next.status, "pending");
    }
  });

  it("ignores completed jobs", () => {
    const job = makeJob();
    executeExportJob(job.id, "completed", db);
    const next = getNextPendingExportJob(db);
    if (next !== null) {
      assert.notEqual(next.id, job.id);
    }
  });

  it("ignores failed jobs", () => {
    const job = makeJob();
    executeExportJob(job.id, "failed", db);
    const next = getNextPendingExportJob(db);
    if (next !== null) {
      assert.notEqual(next.id, job.id);
    }
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("getNextPendingExportJob — ordering (oldest first)", () => {
  // Use a fresh isolated DB so insertion order is predictable.
  let orderedDb: TestDb;
  let firstId: string;
  let secondId: string;

  before(() => {
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION_SQL);
    orderedDb = drizzle(sqlite, { schema });

    // Insert with distinct timestamps to guarantee ordering.
    const p1 = minimalPayload("proj-order-a");
    const p2 = minimalPayload("proj-order-b");

    const now = Date.now();
    const earlier = new Date(now).toISOString();
    const later = new Date(now + 100).toISOString();

    // Manually insert rows with explicit createdAt to control order.
    const idA = randomUUID();
    const idB = randomUUID();

    orderedDb.insert(schema.editorExportJobs).values({
      id: idA,
      projectId: "proj-order-a",
      status: "pending",
      payload: JSON.stringify(p1),
      totalDurationMs: p1.totalDurationMs,
      sceneCount: p1.scenes.length,
      createdAt: earlier,
      updatedAt: earlier,
    }).run();

    orderedDb.insert(schema.editorExportJobs).values({
      id: idB,
      projectId: "proj-order-b",
      status: "pending",
      payload: JSON.stringify(p2),
      totalDurationMs: p2.totalDurationMs,
      sceneCount: p2.scenes.length,
      createdAt: later,
      updatedAt: later,
    }).run();

    firstId = idA;
    secondId = idB;
  });

  it("returns the job with the earlier createdAt first", () => {
    const next = getNextPendingExportJob(orderedDb);
    assert.ok(next);
    assert.equal(next.id, firstId);
  });

  it("after claiming the first, returns the second", () => {
    claimExportJob(firstId, orderedDb);
    const next = getNextPendingExportJob(orderedDb);
    assert.ok(next);
    assert.equal(next.id, secondId);
  });

  it("after claiming both, returns null", () => {
    claimExportJob(secondId, orderedDb);
    assert.equal(getNextPendingExportJob(orderedDb), null);
  });
});

// ── Non-mutation ──────────────────────────────────────────────────────────────

describe("getNextPendingExportJob — does not mutate the selected row", () => {
  it("status remains 'pending' after selection", () => {
    const job = makeJob();
    getNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "pending");
  });

  it("updatedAt is unchanged after selection", () => {
    const job = makeJob();
    const before = getEditorExportJob(job.id, db)!.updatedAt;
    getNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.updatedAt, before);
  });

  it("calling selection twice returns the same job", () => {
    const job = makeJob();
    // Drain the shared DB to a single pending job by marking all others non-pending.
    // (Use isolated DB to keep this deterministic.)
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION_SQL);
    const isolatedDb = drizzle(sqlite, { schema });
    createEditorExportJob({ projectId: "proj-double", payload: minimalPayload("proj-double") }, isolatedDb);

    const first = getNextPendingExportJob(isolatedDb);
    const second = getNextPendingExportJob(isolatedDb);
    assert.equal(first!.id, second!.id);
    void job;
  });
});
