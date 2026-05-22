/**
 * Focused tests for the export-job read endpoint response contract.
 *
 * Uses an in-memory SQLite database. Tests exercise the DAL lookup and
 * the public response projection (fields included/excluded) without HTTP
 * or Next.js mocking.
 *
 * Covers:
 *   - existing job → successful response with all public fields
 *   - missing job → null from DAL (maps to 404 in route)
 *   - response shape includes only the intended public fields
 *   - response values align with persisted row data
 *   - payload is not present in the public response shape
 *   - future-safe: status field is present for worker/queue updates
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "@iterastudio/db";
import { ARTIFACTS_DIR } from "../../lib/artifactStorage";

import { createEditorExportJob, getEditorExportJob, setExportJobRenderResult, claimExportJob, markExportJobCompleted, markExportJobFailed } from "./editorExportJobs";
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

function makePayload(): ExportJobPayload {
  return {
    projectId: "proj-read-test",
    aspectRatio: "16:9",
    totalDurationMs: 8000,
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
      {
        id: "s2",
        index: 1,
        type: "video",
        src: "s2.mp4",
        durationMs: 3000,
        startMs: 5000,
        endMs: 8000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 8000,
        textOverlay: null,
      },
    ],
  };
}

/** Build the public response shape the route returns from a job record. */
function buildReadResponse(job: ReturnType<typeof getEditorExportJob>) {
  if (!job) return null;
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    totalDurationMs: job.totalDurationMs,
    sceneCount: job.sceneCount,
    renderResult: job.renderResult,   // PersistedRenderResult | null — mirrors route
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ── Existing job → successful response ────────────────────────────────────────

describe("read endpoint — existing job returns successful response", () => {
  let jobId: string;

  before(() => {
    const job = createEditorExportJob({ projectId: "proj-read-test", payload: makePayload() }, db);
    jobId = job.id;
  });

  it("getEditorExportJob returns a non-null record for an existing ID", () => {
    const job = getEditorExportJob(jobId, db);
    assert.ok(job);
  });

  it("response id matches the persisted job ID", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.equal(res.id, jobId);
  });

  it("response projectId matches persisted value", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.equal(res.projectId, "proj-read-test");
  });

  it("response status is 'pending'", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.equal(res.status, "pending");
  });

  it("response totalDurationMs matches payload", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.equal(res.totalDurationMs, 8000);
  });

  it("response sceneCount matches payload scene length", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.equal(res.sceneCount, 2);
  });

  it("response includes createdAt as an ISO timestamp", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.doesNotThrow(() => new Date(res.createdAt).toISOString());
  });

  it("response includes updatedAt as an ISO timestamp", () => {
    const job = getEditorExportJob(jobId, db)!;
    const res = buildReadResponse(job)!;
    assert.doesNotThrow(() => new Date(res.updatedAt).toISOString());
  });
});

// ── Missing job → not found ───────────────────────────────────────────────────

describe("read endpoint — missing job returns not found", () => {
  it("getEditorExportJob returns null for an unknown ID", () => {
    const result = getEditorExportJob("00000000-0000-0000-0000-000000000000", db);
    assert.equal(result, null);
  });

  it("buildReadResponse returns null when job is null", () => {
    assert.equal(buildReadResponse(null), null);
  });
});

// ── Response shape — intended public fields only ──────────────────────────────

describe("read endpoint — response shape includes only intended public fields", () => {
  let res: ReturnType<typeof buildReadResponse>;

  before(() => {
    const job = createEditorExportJob({ projectId: "proj-shape-test", payload: makePayload() }, db);
    res = buildReadResponse(getEditorExportJob(job.id, db));
  });

  it("response has exactly the eight expected fields", () => {
    const keys = Object.keys(res!).sort();
    assert.deepEqual(keys, ["createdAt", "id", "projectId", "renderResult", "sceneCount", "status", "totalDurationMs", "updatedAt"]);
  });

  it("payload field is absent from the response", () => {
    assert.equal("payload" in res!, false);
  });

  it("scenes field is absent from the response", () => {
    assert.equal("scenes" in res!, false);
  });

  it("status field is present (anchor for future worker updates)", () => {
    assert.ok("status" in res!);
  });
});

// ── Response values align with persisted row ──────────────────────────────────

describe("read endpoint — response values align with persisted row data", () => {
  it("all response fields match the record returned by createEditorExportJob", () => {
    const created = createEditorExportJob({ projectId: "proj-align", payload: makePayload() }, db);
    const fetched = getEditorExportJob(created.id, db)!;
    const res = buildReadResponse(fetched)!;

    assert.equal(res.id, created.id);
    assert.equal(res.projectId, created.projectId);
    assert.equal(res.status, created.status);
    assert.equal(res.totalDurationMs, created.totalDurationMs);
    assert.equal(res.sceneCount, created.sceneCount);
    assert.equal(res.createdAt, created.createdAt);
    assert.equal(res.updatedAt, created.updatedAt);
  });

  it("different jobs produce different IDs in their responses", () => {
    const a = createEditorExportJob({ projectId: "proj-diff", payload: makePayload() }, db);
    const b = createEditorExportJob({ projectId: "proj-diff", payload: makePayload() }, db);
    const resA = buildReadResponse(getEditorExportJob(a.id, db));
    const resB = buildReadResponse(getEditorExportJob(b.id, db));
    assert.notEqual(resA!.id, resB!.id);
  });
});

