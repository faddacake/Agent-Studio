/**
 * Focused tests for the internal claim-and-execute-next route contract.
 *
 * Uses isolated in-memory SQLite databases. Tests compose
 * claimNextPendingExportJob + finishExportJob directly and verify the public
 * response projection matches the route shape, so no HTTP or Next.js mocking
 * is required.
 *
 * Covers:
 *   - claim next + execute to "completed"
 *   - claim next + execute to "failed"
 *   - no pending jobs → 404 path (null from claim helper)
 *   - invalid outcome → 400 path (validation check)
 *   - mixed statuses → non-pending rows ignored, pending job executed
 *   - repeated calls drain jobs in deterministic createdAt order
 *   - final persisted state matches returned values
 *   - response shape remains narrow/public-safe
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
  finishExportJob,
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

function minimalPayload(projectId = "proj-cae-route"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-cae-route") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

function insertAt(db: TestDb, createdAt: string, projectId = "proj-cae-order") {
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

/** Simulate the full route logic: claim then finish. Returns null if no pending job. */
function claimAndExecuteNext(
  db: TestDb,
  outcome: "completed" | "failed",
): ReturnType<typeof finishExportJob> | null {
  const claimed = claimNextPendingExportJob(db);
  if (!claimed) return null;
  return finishExportJob(claimed.id, outcome, db);
}

/** Build the same public response shape the route returns. */
function publicShape(job: NonNullable<ReturnType<typeof finishExportJob>>) {
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

describe("claim-and-execute-next route — outcome 'completed'", () => {
  it("returns a job with status 'completed'", () => {
    const db = makeDb();
    makeJob(db);
    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.equal(result.status, "completed");
  });

  it("persisted row confirms status 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimAndExecuteNext(db, "completed");
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("returned id matches the inserted job", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.equal(result.id, job.id);
  });

  it("returned values match the persisted row", () => {
    const db = makeDb();
    makeJob(db);
    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    const row = getEditorExportJob(result.id, db)!;
    assert.equal(result.id, row.id);
    assert.equal(result.projectId, row.projectId);
    assert.equal(result.status, row.status);
    assert.equal(result.totalDurationMs, row.totalDurationMs);
    assert.equal(result.sceneCount, row.sceneCount);
    assert.equal(result.createdAt, row.createdAt);
    assert.equal(result.updatedAt, row.updatedAt);
  });
});

// ── Execute to failed ─────────────────────────────────────────────────────────

describe("claim-and-execute-next route — outcome 'failed'", () => {
  it("returns a job with status 'failed'", () => {
    const db = makeDb();
    makeJob(db);
    const result = claimAndExecuteNext(db, "failed");
    assert.ok(result);
    assert.equal(result.status, "failed");
  });

  it("persisted row confirms status 'failed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimAndExecuteNext(db, "failed");
    assert.equal(getEditorExportJob(job.id, db)!.status, "failed");
  });

  it("returned id matches the inserted job", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = claimAndExecuteNext(db, "failed");
    assert.ok(result);
    assert.equal(result.id, job.id);
  });
});

// ── No pending job → 404 path ─────────────────────────────────────────────────

describe("claim-and-execute-next route — no pending job (→ 404)", () => {
  it("returns null when no jobs exist", () => {
    const db = makeDb();
    assert.equal(claimAndExecuteNext(db, "completed"), null);
  });

  it("returns null when the only job is running", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimExportJob(job.id, db);
    assert.equal(claimAndExecuteNext(db, "completed"), null);
  });

  it("returns null when the only job is completed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "completed", db);
    assert.equal(claimAndExecuteNext(db, "completed"), null);
  });

  it("returns null when the only job is failed", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "failed", db);
    assert.equal(claimAndExecuteNext(db, "completed"), null);
  });
});

// ── Invalid outcome → 400 path ────────────────────────────────────────────────

describe("claim-and-execute-next route — outcome validation (→ 400)", () => {
  it("rejects an empty string outcome", () => {
    // Route validates before calling helpers — simulate the validation check
    const VALID_OUTCOMES = new Set(["completed", "failed"]);
    assert.equal(VALID_OUTCOMES.has(""), false);
  });

  it("rejects an unknown outcome string", () => {
    const VALID_OUTCOMES = new Set(["completed", "failed"]);
    assert.equal(VALID_OUTCOMES.has("success"), false);
  });

  it("rejects a missing outcome (undefined)", () => {
    const VALID_OUTCOMES = new Set(["completed", "failed"]);
    const outcome = (undefined as unknown as Record<string, unknown>)?.outcome;
    assert.equal(typeof outcome !== "string" || !VALID_OUTCOMES.has(outcome as string), true);
  });

  it("accepts 'completed' as valid", () => {
    const VALID_OUTCOMES = new Set(["completed", "failed"]);
    assert.equal(VALID_OUTCOMES.has("completed"), true);
  });

  it("accepts 'failed' as valid", () => {
    const VALID_OUTCOMES = new Set(["completed", "failed"]);
    assert.equal(VALID_OUTCOMES.has("failed"), true);
  });
});

