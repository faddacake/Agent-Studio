/**
 * Focused tests for the export endpoint contract.
 *
 * Tests the full pipeline from scenes → RenderPlan → ExportJobPayload →
 * schema validation → stub response, without HTTP or DB involvement.
 *
 * Covers:
 *   - valid payload → accepted response structure
 *   - invalid payload → schema validation error
 *   - scene ordering and duration integrity preserved through pipeline
 *   - naturalDurationMs absent from export payload (UI-only field)
 *   - no unexpected required fields
 *
 * Run with: pnpm --filter /web test:lib
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRenderPlan } from "./renderPlan";
import { buildExportPayload } from "./exportPayload";
import { ExportJobPayloadSchema } from "@iterastudio/shared";
import type { Scene } from "./editorProjectTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function img(id: string, duration = 5, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "image", src: `${id}.jpg`, duration, ...overrides };
}

function vid(id: string, duration = 10, overrides: Partial<Scene> = {}): Scene {
  return { id, type: "video", src: `${id}.mp4`, duration, ...overrides };
}

const PROJECT_ID = "proj-abc";
const ASPECT = "16:9" as const;

/** Simulate the server pipeline: scenes → plan → payload → validation. */
function runPipeline(scenes: Scene[]) {
  const plan = buildRenderPlan(scenes);
  const payload = buildExportPayload(plan, PROJECT_ID, ASPECT);
  const result = ExportJobPayloadSchema.safeParse(payload);
  return { plan, payload, result };
}

/** Build the stub accepted response body from a validated payload. */
function acceptedBody(payload: ReturnType<typeof buildExportPayload>) {
  return {
    status: "accepted" as const,
    jobId: "stub-export",
    totalDurationMs: payload.totalDurationMs,
    sceneCount: payload.scenes.length,
  };
}

// ── Valid payload → accepted response ─────────────────────────────────────────

describe("export endpoint — valid payload → accepted response", () => {
  const { payload, result } = runPipeline([img("a", 5), img("b", 8)]);

  it("schema validation succeeds", () => assert.equal(result.success, true));

  it("response status is 'accepted'", () => {
    const body = acceptedBody(payload);
    assert.equal(body.status, "accepted");
  });

  it("jobId is the static placeholder", () => {
    const body = acceptedBody(payload);
    assert.equal(body.jobId, "stub-export");
  });

  it("totalDurationMs matches plan", () => {
    const body = acceptedBody(payload);
    assert.equal(body.totalDurationMs, (5 + 8) * 1000);
  });

  it("sceneCount matches scene list length", () => {
    const body = acceptedBody(payload);
    assert.equal(body.sceneCount, 2);
  });

  it("response has exactly the four expected fields", () => {
    const body = acceptedBody(payload);
    assert.deepEqual(Object.keys(body).sort(), ["jobId", "sceneCount", "status", "totalDurationMs"]);
  });
});

// ── Invalid payload → validation error ────────────────────────────────────────

describe("export endpoint — invalid payload → validation error", () => {
  it("rejects empty scenes array", () => {
    const result = ExportJobPayloadSchema.safeParse({
      projectId: PROJECT_ID,
      aspectRatio: ASPECT,
      totalDurationMs: 5000,
      scenes: [],
    });
    assert.equal(result.success, false);
  });

  it("rejects unknown aspectRatio", () => {
    const { payload } = runPipeline([img("a")]);
    const result = ExportJobPayloadSchema.safeParse({ ...payload, aspectRatio: "4:3" });
    assert.equal(result.success, false);
  });

  it("rejects zero totalDurationMs", () => {
    const { payload } = runPipeline([img("a")]);
    const result = ExportJobPayloadSchema.safeParse({ ...payload, totalDurationMs: 0 });
    assert.equal(result.success, false);
  });

  it("rejects scene with empty src", () => {
    const { payload } = runPipeline([img("a")]);
    const bad = { ...payload.scenes[0]!, src: "" };
    const result = ExportJobPayloadSchema.safeParse({ ...payload, scenes: [bad] });
    assert.equal(result.success, false);
  });

  it("rejects scene with unknown transition", () => {
    const { payload } = runPipeline([img("a")]);
    const bad = { ...payload.scenes[0]!, transition: "dissolve" };
    const result = ExportJobPayloadSchema.safeParse({ ...payload, scenes: [bad] });
    assert.equal(result.success, false);
  });

  it("rejects missing projectId", () => {
    const { payload } = runPipeline([img("a")]);
    const { projectId: _, ...rest } = payload;
    const result = ExportJobPayloadSchema.safeParse(rest);
    assert.equal(result.success, false);
  });
});

