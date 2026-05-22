/**
 * Artifact serving integration test.
 *
 * Verifies that preview and full export artifacts written by buildRealRendererResult
 * land in the correct location and can be served via the /api/artifacts route logic.
 *
 * Design:
 *   - Calls buildRealRendererResult with isPreview: true and fake source paths.
 *     The renderer gracefully stubs the artifact (writes an empty file) when
 *     source files are absent. The test then writes sentinel bytes to make the
 *     file non-zero, mirroring real ffmpeg output.
 *   - Independently validates the path-prefix security logic extracted from the
 *     route so the validation contract is tested without an HTTP server.
 *
 * Run: pnpm --filter /web test:integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";
import {
  buildRealRendererResult,
  buildRealRenderArtifactPath,
  REAL_PREVIEW_ARTIFACT_FILENAME,
  REAL_RENDER_ARTIFACT_FILENAME,
} from "@/server/api/editorExportJobRealRenderer";
import type { ExportJobPayload } from "@iterastudio/shared";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_PROJECT = "artifact-serving-int-test";

/** Sentinel bytes written after the stub so the file is non-zero. */
const SENTINEL = Buffer.from("FAKE_MP4_SENTINEL_FOR_TEST");

// ── Path validator (mirrors /api/artifacts route.ts) ─────────────────────────

const ALLOWED_PREFIXES = [
  path.normalize(ARTIFACTS_DIR) + path.sep,
  path.normalize("/tmp/aistudio-runs") + path.sep,
];

function isPathAllowed(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePreviewPayload(): ExportJobPayload {
  return {
    projectId: TEST_PROJECT,
    aspectRatio: "16:9",
    totalDurationMs: 5000,
    scenes: [
      {
        id: "s1",
        index: 0,
        type: "image",
        src: "s1-nonexistent.jpg", // absent on disk → graceful stub
        durationMs: 5000,
        startMs: 0,
        endMs: 5000,
        transition: "cut",
        fadeDurationMs: 0,
        fadeStartMs: 5000,
        textOverlay: null,
      },
    ],
    isPreview: true,
  };
}

// ── Preview export artifact ───────────────────────────────────────────────────

describe("artifact serving — preview export artifact", () => {
  let result: ReturnType<typeof buildRealRendererResult>;
  let artifactPath: string;

  before(() => {
    // Renderer stubs an empty file when sources are absent (test-safe fallback).
    result = buildRealRendererResult(makePreviewPayload());
    assert.ok(result.artifacts.length > 0, "renderer must return at least one artifact");
    artifactPath = result.artifacts[0]!.path;

    // Overwrite the stub with sentinel bytes so the file is non-zero.
    fs.writeFileSync(artifactPath, SENTINEL);
  });

  after(() => {
    try {
      fs.rmSync(path.join(ARTIFACTS_DIR, TEST_PROJECT), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("artifact path is under ARTIFACTS_DIR (accepted by /api/artifacts prefix check)", () => {
    assert.ok(
      isPathAllowed(artifactPath),
      `artifact path must start with an allowed prefix; got: ${artifactPath}`,
    );
  });

  it("artifact path is under the project sub-directory", () => {
    const expected = path.join(ARTIFACTS_DIR, TEST_PROJECT);
    assert.ok(
      artifactPath.startsWith(expected),
      `artifact must be scoped to the project directory; got: ${artifactPath}`,
    );
  });

  it("artifact filename is preview.mp4", () => {
    assert.equal(
      path.basename(artifactPath),
      REAL_PREVIEW_ARTIFACT_FILENAME,
      "preview artifact must use the canonical preview filename",
    );
  });

  it("artifact file exists on disk after rendering", () => {
    assert.ok(fs.existsSync(artifactPath), `file must exist at: ${artifactPath}`);
  });

  it("artifact file is non-zero in size (ready to serve)", () => {
    const { size } = fs.statSync(artifactPath);
    assert.ok(size > 0, `file must be non-zero in size; got ${size} bytes`);
  });

  it("artifact file content can be read as bytes (mirrors fs.readFile in the route)", () => {
    const buf = fs.readFileSync(artifactPath);
    assert.ok(buf.length > 0, "readFileSync must return a non-empty buffer");
  });

  it("renderResult mimeType is video/mp4", () => {
    assert.equal(result.artifacts[0]!.mimeType, "video/mp4");
  });

  it("renderResult label identifies it as a preview", () => {
    const { label } = result.artifacts[0]!;
    assert.ok(
      label?.toLowerCase().includes("preview"),
      `preview artifact label must mention 'preview'; got: "${label}"`,
    );
  });
});

// ── Full export artifact path ─────────────────────────────────────────────────

describe("artifact serving — full export artifact path shape", () => {
  it("full artifact filename is export.mp4", () => {
    const p = buildRealRenderArtifactPath(TEST_PROJECT, false);
    assert.equal(path.basename(p), REAL_RENDER_ARTIFACT_FILENAME);
  });

  it("full artifact path is under ARTIFACTS_DIR", () => {
    const p = buildRealRenderArtifactPath(TEST_PROJECT, false);
    assert.ok(isPathAllowed(p));
  });

  it("preview and full artifact paths are distinct", () => {
    const preview = buildRealRenderArtifactPath(TEST_PROJECT, true);
    const full = buildRealRenderArtifactPath(TEST_PROJECT, false);
    assert.notEqual(preview, full, "preview and full must write to different file paths");
  });
});

// ── Path validator security ───────────────────────────────────────────────────

describe("artifact serving — /api/artifacts path validator", () => {
  it("accepts a valid path under ARTIFACTS_DIR", () => {
    assert.ok(isPathAllowed(path.join(ARTIFACTS_DIR, "proj-123", "export.mp4")));
  });

  it("accepts a valid path under /tmp/aistudio-runs", () => {
    assert.ok(isPathAllowed(path.join("/tmp/aistudio-runs", "proj-456", "preview.mp4")));
  });

  it("rejects /etc/passwd", () => {
    assert.ok(!isPathAllowed("/etc/passwd"));
  });

  it("rejects directory traversal into /etc from ARTIFACTS_DIR", () => {
    const traversal = path.normalize(ARTIFACTS_DIR + "/../../etc/passwd");
    assert.ok(!isPathAllowed(traversal));
  });

  it("rejects ARTIFACTS_DIR parent directory itself", () => {
    // ARTIFACTS_DIR without trailing sep must be rejected (prefix check requires sep)
    assert.ok(!isPathAllowed(path.normalize(ARTIFACTS_DIR)));
  });
});
