/**
 * Focused tests for the renderer-facing placeholder adapter.
 *
 * These tests lock the contract of `renderExportJob` in isolation — the
 * stable boundary contract the runner calls and a real renderer will replace.
 *
 * No DB, no queue, no HTTP — pure input/output tests.
 *
 * Covers:
 *   - result shape is minimal and stable: exactly { sceneCount, totalDurationMs }
 *   - sceneCount mirrors payload.scenes.length
 *   - totalDurationMs mirrors payload.totalDurationMs
 *   - result is deterministic — identical inputs produce identical outputs
 *   - adapter accepts only the validated ExportJobPayload contract (no DB row, no queue data)
 *   - multi-scene payload produces correct sceneCount
 *
 * Run with: pnpm --filter /web test:server
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { renderExportJob, getExportJobRenderer } from "./editorExportJobRenderer";
import { realExportJobRenderer, buildRealRendererResult, normalizeRealRendererInput, buildRealRenderPlan, buildRealRenderArtifactDescriptor, buildRealRenderArtifactPath, buildRealRenderArtifactIdentity, assembleRealRendererResult, writeRealRenderArtifactFile, buildFfmpegArgs, REAL_RENDER_ARTIFACT_FILENAME, REAL_PREVIEW_ARTIFACT_FILENAME, PREVIEW_MAX_DURATION_MS, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET, clampScenesToDuration } from "./editorExportJobRealRenderer";
import { ARTIFACTS_DIR } from "../../lib/artifactStorage";
import type { ExportJobPayload } from "@iterastudio/shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function singleScenePayload(): ExportJobPayload {
  return {
    projectId: "proj-adapter",
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

function twoScenePayload(): ExportJobPayload {
  return {
    projectId: "proj-adapter-2",
    aspectRatio: "9:16",
    totalDurationMs: 8000,
    scenes: [
      {
        id: "s1",
        index: 0,
        type: "image",
        src: "s1.jpg",
        durationMs: 4000,
        startMs: 0,
        endMs: 4000,
        transition: "fade",
        fadeDurationMs: 500,
        fadeStartMs: 3500,
        textOverlay: null,
      },
      {
        id: "s2",
        index: 1,
        type: "video",
        src: "s2.mp4",
        durationMs: 4000,
        startMs: 4000,
        endMs: 8000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 8000,
        textOverlay: { text: "End", position: "bottom", style: "subtitle" },
      },
    ],
  };
}

// ── Result shape ──────────────────────────────────────────────────────────────

describe("renderExportJob — result shape", () => {
  it("result has exactly three fields: artifacts, sceneCount, and totalDurationMs", () => {
    const result = renderExportJob(singleScenePayload());
    assert.deepEqual(Object.keys(result).sort(), ["artifacts", "sceneCount", "totalDurationMs"]);
  });

  it("sceneCount mirrors payload.scenes.length (single scene)", () => {
    const payload = singleScenePayload();
    const result = renderExportJob(payload);
    assert.equal(result.sceneCount, payload.scenes.length);
  });

  it("totalDurationMs mirrors payload.totalDurationMs", () => {
    const payload = singleScenePayload();
    const result = renderExportJob(payload);
    assert.equal(result.totalDurationMs, payload.totalDurationMs);
  });

  it("sceneCount mirrors payload.scenes.length (two scenes)", () => {
    const payload = twoScenePayload();
    const result = renderExportJob(payload);
    assert.equal(result.sceneCount, 2);
  });

  it("totalDurationMs mirrors payload.totalDurationMs for multi-scene payload", () => {
    const payload = twoScenePayload();
    const result = renderExportJob(payload);
    assert.equal(result.totalDurationMs, 8000);
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("renderExportJob — determinism", () => {
  it("identical inputs produce identical outputs", () => {
    const payload = singleScenePayload();
    const r1 = renderExportJob(payload);
    const r2 = renderExportJob(payload);
    assert.deepEqual(r1, r2);
  });

  it("different payloads produce different sceneCount values", () => {
    const r1 = renderExportJob(singleScenePayload());
    const r2 = renderExportJob(twoScenePayload());
    assert.notEqual(r1.sceneCount, r2.sceneCount);
  });
});

// ── Input contract ────────────────────────────────────────────────────────────

describe("renderExportJob — input contract", () => {
  it("accepts only the validated ExportJobPayload — no DB row fields", () => {
    // The adapter signature accepts ExportJobPayload, not EditorExportJob.
    // Verify that calling with a plain payload object (no id, status, etc.) works.
    const payload = singleScenePayload();
    const result = renderExportJob(payload);
    assert.ok(result);
  });

  it("accepts only the validated ExportJobPayload — no queue data", () => {
    // Queue carries only { jobId }; the adapter never sees that.
    // Verify the adapter is callable with payload only.
    const result = renderExportJob(twoScenePayload());
    assert.ok(result);
  });
});

// ── Output isolation — RenderResult vs PersistedRenderResult ──────────────────

describe("renderExportJob — output isolation from persisted contract", () => {
  it("adapter output contains no lifecycle/status fields", () => {
    // RenderResult is the raw renderer boundary — it must not carry lifecycle
    // concerns. The runner is the sole place that maps it to PersistedRenderResult.
    const result = renderExportJob(singleScenePayload()) as unknown as Record<string, unknown>;
    assert.ok(!("status" in result), "status absent from RenderResult");
    assert.ok(!("jobId" in result), "jobId absent from RenderResult");
    assert.ok(!("id" in result), "id absent from RenderResult");
  });

  it("adapter output contains no flat file/artifact fields", () => {
    const result = renderExportJob(singleScenePayload()) as unknown as Record<string, unknown>;
    assert.ok(!("outputPath" in result), "outputPath absent");
    assert.ok(!("artifactUrl" in result), "artifactUrl absent");
    assert.ok(!("fileSizeBytes" in result), "fileSizeBytes absent");
  });
});

// ── Artifact output contract ──────────────────────────────────────────────────

describe("renderExportJob — artifacts", () => {
  it("artifacts is a non-empty array", () => {
    const { artifacts } = renderExportJob(singleScenePayload());
    assert.ok(Array.isArray(artifacts), "artifacts is an array");
    assert.ok(artifacts.length > 0, "artifacts is non-empty");
  });

  it("each artifact has a non-empty path string", () => {
    const { artifacts } = renderExportJob(singleScenePayload());
    for (const a of artifacts) {
      assert.strictEqual(typeof a.path, "string");
      assert.ok(a.path.length > 0, "path is non-empty");
    }
  });

  it("each artifact has a non-empty mimeType string", () => {
    const { artifacts } = renderExportJob(singleScenePayload());
    for (const a of artifacts) {
      assert.strictEqual(typeof a.mimeType, "string");
      assert.ok(a.mimeType.length > 0, "mimeType is non-empty");
    }
  });

  it("artifacts are deterministic — identical payloads produce identical paths", () => {
    const p = singleScenePayload();
    const r1 = renderExportJob(p);
    const r2 = renderExportJob(p);
    assert.deepEqual(r1.artifacts, r2.artifacts);
  });

  it("different projectIds produce different artifact paths", () => {
    const p1 = singleScenePayload(); // projectId = "proj-adapter"
    const p2 = twoScenePayload();    // projectId = "proj-adapter-2"
    const r1 = renderExportJob(p1);
    const r2 = renderExportJob(p2);
    assert.notEqual(r1.artifacts[0].path, r2.artifacts[0].path);
  });
});

describe("renderExportJob — concrete output values", () => {
  it("sceneCount concrete value for single-scene payload", () => {
    assert.equal(renderExportJob(singleScenePayload()).sceneCount, 1);
  });

  it("totalDurationMs concrete value for single-scene payload", () => {
    assert.equal(renderExportJob(singleScenePayload()).totalDurationMs, 5000);
  });

  it("artifacts concrete value — single descriptor with storage-backed path", () => {
    const payload = singleScenePayload(); // projectId = "proj-adapter"
    const { artifacts } = renderExportJob(payload);
    assert.equal(artifacts.length, 1);
    assert.ok(path.isAbsolute(artifacts[0].path), "artifact path is absolute");
    assert.ok(artifacts[0].path.startsWith(ARTIFACTS_DIR), "artifact path is under ARTIFACTS_DIR");
    assert.ok(artifacts[0].path.includes("proj-adapter"), "artifact path contains projectId");
    assert.ok(artifacts[0].path.endsWith(REAL_RENDER_ARTIFACT_FILENAME), "artifact path ends with filename");
    assert.equal(artifacts[0].mimeType, "video/mp4");
    assert.equal(artifacts[0].label, "Exported Video");
  });

  it("placeholder file is written to disk", () => {
    const payload = singleScenePayload();
    const { artifacts } = renderExportJob(payload);
    assert.ok(fs.existsSync(artifacts[0].path), "placeholder file exists on disk");
  });
});

// ── Public contract — concrete output shape ───────────────────────────────────

describe("renderExportJob — public contract", () => {
  // Concrete known payload — no helpers used to build the expected values.
  const CONTRACT_PROJECT_ID = "proj-contract";
  const CONTRACT_PAYLOAD: ExportJobPayload = {
    projectId: CONTRACT_PROJECT_ID,
    aspectRatio: "16:9",
    totalDurationMs: 6000,
    scenes: [
      {
        id: "s1",
        index: 0,
        type: "image",
        src: "s1.jpg",
        durationMs: 3000,
        startMs: 0,
        endMs: 3000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 3000,
        textOverlay: null,
      },
      {
        id: "s2",
        index: 1,
        type: "video",
        src: "s2.mp4",
        durationMs: 3000,
        startMs: 3000,
        endMs: 6000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 6000,
        textOverlay: null,
      },
    ],
  };

  it("sceneCount is 2 for a two-scene payload", () => {
    assert.equal(renderExportJob(CONTRACT_PAYLOAD).sceneCount, 2);
  });

  it("totalDurationMs is 6000 for a 6 s payload", () => {
    assert.equal(renderExportJob(CONTRACT_PAYLOAD).totalDurationMs, 6000);
  });

  it("artifacts length is 1", () => {
    assert.equal(renderExportJob(CONTRACT_PAYLOAD).artifacts.length, 1);
  });

  it("artifact path is absolute, under ARTIFACTS_DIR, and contains the projectId", () => {
    const artifactPath = renderExportJob(CONTRACT_PAYLOAD).artifacts[0].path;
    assert.ok(path.isAbsolute(artifactPath), "artifact path is absolute");
    assert.ok(artifactPath.startsWith(ARTIFACTS_DIR), "artifact path is under ARTIFACTS_DIR");
    assert.ok(artifactPath.includes(CONTRACT_PROJECT_ID), "artifact path contains projectId");
  });

  it("artifact mimeType is video/mp4", () => {
    assert.equal(renderExportJob(CONTRACT_PAYLOAD).artifacts[0].mimeType, "video/mp4");
  });

  it("artifact label is 'Exported Video'", () => {
    assert.equal(renderExportJob(CONTRACT_PAYLOAD).artifacts[0].label, "Exported Video");
  });
});

// ── Real renderer module — stub contract ──────────────────────────────────────

describe("realExportJobRenderer — satisfies ExportJobRenderer contract", () => {
  it("output equals renderExportJob output for the same payload", () => {
    assert.deepEqual(realExportJobRenderer(singleScenePayload()), renderExportJob(singleScenePayload()));
  });

  it("sceneCount matches payload scene count", () => {
    assert.equal(realExportJobRenderer(twoScenePayload()).sceneCount, 2);
  });

  it("totalDurationMs matches payload", () => {
    assert.equal(realExportJobRenderer(singleScenePayload()).totalDurationMs, 5000);
  });

  it("artifacts length is 1", () => {
    assert.equal(realExportJobRenderer(singleScenePayload()).artifacts.length, 1);
  });
});

// ── normalizeRealRendererInput ────────────────────────────────────────────────

describe("normalizeRealRendererInput — derived values", () => {
  it("projectId equals payload.projectId", () => {
    const payload = singleScenePayload();
    assert.equal(normalizeRealRendererInput(payload).projectId, payload.projectId);
  });

  it("sceneCount equals payload.scenes.length (single scene)", () => {
    const payload = singleScenePayload();
    assert.equal(normalizeRealRendererInput(payload).sceneCount, 1);
  });

  it("sceneCount equals payload.scenes.length (two scenes)", () => {
    const payload = twoScenePayload();
    assert.equal(normalizeRealRendererInput(payload).sceneCount, 2);
  });

  it("totalDurationMs equals payload.totalDurationMs", () => {
    const payload = singleScenePayload();
    assert.equal(normalizeRealRendererInput(payload).totalDurationMs, payload.totalDurationMs);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const payload = twoScenePayload();
    assert.deepEqual(normalizeRealRendererInput(payload), normalizeRealRendererInput(payload));
  });

  it("result has exactly six fields including audioTrack", () => {
    const result = normalizeRealRendererInput(singleScenePayload());
    assert.deepEqual(Object.keys(result).sort(), ["audioTrack", "isPreview", "projectId", "sceneCount", "scenes", "totalDurationMs"]);
  });
});

// ── buildRealRenderPlan ───────────────────────────────────────────────────────

describe("buildRealRenderPlan — derived values", () => {
  it("projectId equals input.projectId", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    assert.equal(buildRealRenderPlan(input).projectId, input.projectId);
  });

  it("sceneCount equals input.sceneCount (single scene)", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    assert.equal(buildRealRenderPlan(input).sceneCount, 1);
  });

  it("sceneCount equals input.sceneCount (two scenes)", () => {
    const input = normalizeRealRendererInput(twoScenePayload());
    assert.equal(buildRealRenderPlan(input).sceneCount, 2);
  });

  it("totalDurationMs equals input.totalDurationMs", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    assert.equal(buildRealRenderPlan(input).totalDurationMs, input.totalDurationMs);
  });

  it("artifactCount is exactly 1", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    assert.equal(buildRealRenderPlan(input).artifactCount, 1);
  });

  it("artifactCount is exactly 1 for multi-scene input", () => {
    const input = normalizeRealRendererInput(twoScenePayload());
    assert.equal(buildRealRenderPlan(input).artifactCount, 1);
  });

  it("result has exactly ten fields including encoding params, scenes, and audioTrack", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    assert.deepEqual(Object.keys(buildRealRenderPlan(input)).sort(), [
      "artifactCount",
      "audioTrack",
      "crf",
      "heightPx",
      "isPreview",
      "preset",
      "projectId",
      "sceneCount",
      "scenes",
      "totalDurationMs",
    ]);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const input = normalizeRealRendererInput(twoScenePayload());
    assert.deepEqual(buildRealRenderPlan(input), buildRealRenderPlan(input));
  });
});

// ── REAL_RENDER_ARTIFACT_FILENAME ─────────────────────────────────────────────

describe("REAL_RENDER_ARTIFACT_FILENAME — constant value", () => {
  it("is the expected stub filename string", () => {
    assert.equal(REAL_RENDER_ARTIFACT_FILENAME, "export.mp4");
  });
});

// ── buildRealRenderArtifactPath ───────────────────────────────────────────────

describe("buildRealRenderArtifactPath — output contract", () => {
  it("is an absolute filesystem path", () => {
    assert.ok(path.isAbsolute(buildRealRenderArtifactPath("proj-abc")), "path is absolute");
  });

  it("starts with ARTIFACTS_DIR", () => {
    assert.ok(buildRealRenderArtifactPath("proj-x").startsWith(ARTIFACTS_DIR));
  });

  it("ends with REAL_RENDER_ARTIFACT_FILENAME", () => {
    assert.ok(buildRealRenderArtifactPath("proj-x").endsWith(REAL_RENDER_ARTIFACT_FILENAME));
  });

  it("contains the projectId in the output path", () => {
    const id = "proj-unique-777";
    assert.ok(buildRealRenderArtifactPath(id).includes(id));
  });

  it("is deterministic — repeated calls return the same string", () => {
    const id = "proj-det";
    assert.equal(buildRealRenderArtifactPath(id), buildRealRenderArtifactPath(id));
  });

  it("different projectIds produce different paths", () => {
    assert.notEqual(buildRealRenderArtifactPath("proj-a"), buildRealRenderArtifactPath("proj-b"));
  });

  it("returns a string", () => {
    assert.strictEqual(typeof buildRealRenderArtifactPath("any-id"), "string");
  });
});

// ── buildRealRenderArtifactIdentity ──────────────────────────────────────────

describe("buildRealRenderArtifactIdentity — stub artifact type and label", () => {
  it("mimeType is video/mp4", () => {
    assert.equal(buildRealRenderArtifactIdentity().mimeType, "video/mp4");
  });

  it("label is 'Exported Video'", () => {
    assert.equal(buildRealRenderArtifactIdentity().label, "Exported Video");
  });

  it("result has exactly two fields: label, mimeType", () => {
    assert.deepEqual(Object.keys(buildRealRenderArtifactIdentity()).sort(), ["label", "mimeType"]);
  });

  it("is deterministic — repeated calls produce identical objects", () => {
    assert.deepEqual(buildRealRenderArtifactIdentity(), buildRealRenderArtifactIdentity());
  });

  it("descriptor mimeType equals identity mimeType", () => {
    const identity = buildRealRenderArtifactIdentity();
    assert.equal(buildRealRenderArtifactDescriptor("proj-x").mimeType, identity.mimeType);
  });

  it("descriptor label equals identity label", () => {
    const identity = buildRealRenderArtifactIdentity();
    assert.equal(buildRealRenderArtifactDescriptor("proj-x").label, identity.label);
  });
});

// ── buildRealRenderArtifactDescriptor ─────────────────────────────────────────

describe("buildRealRenderArtifactDescriptor — output contract", () => {
  it("path is absolute, under ARTIFACTS_DIR, and contains the projectId", () => {
    const artifactPath = buildRealRenderArtifactDescriptor("proj-abc").path;
    assert.ok(path.isAbsolute(artifactPath), "path is absolute");
    assert.ok(artifactPath.startsWith(ARTIFACTS_DIR), "path is under ARTIFACTS_DIR");
    assert.ok(artifactPath.includes("proj-abc"), "path contains projectId");
  });

  it("path contains the projectId", () => {
    const id = "proj-unique-999";
    assert.ok(buildRealRenderArtifactDescriptor(id).path.includes(id));
  });

  it("mimeType is video/mp4", () => {
    assert.equal(buildRealRenderArtifactDescriptor("proj-x").mimeType, "video/mp4");
  });

  it("label is 'Exported Video'", () => {
    assert.equal(buildRealRenderArtifactDescriptor("proj-x").label, "Exported Video");
  });

  it("is deterministic — repeated calls produce identical objects", () => {
    const id = "proj-det";
    assert.deepEqual(buildRealRenderArtifactDescriptor(id), buildRealRenderArtifactDescriptor(id));
  });

  it("different projectIds produce different paths", () => {
    assert.notEqual(
      buildRealRenderArtifactDescriptor("proj-a").path,
      buildRealRenderArtifactDescriptor("proj-b").path,
    );
  });
});

// ── assembleRealRendererResult ────────────────────────────────────────────────

describe("assembleRealRendererResult — stable result assembly", () => {
  it("sceneCount equals plan.sceneCount", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    assert.equal(assembleRealRendererResult(plan, artifacts).sceneCount, plan.sceneCount);
  });

  it("totalDurationMs equals plan.totalDurationMs", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    assert.equal(assembleRealRendererResult(plan, artifacts).totalDurationMs, plan.totalDurationMs);
  });

  it("artifacts equals the passed-in artifacts array", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    assert.deepEqual(assembleRealRendererResult(plan, artifacts).artifacts, artifacts);
  });

  it("result has exactly three fields: artifacts, sceneCount, totalDurationMs", () => {
    const input = normalizeRealRendererInput(singleScenePayload());
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    const result = assembleRealRendererResult(plan, artifacts);
    assert.deepEqual(Object.keys(result).sort(), ["artifacts", "sceneCount", "totalDurationMs"]);
  });

  it("is deterministic — identical plan and artifacts produce identical results", () => {
    const input = normalizeRealRendererInput(twoScenePayload());
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    assert.deepEqual(
      assembleRealRendererResult(plan, artifacts),
      assembleRealRendererResult(plan, artifacts),
    );
  });

  it("output equals buildRealRendererResult output for the same payload", () => {
    const payload = singleScenePayload();
    const input = normalizeRealRendererInput(payload);
    const plan = buildRealRenderPlan(input);
    const artifacts = [buildRealRenderArtifactDescriptor(plan.projectId)];
    assert.deepEqual(assembleRealRendererResult(plan, artifacts), buildRealRendererResult(payload));
  });
});

// ── writeRealRenderArtifactFile ───────────────────────────────────────────────

describe("writeRealRenderArtifactFile — storage I/O seam", () => {
  // Derive a real plan from a fixture so the second argument is fully typed.
  function stubPlan() {
    return buildRealRenderPlan(normalizeRealRendererInput(singleScenePayload()));
  }

  it("creates the file at the given path", () => {
    const artifactPath = buildRealRenderArtifactPath("proj-write-test");
    writeRealRenderArtifactFile(artifactPath, stubPlan());
    assert.ok(fs.existsSync(artifactPath), "file exists after write");
  });

  it("creates parent directories as needed", () => {
    const artifactPath = buildRealRenderArtifactPath("proj-mkdir-test");
    writeRealRenderArtifactFile(artifactPath, stubPlan());
    assert.ok(fs.existsSync(path.dirname(artifactPath)), "parent directory exists");
  });

  it("is idempotent — calling twice does not throw", () => {
    const artifactPath = buildRealRenderArtifactPath("proj-idempotent-test");
    const plan = stubPlan();
    writeRealRenderArtifactFile(artifactPath, plan);
    assert.doesNotThrow(() => writeRealRenderArtifactFile(artifactPath, plan));
  });
});

describe("buildRealRendererResult — direct construction", () => {
  it("sceneCount equals payload.scenes.length (single scene)", () => {
    assert.equal(buildRealRendererResult(singleScenePayload()).sceneCount, 1);
  });

  it("sceneCount equals payload.scenes.length (two scenes)", () => {
    assert.equal(buildRealRendererResult(twoScenePayload()).sceneCount, 2);
  });

  it("totalDurationMs equals payload.totalDurationMs", () => {
    const payload = singleScenePayload();
    assert.equal(buildRealRendererResult(payload).totalDurationMs, payload.totalDurationMs);
  });

  it("artifacts length equals 1", () => {
    assert.equal(buildRealRendererResult(singleScenePayload()).artifacts.length, 1);
  });

  it("artifact path is absolute, under ARTIFACTS_DIR, and contains the projectId", () => {
    const payload = singleScenePayload(); // projectId = "proj-adapter"
    const artifactPath = buildRealRendererResult(payload).artifacts[0].path;
    assert.ok(path.isAbsolute(artifactPath), "artifact path is absolute");
    assert.ok(artifactPath.startsWith(ARTIFACTS_DIR), "artifact path is under ARTIFACTS_DIR");
    assert.ok(artifactPath.includes("proj-adapter"), "artifact path contains projectId");
  });

  it("placeholder file is written to disk", () => {
    const payload = singleScenePayload();
    const { artifacts } = buildRealRendererResult(payload);
    assert.ok(fs.existsSync(artifacts[0].path), "placeholder file exists on disk");
  });

  it("artifact mimeType is video/mp4", () => {
    assert.equal(buildRealRendererResult(singleScenePayload()).artifacts[0].mimeType, "video/mp4");
  });

  it("artifact label is 'Exported Video'", () => {
    assert.equal(buildRealRendererResult(singleScenePayload()).artifacts[0].label, "Exported Video");
  });

  it("output equals realExportJobRenderer output for the same payload", () => {
    const payload = singleScenePayload();
    assert.deepEqual(buildRealRendererResult(payload), realExportJobRenderer(payload));
  });

  it("is deterministic — identical payloads produce identical results", () => {
    const p = twoScenePayload();
    assert.deepEqual(buildRealRendererResult(p), buildRealRendererResult(p));
  });

  it("artifact equals buildRealRenderArtifactDescriptor(payload.projectId)", () => {
    const payload = singleScenePayload();
    assert.deepEqual(
      buildRealRendererResult(payload).artifacts[0],
      buildRealRenderArtifactDescriptor(payload.projectId),
    );
  });
});

// ── Selection layer — active renderer routing ─────────────────────────────────

describe("getExportJobRenderer — routes to real renderer", () => {
  it("output equals realExportJobRenderer output for a single-scene payload", () => {
    const payload = singleScenePayload();
    assert.deepEqual(getExportJobRenderer()(payload), realExportJobRenderer(payload));
  });

  it("output equals realExportJobRenderer output for a two-scene payload", () => {
    const payload = twoScenePayload();
    assert.deepEqual(getExportJobRenderer()(payload), realExportJobRenderer(payload));
  });

  it("sceneCount matches payload scene count", () => {
    assert.equal(getExportJobRenderer()(twoScenePayload()).sceneCount, 2);
  });

  it("totalDurationMs matches payload", () => {
    assert.equal(getExportJobRenderer()(singleScenePayload()).totalDurationMs, 5000);
  });
});

describe("renderExportJob — routes through real renderer path", () => {
  it("output equals realExportJobRenderer output for the same payload", () => {
    const payload = singleScenePayload();
    assert.deepEqual(renderExportJob(payload), realExportJobRenderer(payload));
  });

  it("output equals getExportJobRenderer() output for the same payload", () => {
    const payload = twoScenePayload();
    assert.deepEqual(renderExportJob(payload), getExportJobRenderer()(payload));
  });
});

// ── Preview render — fixtures & constants ─────────────────────────────────────

/** A two-scene payload that spans 60 s, well beyond the 30 s preview cap. */
function longPayload(): ExportJobPayload {
  return {
    projectId: "proj-long",
    aspectRatio: "16:9",
    totalDurationMs: 60_000,
    isPreview: false, // default — individual tests set isPreview: true
    scenes: [
      {
        id: "s1",
        index: 0,
        type: "image",
        src: "a.jpg",
        durationMs: 40_000,
        startMs: 0,
        endMs: 40_000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 40_000,
        textOverlay: null,
      },
      {
        id: "s2",
        index: 1,
        type: "video",
        src: "b.mp4",
        durationMs: 20_000,
        startMs: 40_000,
        endMs: 60_000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 60_000,
        textOverlay: null,
      },
    ],
  };
}

