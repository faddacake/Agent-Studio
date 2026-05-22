/**
 * Focused tests for the export job runner — the single execution seam.
 *
 * These tests lock the contract of `runExportJob`, which is the authoritative
 * definition of what "executing an export job" means. The BullMQ worker
 * processor mirrors this contract; these tests prove it.
 *
 * Uses isolated in-memory SQLite databases. No HTTP, no BullMQ, no Redis.
 *
 * Covers:
 *   - valid pending job → driven to "completed", DB row updated
 *   - missing DB row → throws clearly
 *   - already-running job → lifecycle guard throws
 *   - already-terminal job (completed) → lifecycle guard throws
 *   - already-terminal job (failed) → lifecycle guard throws
 *   - result shape is minimal and stable: exactly { jobId, status }
 *   - processor only requires jobId — no full render payload from Redis
 *   - non-status DB fields are unchanged after execution
 *   - processor delegates to runner (thin wrapper contract)
 *   - runner passes validated persisted payload into the adapter
 *   - adapter receives only the validated payload (not the raw DB row)
 *   - adapter failure is distinct from payload validation failure
 *   - adapter failure propagates and leaves job pending (not claimed)
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";
import { ARTIFACTS_DIR } from "../../lib/artifactStorage";

import {
  createEditorExportJob,
  getEditorExportJob,
  claimExportJob,
  executeExportJob,
  markExportJobFailed,
} from "./editorExportJobs";
import { runExportJob } from "./editorExportJobRunner";
import { processExportJob } from "./editorExportJobProcessor";
import type { ExportJobPayload } from "@iterastudio/shared";
import type { RenderResult } from "./editorExportJobRenderer";
import type { PersistedRenderResult } from "./editorExportJobTypes";

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

function minimalPayload(projectId = "proj-runner"): ExportJobPayload {
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

function makeJob(db: TestDb, projectId = "proj-runner") {
  return createEditorExportJob({ projectId, payload: minimalPayload(projectId) }, db);
}

// ── Successful execution ──────────────────────────────────────────────────────

describe("runExportJob — successful execution", () => {
  it("returns status 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.equal(result.status, "completed");
  });

  it("result jobId matches the input jobId", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.equal(result.jobId, job.id);
  });

  it("persisted row status is 'completed' after execution", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("persisted row updatedAt advances after execution", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.ok(row.updatedAt >= job.updatedAt);
  });

  it("non-status fields in persisted row are unchanged", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-field-check");
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.id, job.id);
    assert.equal(row.projectId, job.projectId);
    assert.equal(row.totalDurationMs, job.totalDurationMs);
    assert.equal(row.sceneCount, job.sceneCount);
    assert.equal(row.createdAt, job.createdAt);
  });
});

// ── Result shape ──────────────────────────────────────────────────────────────

describe("runExportJob — result shape", () => {
  it("result has exactly three fields: jobId, renderResult, and status", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.deepEqual(Object.keys(result).sort(), ["jobId", "renderResult", "status"]);
  });

  it("only jobId is required — no render payload needed from the queue", () => {
    const db = makeDb();
    const job = makeJob(db);
    // Calling with only jobId is sufficient; no payload, no scene data from BullMQ
    const result = runExportJob(job.id, db);
    assert.ok(result);
  });
});

// ── Error cases — caller (BullMQ) marks queue job failed ─────────────────────

describe("runExportJob — error cases", () => {
  it("throws 'not found' for a missing DB row", () => {
    const db = makeDb();
    assert.throws(
      () => runExportJob("00000000-0000-0000-0000-000000000000", db),
      /export job not found/,
    );
  });

  it("throws a lifecycle error for an already-running job", () => {
    const db = makeDb();
    const job = makeJob(db);
    claimExportJob(job.id, db);
    assert.throws(
      () => runExportJob(job.id, db),
      /invalid export job transition/,
    );
  });

  it("throws a lifecycle error for an already-completed job", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "completed", db);
    assert.throws(
      () => runExportJob(job.id, db),
      /invalid export job transition/,
    );
  });

  it("throws a lifecycle error for an already-failed job", () => {
    const db = makeDb();
    const job = makeJob(db);
    executeExportJob(job.id, "failed", db);
    assert.throws(
      () => runExportJob(job.id, db),
      /invalid export job transition/,
    );
  });
});

// ── Processor delegates to runner ─────────────────────────────────────────────

describe("processExportJob — delegates to runExportJob", () => {
  it("processor result matches runner result for the same job", () => {
    const db1 = makeDb();
    const db2 = makeDb();
    const j1 = makeJob(db1, "proj-delegate-1");
    const j2 = makeJob(db2, "proj-delegate-2");
    // Give both jobs the same id for comparison (use separate DBs)
    const runnerResult = runExportJob(j1.id, db1);
    const processorResult = processExportJob({ jobId: j2.id }, db2);
    assert.deepEqual(Object.keys(runnerResult).sort(), Object.keys(processorResult).sort());
    assert.equal(runnerResult.status, processorResult.status);
  });

  it("processor returns runner's result shape unchanged", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = processExportJob({ jobId: job.id }, db);
    assert.deepEqual(Object.keys(result).sort(), ["jobId", "renderResult", "status"]);
    assert.equal(result.jobId, job.id);
    assert.equal(result.status, "completed");
  });

  it("processor error propagates from runner — missing job throws", () => {
    const db = makeDb();
    assert.throws(
      () => processExportJob({ jobId: "00000000-0000-0000-0000-000000000000" }, db),
      /export job not found/,
    );
  });
});

// ── Render input validation — valid payload ───────────────────────────────────

describe("runExportJob — render input validation (valid payload)", () => {
  it("accepts a valid persisted payload and proceeds to 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.equal(result.status, "completed");
  });

  it("loads payload from the DB row — no payload is needed from the queue", () => {
    const db = makeDb();
    const job = makeJob(db);
    // The queue carries only { jobId }; the render input is sourced from the DB row.
    const result = runExportJob(job.id, db);
    assert.equal(result.jobId, job.id);
  });
});

// ── Render input validation — malformed payload ───────────────────────────────

describe("runExportJob — render input validation (malformed payload)", () => {
  it("throws a payload validation error when the stored payload is empty ({})", () => {
    const db = makeDb();
    const now = new Date().toISOString();
    // Insert a row that bypasses createEditorExportJob so the payload is invalid.
    db.insert(schema.editorExportJobs)
      .values({
        id: "bad-payload-empty",
        projectId: "proj-bad",
        status: "pending",
        payload: "{}",
        totalDurationMs: 0,
        sceneCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    assert.throws(
      () => runExportJob("bad-payload-empty", db),
      /export job payload invalid/,
    );
  });

  it("throws a payload validation error when scenes array is empty", () => {
    const db = makeDb();
    const now = new Date().toISOString();
    const badPayload = JSON.stringify({
      projectId: "proj-bad",
      aspectRatio: "16:9",
      totalDurationMs: 5000,
      scenes: [], // ExportJobPayloadSchema requires min(1)
    });
    db.insert(schema.editorExportJobs)
      .values({
        id: "bad-payload-scenes",
        projectId: "proj-bad",
        status: "pending",
        payload: badPayload,
        totalDurationMs: 5000,
        sceneCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    assert.throws(
      () => runExportJob("bad-payload-scenes", db),
      /export job payload invalid/,
    );
  });

  it("payload validation error is distinct from a lifecycle error", () => {
    // Lifecycle error message pattern
    const db1 = makeDb();
    const job = makeJob(db1);
    claimExportJob(job.id, db1);
    assert.throws(() => runExportJob(job.id, db1), /invalid export job transition/);

    // Payload validation error message pattern
    const db2 = makeDb();
    const now = new Date().toISOString();
    db2.insert(schema.editorExportJobs)
      .values({
        id: "bad-payload-distinct",
        projectId: "proj-bad",
        status: "pending",
        payload: "{}",
        totalDurationMs: 0,
        sceneCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    assert.throws(
      () => runExportJob("bad-payload-distinct", db2),
      /export job payload invalid/,
    );
  });
});

// ── Multiple independent executions ──────────────────────────────────────────

describe("runExportJob — multiple independent executions", () => {
  it("executes two separate jobs without interference", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-multi-1");
    const j2 = makeJob(db, "proj-multi-2");
    runExportJob(j1.id, db);
    runExportJob(j2.id, db);
    assert.equal(getEditorExportJob(j1.id, db)!.status, "completed");
    assert.equal(getEditorExportJob(j2.id, db)!.status, "completed");
  });

  it("executing one job does not affect another pending job", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-isolate-1");
    const j2 = makeJob(db, "proj-isolate-2");
    runExportJob(j1.id, db);
    assert.equal(getEditorExportJob(j2.id, db)!.status, "pending");
  });
});

// ── Renderer adapter integration ──────────────────────────────────────────────

describe("runExportJob — renderer adapter integration", () => {
  it("runner passes the validated persisted payload into the adapter", () => {
    const db = makeDb();
    const job = makeJob(db);
    let capturedPayload: ExportJobPayload | undefined;
    const spyRender = (payload: ExportJobPayload): RenderResult => {
      capturedPayload = payload;
      return { sceneCount: payload.scenes.length, totalDurationMs: payload.totalDurationMs, artifacts: [] };
    };
    runExportJob(job.id, db, spyRender);
    assert.ok(capturedPayload, "adapter should have been called with the payload");
    assert.deepEqual(capturedPayload, job.payload);
  });

  it("adapter receives only the validated ExportJobPayload — not the raw DB row", () => {
    const db = makeDb();
    const job = makeJob(db);
    let adapterArg: unknown;
    const spyRender = (payload: ExportJobPayload): RenderResult => {
      adapterArg = payload;
      return { sceneCount: payload.scenes.length, totalDurationMs: payload.totalDurationMs, artifacts: [] };
    };
    runExportJob(job.id, db, spyRender);
    // The adapter arg should have payload fields but no DB row fields (id, status, etc.)
    const arg = adapterArg as Record<string, unknown>;
    assert.ok("projectId" in arg, "payload field projectId present");
    assert.ok("scenes" in arg, "payload field scenes present");
    assert.ok(!("status" in arg), "DB-row field status absent");
    assert.ok(!("createdAt" in arg), "DB-row field createdAt absent");
  });

  it("adapter failure propagates clearly from the runner", () => {
    const db = makeDb();
    const job = makeJob(db);
    const throwingRender = (): RenderResult => {
      throw new Error("renderer exploded");
    };
    assert.throws(
      () => runExportJob(job.id, db, throwingRender),
      /renderer exploded/,
    );
  });

  it("adapter failure leaves the job pending — lifecycle was not advanced", () => {
    const db = makeDb();
    const job = makeJob(db);
    const throwingRender = (): RenderResult => {
      throw new Error("renderer exploded");
    };
    assert.throws(() => runExportJob(job.id, db, throwingRender));
    assert.equal(getEditorExportJob(job.id, db)!.status, "pending");
  });

  it("adapter failure is distinct from a payload validation failure", () => {
    const db = makeDb();
    const job = makeJob(db);
    const throwingRender = (): RenderResult => {
      throw new Error("renderer exploded");
    };
    assert.throws(
      () => runExportJob(job.id, db, throwingRender),
      /renderer exploded/,
    );
    // Payload validation failure has a different message pattern
    const db2 = makeDb();
    const now = new Date().toISOString();
    db2.insert(schema.editorExportJobs)
      .values({
        id: "adapter-vs-payload",
        projectId: "proj-bad",
        status: "pending",
        payload: "{}",
        totalDurationMs: 0,
        sceneCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    assert.throws(
      () => runExportJob("adapter-vs-payload", db2),
      /export job payload invalid/,
    );
  });

  it("successful execution with default adapter still reaches 'completed'", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.equal(result.status, "completed");
    assert.equal(getEditorExportJob(job.id, db)!.status, "completed");
  });

  it("queue payload still only needs jobId — adapter is sourced from DB", () => {
    const db = makeDb();
    const job = makeJob(db);
    // The runner accepts only jobId; adapter input comes from the DB row.
    const result = runExportJob(job.id, db);
    assert.equal(result.jobId, job.id);
  });
});

// ── Persisted render result contract ─────────────────────────────────────────

describe("runExportJob — persisted render result contract", () => {
  it("renderResult is present on successful completion", () => {
    const db = makeDb();
    const job = makeJob(db);
    const result = runExportJob(job.id, db);
    assert.ok(result.renderResult, "renderResult should be present");
  });

  it("renderResult has exactly three fields: artifacts, sceneCount, and totalDurationMs", () => {
    const db = makeDb();
    const job = makeJob(db);
    const { renderResult } = runExportJob(job.id, db);
    assert.deepEqual(Object.keys(renderResult).sort(), ["artifacts", "sceneCount", "totalDurationMs"]);
  });

  it("renderResult.sceneCount matches the persisted payload scene count", () => {
    const db = makeDb();
    const job = makeJob(db);
    const { renderResult } = runExportJob(job.id, db);
    assert.equal(renderResult.sceneCount, job.payload.scenes.length);
  });

  it("renderResult.totalDurationMs matches the persisted payload duration", () => {
    const db = makeDb();
    const job = makeJob(db);
    const { renderResult } = runExportJob(job.id, db);
    assert.equal(renderResult.totalDurationMs, job.payload.totalDurationMs);
  });

  it("renderResult is derived from the validated payload, not the raw DB summary fields", () => {
    // The summary fields (totalDurationMs, sceneCount) on the DB row are stored
    // alongside the payload for query convenience, but renderResult is derived
    // from the validated payload — the runner is the only normalisation point.
    const db = makeDb();
    const job = makeJob(db);
    const { renderResult } = runExportJob(job.id, db);
    // Both must agree — the payload is the authoritative source
    assert.equal(renderResult.sceneCount, job.sceneCount);
    assert.equal(renderResult.totalDurationMs, job.totalDurationMs);
  });

  it("renderResult contains no DB-row fields", () => {
    const db = makeDb();
    const job = makeJob(db);
    const rr = runExportJob(job.id, db).renderResult as unknown as Record<string, unknown>;
    assert.ok(!("id" in rr), "id absent");
    assert.ok(!("status" in rr), "status absent");
    assert.ok(!("projectId" in rr), "projectId absent");
    assert.ok(!("createdAt" in rr), "createdAt absent");
    assert.ok(!("updatedAt" in rr), "updatedAt absent");
  });

  it("renderResult contains no file/artifact fields", () => {
    const db = makeDb();
    const job = makeJob(db);
    const rr = runExportJob(job.id, db).renderResult as unknown as Record<string, unknown>;
    assert.ok(!("outputPath" in rr), "outputPath absent");
    assert.ok(!("artifactUrl" in rr), "artifactUrl absent");
    assert.ok(!("fileSizeBytes" in rr), "fileSizeBytes absent");
  });

  it("renderResult is deterministic — identical payloads produce identical results", () => {
    // Both jobs use the same projectId so artifact paths are identical.
    const db1 = makeDb();
    const db2 = makeDb();
    const j1 = makeJob(db1, "proj-det");
    const j2 = makeJob(db2, "proj-det");
    const r1 = runExportJob(j1.id, db1);
    const r2 = runExportJob(j2.id, db2);
    assert.deepEqual(r1.renderResult, r2.renderResult);
  });

  it("runner is the sole normalisation point — spy output maps to renderResult exactly", () => {
    const db = makeDb();
    const job = makeJob(db);
    // Inject a spy that returns known values; verify the runner maps them faithfully.
    const spyRender = (_payload: ExportJobPayload): RenderResult => ({
      sceneCount: 7,
      totalDurationMs: 99000,
      artifacts: [],
    });
    const { renderResult } = runExportJob(job.id, db, spyRender);
    assert.equal(renderResult.sceneCount, 7);
    assert.equal(renderResult.totalDurationMs, 99000);
  });
});

// ── DB persistence of renderResult ───────────────────────────────────────────

describe("runExportJob — renderResult persisted to DB row", () => {
  it("completed job row has a non-null renderResult after execution", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.ok(row.renderResult !== null, "renderResult should be persisted");
  });

  it("persisted renderResult.sceneCount matches the payload", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.renderResult!.sceneCount, job.payload.scenes.length);
  });

  it("persisted renderResult.totalDurationMs matches the payload", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.equal(row.renderResult!.totalDurationMs, job.payload.totalDurationMs);
  });

  it("persisted renderResult has exactly { artifacts, sceneCount, totalDurationMs }", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.deepEqual(Object.keys(renderResult!).sort(), ["artifacts", "sceneCount", "totalDurationMs"]);
  });

  it("persisted renderResult reflects spy-injected adapter values", () => {
    const db = makeDb();
    const job = makeJob(db);
    const spyRender = (_payload: ExportJobPayload): RenderResult => ({
      sceneCount: 3,
      totalDurationMs: 12000,
      artifacts: [],
    });
    runExportJob(job.id, db, spyRender);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.equal(renderResult!.sceneCount, 3);
    assert.equal(renderResult!.totalDurationMs, 12000);
  });

  it("getEditorExportJob returns renderResult as parsed structured data, not a string", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.strictEqual(typeof row.renderResult, "object");
    assert.strictEqual(typeof row.renderResult!.sceneCount, "number");
    assert.strictEqual(typeof row.renderResult!.totalDurationMs, "number");
  });

  it("pending job row has renderResult null", () => {
    const db = makeDb();
    const job = makeJob(db);
    const row = getEditorExportJob(job.id, db)!;
    assert.strictEqual(row.renderResult, null);
  });

  it("failed job row has renderResult null — runner did not persist on failure", () => {
    const db = makeDb();
    const job = makeJob(db);
    // Manually drive to failed (bypassing the runner) to confirm null is stable
    claimExportJob(job.id, db);
    markExportJobFailed(job.id, db);
    const row = getEditorExportJob(job.id, db)!;
    assert.strictEqual(row.renderResult, null);
  });

  it("persisted renderResult contains no flat file/artifact fields", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const rr = getEditorExportJob(job.id, db)!.renderResult as unknown as Record<string, unknown>;
    assert.ok(!("outputPath" in rr), "outputPath absent");
    assert.ok(!("artifactUrl" in rr), "artifactUrl absent");
    assert.ok(!("fileSizeBytes" in rr), "fileSizeBytes absent");
  });

  it("persisted renderResult.artifacts is an array", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(Array.isArray(renderResult!.artifacts), "artifacts is an array");
  });

  it("default adapter produces a non-empty artifacts array after persistence", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(renderResult!.artifacts.length > 0, "artifacts is non-empty");
  });

  it("each persisted artifact has path and mimeType strings", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    for (const a of renderResult!.artifacts) {
      assert.strictEqual(typeof a.path, "string");
      assert.ok(a.path.length > 0);
      assert.strictEqual(typeof a.mimeType, "string");
      assert.ok(a.mimeType.length > 0);
    }
  });

  it("spy-injected empty artifacts array persists as empty array", () => {
    const db = makeDb();
    const job = makeJob(db);
    const emptyArtifactsSpy = (_payload: ExportJobPayload): RenderResult => ({
      sceneCount: 1,
      totalDurationMs: 5000,
      artifacts: [],
    });
    runExportJob(job.id, db, emptyArtifactsSpy);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.deepEqual(renderResult!.artifacts, []);
  });

  it("runner strips artifacts missing path or mimeType", () => {
    const db = makeDb();
    const job = makeJob(db);
    // Inject an adapter that returns two artifacts: one valid, one missing mimeType.
    const mixedArtifactsSpy = (_payload: ExportJobPayload): RenderResult => ({
      sceneCount: 1,
      totalDurationMs: 5000,
      artifacts: [
        { path: "/valid/path.mp4", mimeType: "video/mp4" },
        { path: "", mimeType: "video/mp4" },        // empty path — stripped
        { path: "/no-mime.mp4", mimeType: "" },      // empty mimeType — stripped
      ],
    });
    runExportJob(job.id, db, mixedArtifactsSpy);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.equal(renderResult!.artifacts.length, 1, "only the valid artifact survives");
    assert.equal(renderResult!.artifacts[0].path, "/valid/path.mp4");
  });
});

// ── Storage-backed artifact path — persisted and retrievable ─────────────────

describe("runExportJob — storage-backed artifact path persisted to DB", () => {
  it("persisted artifact path is absolute", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(path.isAbsolute(renderResult!.artifacts[0].path), "persisted path is absolute");
  });

  it("persisted artifact path is under ARTIFACTS_DIR", () => {
    const db = makeDb();
    const job = makeJob(db);
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(
      renderResult!.artifacts[0].path.startsWith(ARTIFACTS_DIR),
      "persisted path is under ARTIFACTS_DIR",
    );
  });

  it("persisted artifact path contains the job's projectId", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-artifact-path-check");
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(
      renderResult!.artifacts[0].path.includes(job.projectId),
      "persisted path contains the projectId",
    );
  });

  it("artifact file exists on disk after execution", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-artifact-disk-check");
    runExportJob(job.id, db);
    const { renderResult } = getEditorExportJob(job.id, db)!;
    assert.ok(
      fs.existsSync(renderResult!.artifacts[0].path),
      "artifact file exists on disk",
    );
  });

  it("artifact path round-trips through DB serialization unchanged", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-artifact-roundtrip");
    const { renderResult: inMemory } = runExportJob(job.id, db);
    const { renderResult: fromDb } = getEditorExportJob(job.id, db)!;
    assert.equal(fromDb!.artifacts[0].path, inMemory.artifacts[0].path);
  });

  it("artifact mimeType round-trips through DB serialization unchanged", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-artifact-mime-roundtrip");
    const { renderResult: inMemory } = runExportJob(job.id, db);
    const { renderResult: fromDb } = getEditorExportJob(job.id, db)!;
    assert.equal(fromDb!.artifacts[0].mimeType, inMemory.artifacts[0].mimeType);
  });

  it("artifact label round-trips through DB serialization unchanged", () => {
    const db = makeDb();
    const job = makeJob(db, "proj-artifact-label-roundtrip");
    const { renderResult: inMemory } = runExportJob(job.id, db);
    const { renderResult: fromDb } = getEditorExportJob(job.id, db)!;
    assert.equal(fromDb!.artifacts[0].label, inMemory.artifacts[0].label);
  });

  it("two jobs with different projectIds persist different artifact paths", () => {
    const db = makeDb();
    const j1 = makeJob(db, "proj-path-diff-1");
    const j2 = makeJob(db, "proj-path-diff-2");
    runExportJob(j1.id, db);
    runExportJob(j2.id, db);
    const r1 = getEditorExportJob(j1.id, db)!.renderResult!;
    const r2 = getEditorExportJob(j2.id, db)!.renderResult!;
    assert.notEqual(r1.artifacts[0].path, r2.artifacts[0].path);
  });
});