// ── renderResult exposure ─────────────────────────────────────────────────────

describe("read endpoint — renderResult for pending job", () => {
  it("pending job response includes renderResult: null", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-pending", payload: makePayload() }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.strictEqual(res.renderResult, null);
  });

  it("renderResult is present as an explicit key on pending job response", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-key", payload: makePayload() }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.ok("renderResult" in res);
  });
});

describe("read endpoint — renderResult for failed job", () => {
  it("failed job response has renderResult: null", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-fail", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobFailed(job.id, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.strictEqual(res.renderResult, null);
  });
});

describe("read endpoint — renderResult for completed job with persisted metadata", () => {
  it("completed job response includes structured renderResult object", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-done", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.ok(res.renderResult !== null, "renderResult should be non-null");
    assert.strictEqual(typeof res.renderResult, "object");
  });

  it("renderResult.sceneCount matches the persisted value", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-sc", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.sceneCount, 2);
  });

  it("renderResult.totalDurationMs matches the persisted value", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-dur", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.totalDurationMs, 8000);
  });

  it("renderResult is not a raw JSON string", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-nostr", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.strictEqual(typeof res.renderResult, "object");
    assert.notStrictEqual(typeof res.renderResult, "string");
  });

  it("response does not expose raw DB column name render_result", () => {
    const job = createEditorExportJob({ projectId: "proj-rr-col", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))! as Record<string, unknown>;
    assert.ok(!("render_result" in res), "raw column name must not appear in response");
  });
});

// ── renderResult with persisted artifact reference ────────────────────────────

describe("read endpoint — renderResult with persisted artifact reference", () => {
  // Fixture: a realistic ARTIFACTS_DIR-rooted artifact reference.
  const FIXTURE_PROJECT_ID = "proj-rr-artifact";
  const fixtureArtifact = {
    path: path.join(ARTIFACTS_DIR, FIXTURE_PROJECT_ID, "export.mp4"),
    mimeType: "video/mp4",
    label: "Exported Video",
  };
  const fixtureRenderResult = {
    sceneCount: 2,
    totalDurationMs: 8000,
    artifacts: [fixtureArtifact],
  };

  it("artifacts array is non-empty in completed job response", () => {
    const job = createEditorExportJob({ projectId: FIXTURE_PROJECT_ID, payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, fixtureRenderResult, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.ok(Array.isArray(res.renderResult!.artifacts), "artifacts is an array");
    assert.equal(res.renderResult!.artifacts.length, 1, "one artifact present");
  });

  it("artifact path survives response round-trip intact", () => {
    const job = createEditorExportJob({ projectId: "proj-art-path", payload: makePayload() }, db);
    const artifactPath = path.join(ARTIFACTS_DIR, "proj-art-path", "export.mp4");
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: [{ path: artifactPath, mimeType: "video/mp4", label: "Exported Video" }] }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.artifacts[0].path, artifactPath);
  });

  it("artifact path in response is absolute", () => {
    const job = createEditorExportJob({ projectId: "proj-art-abs", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, fixtureRenderResult, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.ok(path.isAbsolute(res.renderResult!.artifacts[0].path), "artifact path is absolute");
  });

  it("artifact path in response is under ARTIFACTS_DIR", () => {
    const job = createEditorExportJob({ projectId: "proj-art-dir", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, fixtureRenderResult, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.ok(
      res.renderResult!.artifacts[0].path.startsWith(ARTIFACTS_DIR),
      "artifact path is under ARTIFACTS_DIR",
    );
  });

  it("artifact mimeType survives response round-trip intact", () => {
    const job = createEditorExportJob({ projectId: "proj-art-mime", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, fixtureRenderResult, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.artifacts[0].mimeType, "video/mp4");
  });

  it("artifact label survives response round-trip intact", () => {
    const job = createEditorExportJob({ projectId: "proj-art-label", payload: makePayload() }, db);
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, fixtureRenderResult, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.artifacts[0].label, "Exported Video");
  });

  it("multiple artifacts all survive response round-trip intact", () => {
    const job = createEditorExportJob({ projectId: "proj-art-multi", payload: makePayload() }, db);
    const twoArtifacts = [
      { path: path.join(ARTIFACTS_DIR, "proj-art-multi", "export.mp4"), mimeType: "video/mp4", label: "Clip A" },
      { path: path.join(ARTIFACTS_DIR, "proj-art-multi", "preview.mp4"), mimeType: "video/mp4", label: "Clip B" },
    ];
    claimExportJob(job.id, db);
    markExportJobCompleted(job.id, db);
    setExportJobRenderResult(job.id, { sceneCount: 2, totalDurationMs: 8000, artifacts: twoArtifacts }, db);
    const res = buildReadResponse(getEditorExportJob(job.id, db))!;
    assert.equal(res.renderResult!.artifacts.length, 2);
    assert.equal(res.renderResult!.artifacts[0].label, "Clip A");
    assert.equal(res.renderResult!.artifacts[1].label, "Clip B");
  });
});