// ── clampScenesToDuration ─────────────────────────────────────────────────────

describe("clampScenesToDuration — scene list trimming", () => {
  it("returns all scenes when all start before maxMs", () => {
    const scenes = twoScenePayload().scenes;
    const clamped = clampScenesToDuration(scenes, 60_000);
    assert.equal(clamped.length, 2);
  });

  it("excludes scenes that start at or after maxMs", () => {
    // s2 starts at 40_000 which is >= 30_000
    const scenes = longPayload().scenes;
    const clamped = clampScenesToDuration(scenes, PREVIEW_MAX_DURATION_MS);
    assert.equal(clamped.length, 1, "only scene starting before 30 s is included");
    assert.equal(clamped[0].id, "s1");
  });

  it("returns all scenes when maxMs exceeds total duration", () => {
    const scenes = singleScenePayload().scenes;
    const clamped = clampScenesToDuration(scenes, 999_999);
    assert.equal(clamped.length, 1);
  });

  it("returns empty array when maxMs is 0", () => {
    const clamped = clampScenesToDuration(singleScenePayload().scenes, 0);
    assert.equal(clamped.length, 0);
  });

  it("is a pure function — does not mutate the input array", () => {
    const scenes = twoScenePayload().scenes;
    const original = scenes.slice();
    clampScenesToDuration(scenes, PREVIEW_MAX_DURATION_MS);
    assert.deepEqual(scenes, original);
  });
});

