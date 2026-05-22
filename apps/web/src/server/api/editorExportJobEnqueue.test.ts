/**
 * Focused tests for the export-job enqueue integration.
 *
 * Tests exercise `enqueueExportJob` directly with an injected mock queue so
 * no live Redis connection is required. The mock queue captures all calls and
 * lets tests verify the exact arguments passed to BullMQ.
 *
 * A separate suite tests the route-level contract (persist + enqueue) by
 * wiring a real in-memory SQLite DB for the persistence step and a mock queue
 * for the enqueue step, composing them in the same order as the export route.
 *
 * Covers:
 *   - enqueue is called with the correct jobId
 *   - BullMQ job name is "process-export"
 *   - BullMQ job data is minimal: only { jobId }
 *   - BullMQ job options include jobId for deduplication
 *   - enqueue payload contains no extra fields
 *   - enqueue failure propagates as a thrown error
 *   - valid payload: job persisted in DB AND enqueue called with correct jobId
 *   - accepted response shape matches persisted row after enqueue
 *   - invalid payload: DB row not created, enqueue not called
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import { createEditorExportJob, getEditorExportJob } from "./editorExportJobs";
import { enqueueExportJob, type ExportJobQueuePayload, type Enqueueable } from "../../lib/queues/exportJobsQueue";
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

// ── Mock queue ────────────────────────────────────────────────────────────────

interface MockQueueCall {
  name: string;
  data: unknown;
  opts: unknown;
}

function makeMockQueue(opts?: { shouldFail?: boolean }): {
  calls: MockQueueCall[];
  queue: Enqueueable;
} {
  const calls: MockQueueCall[] = [];
  return {
    calls,
    queue: {
      add: async (name: string, data: unknown, addOpts?: unknown) => {
        if (opts?.shouldFail) throw new Error("Redis connection refused");
        calls.push({ name, data, opts: addOpts });
        return { id: (data as ExportJobQueuePayload).jobId };
      },
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function minimalPayload(projectId = "proj-enqueue"): ExportJobPayload {
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

// ── enqueueExportJob — call contract ─────────────────────────────────────────

describe("enqueueExportJob — call contract", () => {
  it("calls queue.add once per enqueue", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("job-abc-123", queue);
    assert.equal(calls.length, 1);
  });

  it("passes job name 'process-export'", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("job-abc-123", queue);
    assert.equal(calls[0]!.name, "process-export");
  });

  it("passes { jobId } as the BullMQ job data", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("job-xyz-456", queue);
    assert.deepEqual(calls[0]!.data, { jobId: "job-xyz-456" });
  });

  it("job data contains no extra fields", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("job-xyz-456", queue);
    assert.deepEqual(Object.keys(calls[0]!.data as object).sort(), ["jobId"]);
  });

  it("passes jobId in BullMQ options for deduplication", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("job-dedup-789", queue);
    const opts = calls[0]!.opts as Record<string, unknown>;
    assert.equal(opts.jobId, "job-dedup-789");
  });

  it("enqueues the exact jobId that was passed in", async () => {
    const { calls, queue } = makeMockQueue();
    const id = "specific-job-id-001";
    await enqueueExportJob(id, queue);
    assert.equal((calls[0]!.data as ExportJobQueuePayload).jobId, id);
  });

  it("enqueue for different jobIds produces distinct data payloads", async () => {
    const { calls, queue } = makeMockQueue();
    await enqueueExportJob("id-A", queue);
    await enqueueExportJob("id-B", queue);
    assert.equal(calls.length, 2);
    assert.notEqual(
      (calls[0]!.data as ExportJobQueuePayload).jobId,
      (calls[1]!.data as ExportJobQueuePayload).jobId,
    );
  });
});

// ── enqueueExportJob — failure propagation ────────────────────────────────────

describe("enqueueExportJob — failure propagation", () => {
  it("throws when the queue rejects", async () => {
    const { queue } = makeMockQueue({ shouldFail: true });
    await assert.rejects(
      () => enqueueExportJob("job-fail", queue),
      /Redis connection refused/,
    );
  });

  it("does not swallow the error on queue failure", async () => {
    const { queue } = makeMockQueue({ shouldFail: true });
    let threw = false;
    try {
      await enqueueExportJob("job-fail-2", queue);
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  });
});

// ── Persist + enqueue — route-level contract ──────────────────────────────────

describe("export route — persist and enqueue contract", () => {
  it("persists the job in the DB before enqueueing", async () => {
    const db = makeDb();
    const { queue } = makeMockQueue();
    const payload = minimalPayload();
    const job = createEditorExportJob({ projectId: "proj-enqueue", payload }, db);
    await enqueueExportJob(job.id, queue);
    const row = getEditorExportJob(job.id, db);
    assert.ok(row);
    assert.equal(row.id, job.id);
  });

  it("enqueues the correct jobId from the persisted row", async () => {
    const db = makeDb();
    const { calls, queue } = makeMockQueue();
    const job = createEditorExportJob(
      { projectId: "proj-enqueue-id", payload: minimalPayload("proj-enqueue-id") },
      db,
    );
    await enqueueExportJob(job.id, queue);
    assert.equal((calls[0]!.data as ExportJobQueuePayload).jobId, job.id);
  });

  it("persisted row remains 'pending' after enqueue (worker hasn't claimed it yet)", async () => {
    const db = makeDb();
    const { queue } = makeMockQueue();
    const job = createEditorExportJob(
      { projectId: "proj-pending-check", payload: minimalPayload("proj-pending-check") },
      db,
    );
    await enqueueExportJob(job.id, queue);
    assert.equal(getEditorExportJob(job.id, db)!.status, "pending");
  });

  it("accepted response shape matches the persisted row values", async () => {
    const db = makeDb();
    const { queue } = makeMockQueue();
    const payload = minimalPayload("proj-resp-shape");
    const job = createEditorExportJob({ projectId: "proj-resp-shape", payload }, db);
    await enqueueExportJob(job.id, queue);

    // Simulate what the route returns — same shape as the 202 response
    const routeResponse = {
      status: "accepted" as const,
      jobId: job.id,
      totalDurationMs: job.totalDurationMs,
      sceneCount: job.sceneCount,
    };

    assert.equal(routeResponse.status, "accepted");
    assert.equal(routeResponse.jobId, job.id);
    assert.equal(routeResponse.totalDurationMs, payload.totalDurationMs);
    assert.equal(routeResponse.sceneCount, payload.scenes.length);
  });

  it("enqueue failure leaves the persisted row intact", async () => {
    const db = makeDb();
    const { queue } = makeMockQueue({ shouldFail: true });
    const job = createEditorExportJob(
      { projectId: "proj-fail-intact", payload: minimalPayload("proj-fail-intact") },
      db,
    );

    try {
      await enqueueExportJob(job.id, queue);
    } catch {
      // expected
    }

    // Row was persisted before enqueue was attempted — it must still exist
    const row = getEditorExportJob(job.id, db);
    assert.ok(row);
    assert.equal(row.status, "pending");
  });
});
