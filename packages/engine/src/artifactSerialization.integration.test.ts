/**
 * Artifact serialization E2E test.
 *
 * Verifies the full guarantee introduced by the ArtifactRef contract:
 *
 * 1. Local transform outputs are JSON-serializable (no Buffer in image_out)
 * 2. Chained local transforms (resize → crop → format-convert) produce
 *    fully serializable outputs at every step
 * 3. RunState / nodeState.outputs contain no Buffer values after execution
 *    through the RunCoordinator
 * 4. CandidateCollection wrapping an ArtifactRef is JSON-serializable
 * 5. ExportBundle manifest is serializable when image candidates are present
 *
 * All transforms use in-memory fixture images as source; artifacts are
 * written to /tmp. No external services or network calls.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";

import {
  isArtifactRef,
  type ArtifactRef,
  type NodeExecutionContext,
  nodeRegistry,
  NodeRuntimeKind,
  NodeCategory,
  ensureCollection,
  isCandidateCollection,
  type CandidateCollection,
} from "@iterastudio/shared";

import { RunCoordinator, type DispatchJob, type RunState } from "./runCoordinator.js";
import { NodeExecutor } from "./executor.js";
import { executeResize }        from "./local/resize.js";
import { executeCrop }          from "./local/crop.js";
import { executeFormatConvert } from "./local/formatConvert.js";
import { executeExportBundle }  from "./capabilities/exportBundle.js";

// ── Constants ──

const OUTPUT_DIR = "/tmp/aistudio-test";

// ── Helpers ──

function makeCtx(
  imageInput: Buffer | ArtifactRef,
  params: Record<string, unknown>,
  ids?: { nodeId?: string; runId?: string },
): NodeExecutionContext {
  return {
    nodeId:    ids?.nodeId ?? crypto.randomUUID(),
    runId:     ids?.runId  ?? "serial-test",
    inputs:    { image_in: imageInput },
    params,
    outputDir: OUTPUT_DIR,
  };
}

/**
 * Deep-check that a value contains no Buffer instances.
 * Traverses plain objects and arrays recursively.
 * Returns true if the value is Buffer-free.
 */