// ── normalizeRealRendererInput — preview mode ─────────────────────────────────

describe("normalizeRealRendererInput — preview mode", () => {
  it("isPreview is false when payload.isPreview is absent", () => {
    assert.equal(normalizeRealRendererInput(singleScenePayload()).isPreview, false);
  });

  it("isPreview is false when payload.isPreview is false", () => {
    const payload = { ...singleScenePayload(), isPreview: false };
    assert.equal(normalizeRealRendererInput(payload).isPreview, false);
  });

  it("isPreview is true when payload.isPreview is true", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    assert.equal(normalizeRealRendererInput(payload).isPreview, true);
  });

  it("clamps totalDurationMs to PREVIEW_MAX_DURATION_MS for long preview payloads", () => {
    const payload = { ...longPayload(), isPreview: true };
    const input = normalizeRealRendererInput(payload);
    assert.equal(input.totalDurationMs, PREVIEW_MAX_DURATION_MS);
  });

  it("does not clamp totalDurationMs for long full-export payloads", () => {
    const payload = { ...longPayload(), isPreview: false };
    const input = normalizeRealRendererInput(payload);
    assert.equal(input.totalDurationMs, 60_000);
  });

  it("excludes scenes starting at or after PREVIEW_MAX_DURATION_MS in preview mode", () => {
    const payload = { ...longPayload(), isPreview: true };
    const input = normalizeRealRendererInput(payload);
    assert.equal(input.sceneCount, 1, "scene starting at 40 s is excluded");
    assert.equal(input.scenes[0].id, "s1");
  });

  it("keeps all scenes in full export mode regardless of duration", () => {
    const payload = { ...longPayload(), isPreview: false };
    const input = normalizeRealRendererInput(payload);
    assert.equal(input.sceneCount, 2);
  });
});

