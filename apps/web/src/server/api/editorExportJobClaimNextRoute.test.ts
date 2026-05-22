/**
 * Focused tests for the internal claim-next export job route contract.
 *
 * Uses isolated in-memory SQLite databases. Tests exercise
 * claimNextPendingExportJob directly and verify the public response projection
 * matches the route shape, so no HTTP or Next.js mocking is required.
 *
 * Covers:
 *   - pending job exists → oldest pending job is claimed and returned
 *   - claimed job is persisted as "running"
 *   - no pending jobs → 404 path (null from helper)
 *   - mixed statuses → non-pending jobs ignored, pending job claimed
 *   - repeated calls drain jobs in deterministic createdAt order
 *   - response shape remains narrow/public-safe (payload absent)
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

function minimalPayload(projectId = "proj-claim-route"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-claim-route") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

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

/** Build the same public response shape the route returns. */
function publicShape(job: NonNullable<ReturnType<typeof claimNextPendingExportJob>>) {
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

describe("claim-next route — no pending job (→ 404)", () => {
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
});

// ── Pending job claimed → 200 path ────────────────────────────────────────────

describe("claim-next route — pending job claimed (→ 200)", () => {
  it("returns the claimed job (not null)", () => {
    const db = makeDb();
    makeJob(db);
    assert.ok(claimNextPendingExportJob(db));
  });

  it("claimed job has status 'running'", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.status, "running");
  });

  it("claimed job id matches the inserted job", () => {
    const db = makeDb();
    const job = makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, job.id);
  });
});

// ── Claimed job persisted as running ──────────────────────────────────────────

describe("claim-next route — claimed job persisted as running", () => {
  it("persisted row status is 'running' after claim", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimNextPendingExportJob(db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "running");
  });

  it("persisted row updatedAt advances after claim", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimNextPendingExportJob(db);
    const row = getEditorExportJob(job.id, db)!;
    assert.ok(row.updatedAt >= job.updatedAt);
  });

  it("non-status persisted fields are unchanged after claim", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-persist-route");
    claimNextPendingExportJob(db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.id, job.id);
    assert.equal(row.projectId, job.projectId);
    assert.equal(row.totalDurationMs, job.totalDurationMs);
    assert.equal(row.sceneCount, job.sceneCount);
    assert.equal(row.createdAt, job.createdAt);
  });
});

// ── Mixed statuses → non-pending ignored ─────────────────────────────────────

describe("claim-next route — ignores non-pending jobs", () => {
  it("claims the pending job when running jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p");
    const running = makeJob(db, "proj-mix-r");
    claimExportJob(running.id, db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
    assert.notEqual(claimed.id, running.id);
  });

  it("claims the pending job when completed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p2");
    const completed = makeJob(db, "proj-mix-c2");
    executeExportJob(completed.id, "completed", db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
  });

  it("claims the pending job when failed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p3");
    const failed = makeJob(db, "proj-mix-f3");
    executeExportJob(failed.id, "failed", db);

    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal(claimed.id, pending.id);
  });
});

// ── Repeated calls drain jobs in deterministic order ─────────────────────────

describe("claim-next route — repeated calls drain queue in order", () => {
  it("claims jobs in createdAt ASC order", () => {
    const db = makeDb();
    const now = Date.now();
    const idA = insertAt(db, new Date(now).toISOString(), "proj-drain");
    const idB = insertAt(db, new Date(now + 100).toISOString(), "proj-drain");
    const idC = insertAt(db, new Date(now + 200).toISOString(), "proj-drain");

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

  it("returns null after all pending jobs are claimed", () => {
    const db = makeDb();
    const now = Date.now();
    insertAt(db, new Date(now).toISOString(), "proj-exhaust");
    insertAt(db, new Date(now + 100).toISOString(), "proj-exhaust");

    claimNextPendingExportJob(db);
    claimNextPendingExportJob(db);
    assert.equal(claimNextPendingExportJob(db), null);
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("claim-next route — public response shape", () => {
  it("response has exactly the seven public fields", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.deepEqual(
      Object.keys(publicShape(claimed)).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("payload field is absent from the response shape", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    assert.equal("payload" in publicShape(claimed), false);
  });

  it("response values match the persisted row", () => {
    const db = makeDb();
    makeJob(db);
    const claimed = claimNextPendingExportJob(db);
    assert.ok(claimed);
    const row = getEditorExportJob(claimed.id, db)!;
    const shape = publicShape(claimed);
    assert.equal(shape.id, row.id);
    assert.equal(shape.projectId, row.projectId);
    assert.equal(shape.status, row.status);
    assert.equal(shape.totalDurationMs, row.totalDurationMs);
    assert.equal(shape.sceneCount, row.sceneCount);
    assert.equal(shape.createdAt, row.createdAt);
    assert.equal(shape.updatedAt, row.updatedAt);
  });
});