// ── Scene ordering and duration integrity ─────────────────────────────────────

describe("export endpoint — scene ordering and duration integrity", () => {
  const scenes = [img("a", 3), vid("b", 7), img("c", 5)];
  const { payload, result } = runPipeline(scenes);

  it("scene order matches input order", () => {
    assert.equal(result.success, true);
    assert.equal(payload.scenes[0]!.id, "a");
    assert.equal(payload.scenes[1]!.id, "b");
    assert.equal(payload.scenes[2]!.id, "c");
  });

  it("index values are 0-based sequential", () => {
    assert.equal(payload.scenes[0]!.index, 0);
    assert.equal(payload.scenes[1]!.index, 1);
    assert.equal(payload.scenes[2]!.index, 2);
  });

  it("endMs equals startMs + durationMs for every scene", () => {
    for (const scene of payload.scenes) {
      assert.equal(scene.endMs, scene.startMs + scene.durationMs);
    }
  });

  it("scenes are contiguous — each startMs equals previous endMs", () => {
    for (let i = 1; i < payload.scenes.length; i++) {
      assert.equal(payload.scenes[i]!.startMs, payload.scenes[i - 1]!.endMs);
    }
  });

  it("totalDurationMs equals sum of all scene durations", () => {
    const sum = payload.scenes.reduce((acc, s) => acc + s.durationMs, 0);
    assert.equal(payload.totalDurationMs, sum);
  });

  it("sceneCount matches actual scene array length", () => {
    const body = acceptedBody(payload);
    assert.equal(body.sceneCount, payload.scenes.length);
  });
});

// ── naturalDurationMs absent (UI-only field) ──────────────────────────────────

describe("export endpoint — naturalDurationMs absent from payload", () => {
  it("naturalDurationMs is not present on a video scene entry", () => {
    const { payload } = runPipeline([vid("v", 10, { naturalDuration: 30 })]);
    const entry = payload.scenes[0]! as Record<string, unknown>;
    assert.equal("naturalDurationMs" in entry, false);
  });

  it("naturalDurationMs is not present on an image scene entry", () => {
    const { payload } = runPipeline([img("i", 5)]);
    const entry = payload.scenes[0]! as Record<string, unknown>;
    assert.equal("naturalDurationMs" in entry, false);
  });
});

// ── No unexpected required fields ─────────────────────────────────────────────

describe("export endpoint — no unexpected required fields", () => {
  it("all aspect ratio variants are accepted", () => {
    for (const ar of ["16:9", "9:16", "1:1"] as const) {
      const plan = buildRenderPlan([img("a")]);
      const payload = buildExportPayload(plan, PROJECT_ID, ar);
      const result = ExportJobPayloadSchema.safeParse(payload);
      assert.equal(result.success, true, `aspect ratio ${ar} should be accepted`);
    }
  });

  it("single-scene payload is accepted (no minimum scene count beyond 1)", () => {
    const { result } = runPipeline([img("solo", 3)]);
    assert.equal(result.success, true);
  });

  it("fade scene with custom fadeDurationMs is accepted", () => {
    const { result } = runPipeline([
      img("a", 5, { transition: "fade", fadeDurationMs: 800 }),
      img("b", 5),
    ]);
    assert.equal(result.success, true);
  });

  it("scene with text overlay is accepted", () => {
    const { result } = runPipeline([
      img("a", 5, {
        textOverlay: { text: "Title", position: "top", style: "title" },
      }),
    ]);
    assert.equal(result.success, true);
  });

  it("scene with null textOverlay is accepted", () => {
    const { result, payload } = runPipeline([img("a", 5)]);
    assert.equal(result.success, true);
    assert.equal(payload.scenes[0]?.textOverlay, null);
  });
});