// ── buildRealRenderPlan — encoding constants ──────────────────────────────────

describe("buildRealRenderPlan — encoding settings", () => {
  it("full export uses FULL_HEIGHT_PX", () => {
    const plan = buildRealRenderPlan(normalizeRealRendererInput(singleScenePayload()));
    assert.equal(plan.heightPx, FULL_HEIGHT_PX);
  });

  it("full export uses FULL_CRF", () => {
    const plan = buildRealRenderPlan(normalizeRealRendererInput(singleScenePayload()));
    assert.equal(plan.crf, FULL_CRF);
  });

  it("full export uses FULL_PRESET", () => {
    const plan = buildRealRenderPlan(normalizeRealRendererInput(singleScenePayload()));
    assert.equal(plan.preset, FULL_PRESET);
  });

  it("preview uses PREVIEW_HEIGHT_PX (lower resolution)", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const plan = buildRealRenderPlan(normalizeRealRendererInput(payload));
    assert.equal(plan.heightPx, PREVIEW_HEIGHT_PX);
    assert.ok(PREVIEW_HEIGHT_PX < FULL_HEIGHT_PX, "preview height must be lower than full");
  });

  it("preview uses PREVIEW_CRF (faster encode, higher value)", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const plan = buildRealRenderPlan(normalizeRealRendererInput(payload));
    assert.equal(plan.crf, PREVIEW_CRF);
    assert.ok(PREVIEW_CRF > FULL_CRF, "preview CRF must be higher than full (faster, lower quality)");
  });

  it("preview uses PREVIEW_PRESET (ultrafast)", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const plan = buildRealRenderPlan(normalizeRealRendererInput(payload));
    assert.equal(plan.preset, PREVIEW_PRESET);
    assert.equal(PREVIEW_PRESET, "ultrafast");
  });

  it("isPreview is false in plan for full export", () => {
    const plan = buildRealRenderPlan(normalizeRealRendererInput(singleScenePayload()));
    assert.equal(plan.isPreview, false);
  });

  it("isPreview is true in plan for preview job", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const plan = buildRealRenderPlan(normalizeRealRendererInput(payload));
    assert.equal(plan.isPreview, true);
  });
});

