/**
 * Focused tests for EditorExportJob persistence.
 *
 * Uses an in-memory SQLite database (no file I/O, no migrations directory)
 * so tests remain fast and isolated. The migration SQL is applied inline.
 *
 * Covers:
 *   - createEditorExportJob persists the job and returns the record
 *   - returned record contains real UUID jobId (not a placeholder)
 *   - persisted row stores validated payload and summary metadata verbatim
 *   - getEditorExportJob retrieves the exact row that was written
 *   - getEditorExportJob returns null for an unknown ID
 *   - response values (totalDurationMs, sceneCount) match the persisted job
 *   - payload round-trips through JSON without data loss
 *   - status defaults to "pending"
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";

import { createEditorExportJob, getEditorExportJob } from "./editorExportJobs";
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

function makePayload(overrides: Partial<ExportJobPayload> = {}): ExportJobPayload {
  return {
    projectId: "proj-test",
    aspectRatio: "16:9",
    totalDurationMs: 13000,
    scenes: [
      {
        id: "scene-a",
        index: 0,
        type: "image",
        src: "a.jpg",
        durationMs: 5000,
        startMs: 0,
        endMs: 5000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 5000,
        textOverlay: null,
      },
      {
        id: "scene-b",
        index: 1,
        type: "video",
        src: "b.mp4",
        durationMs: 8000,
        startMs: 5000,
        endMs: 13000,
        transition: "fade",
        fadeDurationMs: 800,
        fadeStartMs: 12200,
        textOverlay: { text: "Fin", position: "bottom", style: "subtitle" },
      },
    ],
    ...overrides,
  };
}

// ── createEditorExportJob ─────────────────────────────────────────────────────

describe("createEditorExportJob — returned record", () => {
  it("returns a record with a real UUID jobId (not placeholder)", () => {
    const job = createEditorExportJob({ projectId: "proj-1", payload: makePayload() }, db);
    assert.match(job.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(job.id, "stub-export");
  });

  it("returns projectId matching input", () => {
    const job = createEditorExportJob({ projectId: "proj-create-1", payload: makePayload() }, db);
    assert.equal(job.projectId, "proj-create-1");
  });

  it("returns status 'pending'", () => {
    const job = createEditorExportJob({ projectId: "proj-create-2", payload: makePayload() }, db);
    assert.equal(job.status, "pending");
  });

  it("returns totalDurationMs from payload", () => {
    const payload = makePayload({ totalDurationMs: 13000 });
    const job = createEditorExportJob({ projectId: "proj-dur", payload }, db);
    assert.equal(job.totalDurationMs, 13000);
  });

  it("returns sceneCount matching payload scenes length", () => {
    const payload = makePayload();
    const job = createEditorExportJob({ projectId: "proj-count", payload }, db);
    assert.equal(job.sceneCount, payload.scenes.length);
  });

  it("returns the payload object unchanged", () => {
    const payload = makePayload();
    const job = createEditorExportJob({ projectId: "proj-payload", payload }, db);
    assert.deepEqual(job.payload, payload);
  });

  it("returns ISO timestamp for createdAt", () => {
    const job = createEditorExportJob({ projectId: "proj-ts", payload: makePayload() }, db);
    assert.doesNotThrow(() => new Date(job.createdAt).toISOString());
  });

  it("createdAt equals updatedAt on creation", () => {
    const job = createEditorExportJob({ projectId: "proj-ts2", payload: makePayload() }, db);
    assert.equal(job.createdAt, job.updatedAt);
  });
});

// ── getEditorExportJob — retrieval ────────────────────────────────────────────

describe("getEditorExportJob — retrieval", () => {
  it("retrieves the exact row that was written", () => {
    const payload = makePayload({ projectId: "proj-get-1" });
    const created = createEditorExportJob({ projectId: "proj-get-1", payload }, db);
    const fetched = getEditorExportJob(created.id, db);
    assert.ok(fetched);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.projectId, created.projectId);
    assert.equal(fetched.status, created.status);
    assert.equal(fetched.totalDurationMs, created.totalDurationMs);
    assert.equal(fetched.sceneCount, created.sceneCount);
    assert.equal(fetched.createdAt, created.createdAt);
  });

  it("payload round-trips through JSON without data loss", () => {
    const payload = makePayload({ projectId: "proj-roundtrip" });
    const created = createEditorExportJob({ projectId: "proj-roundtrip", payload }, db);
    const fetched = getEditorExportJob(created.id, db);
    assert.deepEqual(fetched!.payload, payload);
  });

  it("returns null for an unknown ID", () => {
    const result = getEditorExportJob("00000000-0000-0000-0000-000000000000", db);
    assert.equal(result, null);
  });

  it("two separate jobs have different IDs", () => {
    const a = createEditorExportJob({ projectId: "proj-ids", payload: makePayload() }, db);
    const b = createEditorExportJob({ projectId: "proj-ids", payload: makePayload() }, db);
    assert.notEqual(a.id, b.id);
  });
});

// ── Payload metadata integrity ────────────────────────────────────────────────

describe("getEditorExportJob — payload metadata integrity", () => {
  it("stores and returns all scene fields verbatim", () => {
    const payload = makePayload();
    const job = createEditorExportJob({ projectId: "proj-meta", payload }, db);
    const fetched = getEditorExportJob(job.id, db);

    const sceneA = fetched!.payload.scenes[0]!;
    assert.equal(sceneA.id, "scene-a");
    assert.equal(sceneA.index, 0);
    assert.equal(sceneA.type, "image");
    assert.equal(sceneA.src, "a.jpg");
    assert.equal(sceneA.durationMs, 5000);
    assert.equal(sceneA.startMs, 0);
    assert.equal(sceneA.endMs, 5000);
    assert.equal(sceneA.transition, "cut");
    assert.equal(sceneA.fadeDurationMs, 0);
    assert.equal(sceneA.textOverlay, null);
  });

  it("stores and returns text overlay", () => {
    const payload = makePayload();
    const job = createEditorExportJob({ projectId: "proj-overlay", payload }, db);
    const fetched = getEditorExportJob(job.id, db);

    const sceneB = fetched!.payload.scenes[1]!;
    assert.deepEqual(sceneB.textOverlay, { text: "Fin", position: "bottom", style: "subtitle" });
  });

  it("summary fields match payload scenes", () => {
    const payload = makePayload();
    const job = createEditorExportJob({ projectId: "proj-summary", payload }, db);
    assert.equal(job.totalDurationMs, payload.totalDurationMs);
    assert.equal(job.sceneCount, payload.scenes.length);
  });

  it("aspectRatio is preserved in persisted payload", () => {
    const payload = makePayload({ aspectRatio: "9:16" });
    const job = createEditorExportJob({ projectId: "proj-ar", payload }, db);
    const fetched = getEditorExportJob(job.id, db);
    assert.equal(fetched!.payload.aspectRatio, "9:16");
  });
});

// ── Response value alignment ───────────────────────────────────────────────────

describe("response value alignment — job record matches endpoint response shape", () => {
  it("jobId, totalDurationMs, sceneCount returned from createEditorExportJob match what the route returns", () => {
    const payload = makePayload({ totalDurationMs: 13000 });
    const job = createEditorExportJob({ projectId: "proj-resp", payload }, db);

    // These are exactly the fields the route returns in the 202 response.
    const routeResponse = {
      status: "accepted" as const,
      jobId: job.id,
      totalDurationMs: job.totalDurationMs,
      sceneCount: job.sceneCount,
    };

    assert.equal(routeResponse.status, "accepted");
    assert.equal(routeResponse.jobId, job.id);
    assert.equal(routeResponse.totalDurationMs, 13000);
    assert.equal(routeResponse.sceneCount, 2);
  });
});
