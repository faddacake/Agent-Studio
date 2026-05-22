/**
 * Focused tests for the exportJobStatus lib module.
 *
 * Tests the client-side type contract and helper functions that the export
 * status hook and component rely on. No HTTP, no DB, no React.
 *
 * Covers:
 *   - formatDurationMs: under 60 s and over 60 s formatting
 *   - formatDurationMs: boundary values and exact minute
 *   - hasRenderResult: completed job with renderResult → true
 *   - hasRenderResult: pending/failed/running → false
 *   - hasRenderResult: completed but renderResult null → false
 *   - ExportJobStatusResponse shape: renderResult is PersistedRenderResult | null
 *   - No raw DB column names (render_result) in the typed shape
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatDurationMs,
  hasRenderResult,
  toArtifactPreviewable,
  type ExportJobStatusResponse,
  type ExportRenderResult,
  type ExportArtifactRef,
} from "./exportJobStatus";

// ── formatDurationMs ──────────────────────────────────────────────────────────

describe("formatDurationMs — sub-60 s", () => {
  it("formats 0 ms as '0.0s'", () => {
    assert.equal(formatDurationMs(0), "0.0s");
  });

  it("formats 5000 ms as '5.0s'", () => {
    assert.equal(formatDurationMs(5000), "5.0s");
  });

  it("formats 5500 ms as '5.5s'", () => {
    assert.equal(formatDurationMs(5500), "5.5s");
  });

  it("formats 59999 ms as '60.0s' (boundary — just under 60 s path)", () => {
    // 59999 / 1000 = 59.999 → toFixed(1) = "60.0"
    assert.equal(formatDurationMs(59999), "60.0s");
  });
});

describe("formatDurationMs — 60 s and above", () => {
  it("formats 60000 ms as '1:00'", () => {
    assert.equal(formatDurationMs(60_000), "1:00");
  });

  it("formats 90500 ms as '1:30'", () => {
    assert.equal(formatDurationMs(90_500), "1:30");
  });

  it("formats 3600000 ms (1 hour) as '60:00'", () => {
    assert.equal(formatDurationMs(3_600_000), "60:00");
  });

  it("pads seconds to two digits", () => {
    assert.equal(formatDurationMs(61_000), "1:01");
  });
});

// ── hasRenderResult ───────────────────────────────────────────────────────────

function makeResponse(
  status: ExportJobStatusResponse["status"],
  renderResult: ExportRenderResult | null,
): ExportJobStatusResponse {
  return {
    id: "job-1",
    projectId: "proj-1",
    status,
    totalDurationMs: 5000,
    sceneCount: 1,
    renderResult,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const RENDER_RESULT: ExportRenderResult = { sceneCount: 1, totalDurationMs: 5000, artifacts: [] };

describe("hasRenderResult — returns true only for completed + non-null", () => {
  it("completed with renderResult → true", () => {
    assert.equal(hasRenderResult(makeResponse("completed", RENDER_RESULT)), true);
  });

  it("completed with null renderResult → false", () => {
    assert.equal(hasRenderResult(makeResponse("completed", null)), false);
  });

  it("pending with renderResult → false", () => {
    assert.equal(hasRenderResult(makeResponse("pending", RENDER_RESULT)), false);
  });

  it("running with renderResult → false", () => {
    assert.equal(hasRenderResult(makeResponse("running", RENDER_RESULT)), false);
  });

  it("failed with renderResult → false", () => {
    assert.equal(hasRenderResult(makeResponse("failed", RENDER_RESULT)), false);
  });

  it("pending with null renderResult → false", () => {
    assert.equal(hasRenderResult(makeResponse("pending", null)), false);
  });
});

// ── ExportJobStatusResponse shape ─────────────────────────────────────────────

describe("ExportJobStatusResponse — shape contract", () => {
  it("renderResult field is named 'renderResult', not 'render_result'", () => {
    const response = makeResponse("completed", RENDER_RESULT);
    assert.ok("renderResult" in response, "'renderResult' key must exist");
    assert.ok(!("render_result" in response), "'render_result' DB column name must not appear");
  });

  it("renderResult for completed job has sceneCount and totalDurationMs", () => {
    const response = makeResponse("completed", { sceneCount: 3, totalDurationMs: 12000, artifacts: [] });
    assert.equal(response.renderResult?.sceneCount, 3);
    assert.equal(response.renderResult?.totalDurationMs, 12000);
  });

  it("renderResult is null for pending job", () => {
    const response = makeResponse("pending", null);
    assert.strictEqual(response.renderResult, null);
  });

  it("renderResult is null for failed job", () => {
    const response = makeResponse("failed", null);
    assert.strictEqual(response.renderResult, null);
  });

  it("ExportRenderResult has exactly artifacts, sceneCount, and totalDurationMs", () => {
    const rr: ExportRenderResult = { sceneCount: 2, totalDurationMs: 8000, artifacts: [] };
    assert.deepEqual(Object.keys(rr).sort(), ["artifacts", "sceneCount", "totalDurationMs"]);
  });

  it("ExportRenderResult contains no flat file/artifact fields", () => {
    const rr = { sceneCount: 2, totalDurationMs: 8000, artifacts: [] } as unknown as Record<string, unknown>;
    assert.ok(!("outputPath" in rr));
    assert.ok(!("artifactUrl" in rr));
    assert.ok(!("fileSizeBytes" in rr));
  });

  it("ExportRenderResult.artifacts is an array", () => {
    const rr: ExportRenderResult = { sceneCount: 1, totalDurationMs: 5000, artifacts: [] };
    assert.ok(Array.isArray(rr.artifacts));
  });

  it("artifacts are accessible from a completed renderResult response", () => {
    const artifact: ExportArtifactRef = {
      path: "/data/artifacts/proj-1/export.mp4",
      mimeType: "video/mp4",
      label: "Exported Video",
    };
    const response = makeResponse("completed", {
      sceneCount: 1,
      totalDurationMs: 5000,
      artifacts: [artifact],
    });
    assert.equal(response.renderResult!.artifacts.length, 1);
    assert.equal(response.renderResult!.artifacts[0].path, artifact.path);
    assert.equal(response.renderResult!.artifacts[0].mimeType, artifact.mimeType);
    assert.equal(response.renderResult!.artifacts[0].label, artifact.label);
  });
});

// ── toArtifactPreviewable ──────────────────────────────────────────────────────

describe("toArtifactPreviewable — output shape", () => {
  const artifact: ExportArtifactRef = {
    path: "/data/artifacts/proj-x/export.mp4",
    mimeType: "video/mp4",
    label: "Exported Video",
  };

  it("outputUrl is the /api/artifacts route with the encoded path", () => {
    const result = toArtifactPreviewable(artifact);
    assert.equal(result.outputUrl, `/api/artifacts?path=${encodeURIComponent(artifact.path)}`);
  });

  it("outputUrl starts with /api/artifacts?path=", () => {
    const result = toArtifactPreviewable(artifact);
    assert.ok(result.outputUrl!.startsWith("/api/artifacts?path="), "outputUrl uses the artifact serving route");
  });

  it("outputUrl contains the URL-encoded path", () => {
    const result = toArtifactPreviewable(artifact);
    assert.ok(result.outputUrl!.includes(encodeURIComponent(artifact.path)), "encoded path is in outputUrl");
  });

  it("outputUrl does not contain a raw filesystem path separator", () => {
    // The raw path must be encoded; the route query string should not contain an unencoded slash
    // that would look like a filesystem path leak.
    const result = toArtifactPreviewable(artifact);
    const queryPart = result.outputUrl!.split("?path=")[1];
    assert.ok(!queryPart.startsWith("/"), "raw path is encoded, not passed through as-is");
  });

  it("modelId is set to artifact.path (stable unique key, not a URL)", () => {
    const result = toArtifactPreviewable(artifact);
    assert.equal(result.modelId, artifact.path);
  });

  it("modelName uses artifact.label when present", () => {
    const result = toArtifactPreviewable(artifact);
    assert.equal(result.modelName, "Exported Video");
  });

  it("modelName falls back to mimeType when label is absent", () => {
    const noLabel: ExportArtifactRef = { path: "/p.mp4", mimeType: "video/mp4" };
    const result = toArtifactPreviewable(noLabel);
    assert.equal(result.modelName, "video/mp4");
  });

  it("modelName falls back to 'Export Artifact' when label and mimeType are absent", () => {
    // TypeScript requires mimeType but guard the fallback defensively
    const bare = { path: "/p.mp4", mimeType: "" } as ExportArtifactRef;
    const result = toArtifactPreviewable(bare);
    assert.equal(result.modelName, "Export Artifact");
  });

  it("mimeType is forwarded to the previewable", () => {
    const result = toArtifactPreviewable(artifact);
    assert.equal(result.mimeType, artifact.mimeType);
  });

  it("result has modelId, modelName, outputUrl, mimeType set", () => {
    const result = toArtifactPreviewable(artifact);
    assert.ok(result.modelId);
    assert.ok(result.modelName);
    assert.ok(result.outputUrl);
    assert.ok(result.mimeType);
  });
});

describe("toArtifactPreviewable — determinism", () => {
  it("identical inputs produce identical previewable shapes", () => {
    const a: ExportArtifactRef = {
      path: "/data/artifacts/proj-det/export.mp4",
      mimeType: "video/mp4",
      label: "Exported Video",
    };
    assert.deepEqual(toArtifactPreviewable(a), toArtifactPreviewable(a));
  });

  it("different paths produce different modelId and outputUrl", () => {
    const a1: ExportArtifactRef = { path: "/data/artifacts/proj-a/export.mp4", mimeType: "video/mp4" };
    const a2: ExportArtifactRef = { path: "/data/artifacts/proj-b/export.mp4", mimeType: "video/mp4" };
    assert.notEqual(toArtifactPreviewable(a1).modelId, toArtifactPreviewable(a2).modelId);
    assert.notEqual(toArtifactPreviewable(a1).outputUrl, toArtifactPreviewable(a2).outputUrl);
  });
});