// ── Artifact naming — preview vs full ────────────────────────────────────────

describe("buildRealRenderArtifactPath — preview vs full filename", () => {
  it("full export uses REAL_RENDER_ARTIFACT_FILENAME (export.mp4)", () => {
    const p = buildRealRenderArtifactPath("proj-x", false);
    assert.ok(p.endsWith(REAL_RENDER_ARTIFACT_FILENAME), `expected ${REAL_RENDER_ARTIFACT_FILENAME}`);
  });

  it("preview uses REAL_PREVIEW_ARTIFACT_FILENAME (preview.mp4)", () => {
    const p = buildRealRenderArtifactPath("proj-x", true);
    assert.ok(p.endsWith(REAL_PREVIEW_ARTIFACT_FILENAME), `expected ${REAL_PREVIEW_ARTIFACT_FILENAME}`);
  });

  it("preview and full paths are different for the same projectId", () => {
    const full    = buildRealRenderArtifactPath("proj-x", false);
    const preview = buildRealRenderArtifactPath("proj-x", true);
    assert.notEqual(full, preview, "preview.mp4 and export.mp4 must differ");
  });
});

describe("buildRealRenderArtifactIdentity — labels", () => {
  it("full export label is 'Exported Video'", () => {
    assert.equal(buildRealRenderArtifactIdentity(false).label, "Exported Video");
  });

  it("preview label contains 'Preview'", () => {
    assert.ok(
      buildRealRenderArtifactIdentity(true).label.includes("Preview"),
      "preview label must mention Preview",
    );
  });

  it("preview label contains '480p'", () => {
    assert.ok(
      buildRealRenderArtifactIdentity(true).label.includes("480p"),
      "preview label must include resolution hint",
    );
  });

  it("both use mimeType video/mp4", () => {
    assert.equal(buildRealRenderArtifactIdentity(false).mimeType, "video/mp4");
    assert.equal(buildRealRenderArtifactIdentity(true).mimeType, "video/mp4");
  });
});