function isBufferFree(value: unknown, path = "root"): boolean {
  if (Buffer.isBuffer(value)) {
    throw new Error(`Buffer found at ${path}`);
  }
  if (value instanceof Uint8Array) {
    throw new Error(`Uint8Array found at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => isBufferFree(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      isBufferFree(v, `${path}.${k}`);
    }
  }
  return true;
}

// ── Fixture ──

let srcPng: Buffer;

// ── Suites ──

describe("Artifact serialization contract", () => {
  before(async () => {
    srcPng = await sharp({
      create: {
        width:      100,
        height:     100,
        channels:   3,
        background: { r: 128, g: 64, b: 192 },
      },
    })
      .png()
      .toBuffer();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Individual executor output shapes
  // ──────────────────────────────────────────────────────────────────────────

  describe("individual executor outputs are JSON-serializable", () => {
    it("resize output contains ArtifactRef, no Buffer", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 60, height: 60 }),
        {} as never,
      );

      assert.ok(isArtifactRef(result.outputs.image_out),
        "resize image_out must be ArtifactRef");

      assert.doesNotThrow(
        () => JSON.stringify(result.outputs),
        "resize outputs must be JSON.stringify-safe",
      );
      isBufferFree(result.outputs); // throws if Buffer found
    });

    it("crop output contains ArtifactRef, no Buffer", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 5, y: 5, width: 30, height: 30 }),
        {} as never,
      );

      assert.ok(isArtifactRef(result.outputs.image_out),
        "crop image_out must be ArtifactRef");

      assert.doesNotThrow(() => JSON.stringify(result.outputs));
      isBufferFree(result.outputs);
    });

    it("format-convert output contains ArtifactRef, no Buffer", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "webp", quality: 85 }),
        {} as never,
      );

      assert.ok(isArtifactRef(result.outputs.image_out),
        "format-convert image_out must be ArtifactRef");

      assert.doesNotThrow(() => JSON.stringify(result.outputs));
      isBufferFree(result.outputs);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Chained pipeline — ArtifactRef flows between nodes
  // ──────────────────────────────────────────────────────────────────────────

  describe("chained transforms produce serializable ArtifactRef at every step", () => {
    it("resize → crop → format-convert: all outputs are ArtifactRef, none contain Buffer", async () => {
      const runId = "chain-" + crypto.randomUUID().slice(0, 8);

      // Step 1: resize
      const r1 = await executeResize(
        makeCtx(srcPng, { width: 80, height: 80 }, { runId }),
        {} as never,
      );
      isBufferFree(r1.outputs);
      const ref1 = r1.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(ref1), "resize output is ArtifactRef");

      // Step 2: crop (accepts ArtifactRef input)
      const r2 = await executeCrop(
        makeCtx(ref1, { x: 0, y: 0, width: 40, height: 40 }, { runId }),
        {} as never,
      );
      isBufferFree(r2.outputs);
      const ref2 = r2.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(ref2), "crop output is ArtifactRef");

      // Step 3: format-convert (accepts ArtifactRef input)
      const r3 = await executeFormatConvert(
        makeCtx(ref2, { format: "jpeg", quality: 80 }, { runId }),
        {} as never,
      );
      isBufferFree(r3.outputs);
      const ref3 = r3.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(ref3), "format-convert output is ArtifactRef");

      // Verify the complete chain is JSON.stringify-safe
      const allOutputs = { r1: r1.outputs, r2: r2.outputs, r3: r3.outputs };
      assert.doesNotThrow(
        () => JSON.stringify(allOutputs),
        "all chained outputs must be JSON.stringify-safe together",
      );

      // Verify final dimensions
      assert.equal(ref3.width,  40, "final width after crop");
      assert.equal(ref3.height, 40, "final height after crop");
      assert.equal(ref3.mimeType, "image/jpeg", "final mimeType should be jpeg");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. RunCoordinator: nodeState.outputs contain no Buffer after a run
  // ──────────────────────────────────────────────────────────────────────────

  describe("RunCoordinator: nodeState outputs are Buffer-free after local transform run", () => {
    const TYPE_SRC    = "serial-source";
    const TYPE_RESIZE = "serial-resize";

    const NODE_SRC    = crypto.randomUUID();
    const NODE_RESIZE = crypto.randomUUID();

    let executor: NodeExecutor;
    let coordinator: RunCoordinator;
    let run: RunState;

    before(() => {
      nodeRegistry.clear();

      const base = {
        version: 1 as const,
        category: NodeCategory.Utility,
        description: "test",
        inputs: [],
        outputs: [],
        parameterSchema: [],
        tags: [],
        isAvailable: true,
      };

      nodeRegistry.register({
        ...base,
        type: TYPE_SRC,
        label: "Serial Source",
        runtimeKind: NodeRuntimeKind.Local,
        outputs: [{ id: "image_out", name: "Image", type: "image", direction: "output" as const }],
      });

      nodeRegistry.register({
        ...base,
        type: TYPE_RESIZE,
        label: "Serial Resize",
        runtimeKind: NodeRuntimeKind.Local,
        inputs:  [{ id: "image_in",  name: "Image", type: "image", direction: "input"  as const }],
        outputs: [{ id: "image_out", name: "Image", type: "image", direction: "output" as const }],
      });

      executor = new NodeExecutor();

      // Source: returns a real Buffer (simulates image provider output)
      executor.registerLocal(TYPE_SRC, async () => ({
        outputs: { image_out: srcPng },  // Buffer — should be replaced by resize
        cost: 0,
      }));

      // Resize: uses the real executeResize (converts Buffer → ArtifactRef)
      executor.registerLocal(TYPE_RESIZE, async (ctx) => {
        return executeResize(ctx, {} as never);
      });

      coordinator = new RunCoordinator();
    });

    after(() => {
      nodeRegistry.clear();
    });

    it("node outputs are ArtifactRef after running through coordinator", async () => {
      const workflow = {
        version: 1 as const,
        nodes: [
          {
            id: NODE_SRC,
            type: TYPE_SRC,
            position: { x: 0, y: 0 },
            data: {
              label: "Source",
              params: { __nodeType: TYPE_SRC },
              retryCount: 0,
              timeoutMs: 5000,
            },
            inputs: [],
            outputs: [{ id: "image_out", name: "Image", type: "image", direction: "output" as const }],
          },
          {
            id: NODE_RESIZE,
            type: TYPE_RESIZE,
            position: { x: 200, y: 0 },
            data: {
              label: "Resize",
              params: { __nodeType: TYPE_RESIZE, width: 40, height: 40 },
              retryCount: 0,
              timeoutMs: 5000,
            },
            inputs:  [{ id: "image_in",  name: "Image", type: "image", direction: "input"  as const }],
            outputs: [{ id: "image_out", name: "Image", type: "image", direction: "output" as const }],
          },
        ],
        edges: [
          {
            id: crypto.randomUUID(),
            source: NODE_SRC,
            sourceHandle: "image_out",
            target: NODE_RESIZE,
            targetHandle: "image_in",
          },
        ],
      };

      run = coordinator.createRun({
        runId: "serial-coord-run",
        workflowId: "serial-workflow",
        workflow,
      });

      const dispatch: DispatchJob = async (job) => {
        const nodeState = run.nodeStates.get(job.nodeId)!;
        nodeState.status = "running";
        nodeState.startedAt = Date.now();

        try {
          const ctx: NodeExecutionContext = {
            nodeId:    job.nodeId,
            runId:     job.runId,
            inputs:    job.inputs,
            params:    job.params,
            outputDir: OUTPUT_DIR,
          };
          const result = await executor.execute(ctx);
          await coordinator.onNodeCompleted(job.runId, job.nodeId, result.outputs, result.cost, dispatch);
        } catch (err) {
          await coordinator.onNodeFailed(job.runId, job.nodeId,
            err instanceof Error ? err.message : String(err), dispatch);
        }
      };

      await coordinator.startRun("serial-coord-run", dispatch);

      assert.equal(run.status, "completed", `run should be completed (got: ${run.status})`);

      // The resize nodeState.outputs.image_out must be an ArtifactRef
      const resizeState = run.nodeStates.get(NODE_RESIZE)!;
      assert.ok(isArtifactRef(resizeState.outputs.image_out),
        "resize nodeState.outputs.image_out must be ArtifactRef");

      // The entire nodeState.outputs must be Buffer-free
      isBufferFree(resizeState.outputs);
      assert.doesNotThrow(
        () => JSON.stringify(resizeState.outputs),
        "resize nodeState.outputs must be JSON.stringify-safe",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CandidateCollection wrapping ArtifactRef is serializable
  // ──────────────────────────────────────────────────────────────────────────

  describe("CandidateCollection with ArtifactRef value is JSON-serializable", () => {
    it("ensureCollection wraps ArtifactRef into a serializable CandidateCollection", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 50, height: 50 }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;

      // Wrap via the candidate helper (simulates clipScoring receiving image_out)
      const collection = ensureCollection(ref, "image", "test-node");

      assert.ok(isCandidateCollection(collection), "should be a CandidateCollection");
      assert.equal(collection.items.length, 1, "should wrap one candidate");
      assert.ok(isArtifactRef(collection.items[0].value),
        "candidate item.value should be the ArtifactRef");

      // The collection must be JSON-serializable
      assert.doesNotThrow(
        () => JSON.stringify(collection),
        "CandidateCollection with ArtifactRef must be JSON.stringify-safe",
      );
      isBufferFree(collection);
    });

    it("CandidateCollection with multiple ArtifactRef items is fully serializable", async () => {
      // Run two resizes to get two distinct ArtifactRefs
      const [r1, r2] = await Promise.all([
        executeResize(makeCtx(srcPng, { width: 30, height: 30 }), {} as never),
        executeResize(makeCtx(srcPng, { width: 20, height: 20 }), {} as never),
      ]);

      const refs = [r1.outputs.image_out, r2.outputs.image_out];

      // Simulate what a generation node would produce: array of values wrapped by ensureCollection
      const collection = ensureCollection(refs, "image", "gen-node") as CandidateCollection;

      assert.equal(collection.items.length, 2, "should have 2 candidates");
      for (const item of collection.items) {
        assert.ok(isArtifactRef(item.value), "each item.value must be ArtifactRef");
      }

      assert.doesNotThrow(() => JSON.stringify(collection));
      isBufferFree(collection);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ExportBundle manifest is serializable when image candidates are present
  // ──────────────────────────────────────────────────────────────────────────

  describe("ExportBundle manifest is JSON-serializable with ArtifactRef candidates", () => {
    it("manifest built from ArtifactRef candidates has no Buffer in assetRef", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 64, height: 64 }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;

      // Build a CandidateCollection with a real ArtifactRef value
      const collection = ensureCollection(ref, "image", "gen-node");

      // Run ExportBundle
      const exportCtx: NodeExecutionContext = {
        nodeId:    crypto.randomUUID(),
        runId:     "export-serial-test",
        inputs:    { candidates_in: collection },
        params:    { bundleName: "test-bundle", format: "manifest-only" },
        outputDir: OUTPUT_DIR,
      };

      const exportResult = await executeExportBundle(exportCtx, {} as never);

      const manifest = exportResult.outputs.bundle_out as Record<string, unknown>;

      // The manifest itself must be JSON-serializable
      assert.doesNotThrow(
        () => JSON.stringify(manifest),
        "export bundle manifest must be JSON.stringify-safe",
      );
      isBufferFree(manifest);

      // The assetRef in each asset must be an ArtifactRef (not a Buffer)
      const assets = manifest.assets as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(assets) && assets.length > 0, "manifest should have assets");
      for (const asset of assets) {
        assert.ok(isArtifactRef(asset.assetRef),
          "asset.assetRef should be an ArtifactRef, not a raw value");
        assert.ok(!Buffer.isBuffer(asset.assetRef),
          "asset.assetRef must not be a Buffer");
      }
    });
  });
});