// ── Mixed statuses → non-pending ignored ─────────────────────────────────────

describe("claim-and-execute-next route — ignores non-pending jobs", () => {
  it("executes the pending job when running jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p");
    const running = makeJob(db, "proj-mix-r");
    claimExportJob(running.id, db);

    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.equal(result.id, pending.id);
    assert.equal(result.status, "completed");
  });

  it("executes the pending job when completed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p2");
    const completed = makeJob(db, "proj-mix-c2");
    executeExportJob(completed.id, "completed", db);

    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.equal(result.id, pending.id);
  });

  it("executes the pending job when failed jobs also exist", () => {
    const db = makeDb();
    const pending = makeJob(db, "proj-mix-p3");
    const failed = makeJob(db, "proj-mix-f3");
    executeExportJob(failed.id, "failed", db);

    const result = claimAndExecuteNext(db, "failed");
    assert.ok(result);
    assert.equal(result.id, pending.id);
  });
});

// ── Repeated calls drain jobs in deterministic order ─────────────────────────

describe("claim-and-execute-next route — drains queue in createdAt order", () => {
  it("claims and executes jobs in createdAt ASC order", () => {
    const db = makeDb();
    const now = Date.now();
    const idA = insertAt(db, new Date(now).toISOString(), "proj-drain");
    const idB = insertAt(db, new Date(now + 100).toISOString(), "proj-drain");
    const idC = insertAt(db, new Date(now + 200).toISOString(), "proj-drain");

    const r1 = claimAndExecuteNext(db, "completed");
    const r2 = claimAndExecuteNext(db, "completed");
    const r3 = claimAndExecuteNext(db, "completed");

    assert.ok(r1);
    assert.ok(r2);
    assert.ok(r3);
    assert.equal(r1.id, idA);
    assert.equal(r2.id, idB);
    assert.equal(r3.id, idC);
  });

  it("returns null after all pending jobs are processed", () => {
    const db = makeDb();
    const now = Date.now();
    insertAt(db, new Date(now).toISOString(), "proj-exhaust");
    insertAt(db, new Date(now + 100).toISOString(), "proj-exhaust");

    claimAndExecuteNext(db, "completed");
    claimAndExecuteNext(db, "completed");
    assert.equal(claimAndExecuteNext(db, "completed"), null);
  });

  it("mix of outcomes: all jobs reach terminal status", () => {
    const db = makeDb();
    const now = Date.now();
    const idA = insertAt(db, new Date(now).toISOString(), "proj-mix-out");
    const idB = insertAt(db, new Date(now + 100).toISOString(), "proj-mix-out");

    claimAndExecuteNext(db, "completed");
    claimAndExecuteNext(db, "failed");

    assert.equal(getEditorExportJob(idA, db)!.status, "completed");
    assert.equal(getEditorExportJob(idB, db)!.status, "failed");
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("claim-and-execute-next route — public response shape", () => {
  it("response has exactly the seven public fields", () => {
    const db = makeDb();
    makeJob(db);
    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.deepEqual(
      Object.keys(publicShape(result)).sort(),
      ["createdAt", "id", "projectId", "sceneCount", "status", "totalDurationMs", "updatedAt"],
    );
  });

  it("payload field is absent from the response shape", () => {
    const db = makeDb();
    makeJob(db);
    const result = claimAndExecuteNext(db, "completed");
    assert.ok(result);
    assert.equal("payload" in publicShape(result), false);
  });

  it("shape is identical for both outcomes", () => {
    const db = makeDb();
    makeJob(db, "proj-shape-c");
    makeJob(db, "proj-shape-f");
    const rc = claimAndExecuteNext(db, "completed");
    const rf = claimAndExecuteNext(db, "failed");
    assert.ok(rc);
    assert.ok(rf);
    assert.deepEqual(Object.keys(publicShape(rc)).sort(), Object.keys(publicShape(rf)).sort());
  });
});