// ── buildRealRendererResult — preview end-to-end ─────────────────────────────

describe("buildRealRendererResult — preview job", () => {
  it("artifact filename is preview.mp4 when isPreview is true", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const { artifacts } = buildRealRendererResult(payload);
    assert.ok(
      artifacts[0].path.endsWith(REAL_PREVIEW_ARTIFACT_FILENAME),
      "preview artifact must use preview.mp4 filename",
    );
  });

  it("artifact label mentions Preview for preview job", () => {
    const payload = { ...singleScenePayload(), isPreview: true };
    const { artifacts } = buildRealRendererResult(payload);
    assert.ok(artifacts[0].label?.includes("Preview"), "label must mention Preview");
  });

  it("artifact filename is export.mp4 for full export", () => {
    const payload = { ...singleScenePayload(), isPreview: false };
    const { artifacts } = buildRealRendererResult(payload);
    assert.ok(
      artifacts[0].path.endsWith(REAL_RENDER_ARTIFACT_FILENAME),
      "full export artifact must use export.mp4 filename",
    );
  });

  it("preview of long video clamps sceneCount to included scenes", () => {
    const payload = { ...longPayload(), isPreview: true };
    const result = buildRealRendererResult(payload);
    assert.equal(result.sceneCount, 1, "only scenes starting before 30 s are counted");
  });

  it("preview of long video clamps totalDurationMs to PREVIEW_MAX_DURATION_MS", () => {
    const payload = { ...longPayload(), isPreview: true };
    const result = buildRealRendererResult(payload);
    assert.equal(result.totalDurationMs, PREVIEW_MAX_DURATION_MS);
  });

  it("full export of long video keeps full sceneCount and duration", () => {
    const payload = { ...longPayload(), isPreview: false };
    const result = buildRealRendererResult(payload);
    assert.equal(result.sceneCount, 2);
    assert.equal(result.totalDurationMs, 60_000);
  });

  it("preview placeholder file is written to disk at preview.mp4 path", () => {
    const payload = { ...singleScenePayload(), projectId: "proj-preview-write", isPreview: true };
    const { artifacts } = buildRealRendererResult(payload);
    assert.ok(fs.existsSync(artifacts[0].path), "preview placeholder file must exist on disk");
  });
});

// ── buildFfmpegArgs — pure function, no ffmpeg required ───────────────────────

describe("buildFfmpegArgs — single image scene", () => {
  const scene = singleScenePayload().scenes[0]; // image, 5 s
  const out = "/tmp/test-out.mp4";

  it("throws for empty scene list", () => {
    assert.throws(
      () => buildFfmpegArgs([], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET),
      /empty/i,
    );
  });

  it("starts with -y (overwrite flag)", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    assert.equal(args[0], "-y");
  });

  it("adds -loop 1 -framerate 25 before -i for image scenes", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const loopIdx = args.indexOf("-loop");
    assert.ok(loopIdx !== -1, "-loop must be present for image scene");
    assert.equal(args[loopIdx + 1], "1");
    const frIdx = args.indexOf("-framerate");
    assert.ok(frIdx !== -1, "-framerate must be present for image scene");
    assert.equal(args[frIdx + 1], "25");
  });

  it("passes -i with the scene src", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const iIdx = args.indexOf("-i");
    assert.ok(iIdx !== -1, "-i must be present");
    assert.equal(args[iIdx + 1], scene.src);
  });

  it("uses -t to set output duration (single-scene path)", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const tIdx = args.indexOf("-t");
    assert.ok(tIdx !== -1, "-t must be present in single-scene path");
    assert.ok(parseFloat(args[tIdx + 1]) > 0, "-t value must be positive");
  });

  it("passes -vf with scale using the given heightPx", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const vfIdx = args.indexOf("-vf");
    assert.ok(vfIdx !== -1, "-vf must be present");
    assert.ok(args[vfIdx + 1].includes(String(PREVIEW_HEIGHT_PX)), "vf must reference heightPx");
  });

  it("passes -crf with the given value", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const crfIdx = args.indexOf("-crf");
    assert.ok(crfIdx !== -1, "-crf must be present");
    assert.equal(args[crfIdx + 1], String(PREVIEW_CRF));
  });

  it("passes -preset with the given preset string", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    const presetIdx = args.indexOf("-preset");
    assert.ok(presetIdx !== -1, "-preset must be present");
    assert.equal(args[presetIdx + 1], PREVIEW_PRESET);
  });

  it("passes -an (no audio)", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    assert.ok(args.includes("-an"), "-an must be present");
  });

  it("last arg is the output path", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    assert.equal(args[args.length - 1], out);
  });

  it("does not include -filter_complex in single-scene path", () => {
    const args = buildFfmpegArgs([scene], out, PREVIEW_HEIGHT_PX, PREVIEW_CRF, PREVIEW_PRESET);
    assert.ok(!args.includes("-filter_complex"), "single-scene path must not use filter_complex");
  });
});

describe("buildFfmpegArgs — single video scene", () => {
  const scene = twoScenePayload().scenes[1]; // video scene (s2)
  const out = "/tmp/test-video-out.mp4";

  it("does not add -loop 1 for video scene", () => {
    const args = buildFfmpegArgs([scene], out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    assert.ok(!args.includes("-loop"), "-loop must not appear for video scene");
  });

  it("passes -i with the video src", () => {
    const args = buildFfmpegArgs([scene], out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const iIdx = args.indexOf("-i");
    assert.ok(iIdx !== -1);
    assert.equal(args[iIdx + 1], scene.src);
  });

  it("uses FULL_HEIGHT_PX in -vf filter", () => {
    const args = buildFfmpegArgs([scene], out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const vfIdx = args.indexOf("-vf");
    assert.ok(args[vfIdx + 1].includes(String(FULL_HEIGHT_PX)));
  });
});

describe("buildFfmpegArgs — multi-scene cut transitions", () => {
  // Build an explicit two-scene list where both transitions are hard cuts.
  const scenes = (() => {
    const base = twoScenePayload().scenes;
    return [
      { ...base[0], transition: "cut" as const, fadeDurationMs: 0 },
      { ...base[1], transition: "cut" as const, fadeDurationMs: 0 },
    ];
  })();
  const out = "/tmp/test-multi-out.mp4";

  it("uses -filter_complex for multi-scene", () => {
    const args = buildFfmpegArgs(scenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    assert.ok(args.includes("-filter_complex"), "multi-scene must use filter_complex");
  });

  it("includes concat filter for cut transitions", () => {
    const args = buildFfmpegArgs(scenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fcIdx = args.indexOf("-filter_complex");
    assert.ok(args[fcIdx + 1].includes("concat"), "concat must appear in filter_complex");
  });

  it("does not include xfade for all-cut sequences", () => {
    const args = buildFfmpegArgs(scenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.ok(!fc.includes("xfade"), "xfade must not appear for all-cut sequences");
  });

  it("includes -map argument pointing to vout", () => {
    const args = buildFfmpegArgs(scenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const mapIdx = args.indexOf("-map");
    assert.ok(mapIdx !== -1, "-map must be present in multi-scene path");
    assert.ok(args[mapIdx + 1].includes("vout"), "-map must reference [vout]");
  });

  it("includes trim for each scene in filter_complex", () => {
    const args = buildFfmpegArgs(scenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.ok(fc.includes("[0:v]trim="), "scene 0 trim must appear");
    assert.ok(fc.includes("[1:v]trim="), "scene 1 trim must appear");
  });
});

describe("buildFfmpegArgs — multi-scene fade transition", () => {
  // Construct two scenes where scene 0 has a fade transition out (500 ms fade)
  const fadeScenes = (() => {
    const base = twoScenePayload().scenes;
    const s0 = { ...base[0], transition: "fade" as const, fadeDurationMs: 500, fadeStartMs: 3500 };
    return [s0, base[1]];
  })();
  const out = "/tmp/test-fade-out.mp4";

  it("uses xfade when scene has fade transition", () => {
    const args = buildFfmpegArgs(fadeScenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.ok(fc.includes("xfade"), "xfade must appear for fade transition");
  });

  it("xfade references 'fade' transition type", () => {
    const args = buildFfmpegArgs(fadeScenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.ok(fc.includes("transition=fade"), "xfade transition type must be 'fade'");
  });

  it("xfade has a positive offset", () => {
    const args = buildFfmpegArgs(fadeScenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    const m = fc.match(/offset=(\d+\.\d+)/);
    assert.ok(m, "offset must appear in xfade");
    assert.ok(parseFloat(m[1]) > 0, "offset must be positive");
  });

  it("does not use concat for a fade-only two-scene sequence", () => {
    const args = buildFfmpegArgs(fadeScenes, out, FULL_HEIGHT_PX, FULL_CRF, FULL_PRESET);
    const fc = args[args.indexOf("-filter_complex") + 1];
    assert.ok(!fc.includes("concat"), "concat must not appear when xfade is used");
  });
});
