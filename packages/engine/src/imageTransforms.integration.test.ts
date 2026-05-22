/**
 * Image transform local executor tests.
 *
 * Verifies that resize, crop, and format-convert executors:
 * - return an ArtifactRef (not a raw Buffer) as image_out
 * - write files to outputDir with correct dimensions and format
 * - honour all parameter values
 * - carry correct metadata (format, mimeType, region, fit)
 * - accept ArtifactRef as image_in (chaining from disk)
 *
 * A minimal 100 × 100 RGB PNG is synthesised via sharp before each
 * suite and stored as a plain Buffer. Executors write to /tmp.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";
import fs from "node:fs/promises";

import { executeResize }        from "./local/resize.js";
import { executeCrop }          from "./local/crop.js";
import { executeFormatConvert } from "./local/formatConvert.js";

import { isArtifactRef, type ArtifactRef, type NodeExecutionContext } from "@iterastudio/shared";

// ── Helpers ──

const OUTPUT_DIR = "/tmp/aistudio-test";

/**
 * Build a NodeExecutionContext for a local executor test.
 * Each call gets a unique nodeId to prevent file collisions between tests.
 */
function makeCtx(
  imageInput: Buffer | ArtifactRef,
  params: Record<string, unknown>,
): NodeExecutionContext {
  return {
    nodeId:    crypto.randomUUID(),
    runId:     "imgtest",
    inputs:    { image_in: imageInput },
    params,
    outputDir: OUTPUT_DIR,
  };
}

// ── Fixture ──

let srcPng: Buffer; // 100 × 100 red PNG, created once before all tests

// ── Suites ──

describe("Local executors: image transforms", () => {
  before(async () => {
    // Create a 100 × 100 solid-red PNG entirely in memory.
    srcPng = await sharp({
      create: {
        width:      100,
        height:     100,
        channels:   3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const srcMeta = await sharp(srcPng).metadata();
    assert.equal(srcMeta.width,  100, "fixture: source width should be 100");
    assert.equal(srcMeta.height, 100, "fixture: source height should be 100");
    assert.equal(srcMeta.format, "png", "fixture: source format should be png");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // resize
  // ────────────────────────────────────────────────────────────────────────────

  describe("resize executor", () => {
    it("returns an ArtifactRef (not a Buffer) as image_out", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 50, height: 50, fit: "cover" }),
        {} as never,
      );
      const ref = result.outputs.image_out;
      assert.ok(isArtifactRef(ref), "image_out should be an ArtifactRef");
      assert.ok(!Buffer.isBuffer(ref), "image_out must NOT be a raw Buffer");
    });

    it("produces output file with exact requested dimensions (cover fit)", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 50, height: 50, fit: "cover" }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      // Verify the written file has correct dimensions
      const meta = await sharp(ref.path).metadata();
      assert.equal(meta.width,  50, "resized width should be 50");
      assert.equal(meta.height, 50, "resized height should be 50");
    });

    it("honours a non-square target (contain fit)", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 200, height: 80, fit: "contain" }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      assert.equal(ref.width,  200, "ArtifactRef.width should be 200");
      assert.equal(ref.height, 80,  "ArtifactRef.height should be 80");
    });

    it("result metadata carries correct dimensions and fit", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 40, height: 60, fit: "fill" }),
        {} as never,
      );
      assert.equal(result.metadata?.width,  40,     "metadata.width should be 40");
      assert.equal(result.metadata?.height, 60,     "metadata.height should be 60");
      assert.equal(result.metadata?.fit,    "fill",  "metadata.fit should match param");
    });

    it("ArtifactRef carries mimeType and path", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 20, height: 20 }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      assert.equal(ref.kind,     "local-file",  "kind should be local-file");
      assert.equal(ref.mimeType, "image/png",   "mimeType should be image/png");
      assert.ok(ref.path.startsWith(OUTPUT_DIR), "path should be inside outputDir");
      assert.ok(ref.filename.endsWith(".png"),    "filename should end with .png");
      assert.ok(typeof ref.sizeBytes === "number" && ref.sizeBytes > 0, "sizeBytes should be set");
    });

    it("defaults unknown fit value to cover without throwing", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 30, height: 30, fit: "invalid-mode" }),
        {} as never,
      );
      assert.equal(result.metadata?.width,  30, "should still produce 30-wide output");
      assert.equal(result.metadata?.height, 30, "should still produce 30-tall output");
    });

    it("cost is always 0 (local, no external calls)", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 10, height: 10 }),
        {} as never,
      );
      assert.equal(result.cost, 0, "local executor should report cost 0");
    });

    it("output is JSON-serializable (no Buffer in outputs)", async () => {
      const result = await executeResize(
        makeCtx(srcPng, { width: 10, height: 10 }),
        {} as never,
      );
      assert.doesNotThrow(
        () => JSON.stringify(result.outputs),
        "result.outputs must be JSON-serializable",
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // crop
  // ────────────────────────────────────────────────────────────────────────────

  describe("crop executor", () => {
    it("returns an ArtifactRef as image_out", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 10, y: 20, width: 30, height: 40 }),
        {} as never,
      );
      assert.ok(isArtifactRef(result.outputs.image_out), "image_out should be an ArtifactRef");
    });

    it("extracts a region with the exact requested dimensions", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 10, y: 20, width: 30, height: 40 }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      const meta = await sharp(ref.path).metadata();
      assert.equal(meta.width,  30, "cropped width should be 30");
      assert.equal(meta.height, 40, "cropped height should be 40");
    });

    it("result metadata carries region with x/y mapped to left/top", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 5, y: 10, width: 20, height: 25 }),
        {} as never,
      );
      const region = result.metadata?.region as Record<string, number>;
      assert.equal(region.left,   5,  "metadata.region.left should match x param");
      assert.equal(region.top,    10, "metadata.region.top should match y param");
      assert.equal(region.width,  20, "metadata.region.width");
      assert.equal(region.height, 25, "metadata.region.height");
    });

    it("extracts full source dimensions when region covers the whole image", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 0, y: 0, width: 100, height: 100 }),
        {} as never,
      );
      assert.equal(result.metadata?.width,  100, "full-image crop width should be 100");
      assert.equal(result.metadata?.height, 100, "full-image crop height should be 100");
    });

    it("cost is always 0", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 0, y: 0, width: 50, height: 50 }),
        {} as never,
      );
      assert.equal(result.cost, 0);
    });

    it("output is JSON-serializable", async () => {
      const result = await executeCrop(
        makeCtx(srcPng, { x: 0, y: 0, width: 20, height: 20 }),
        {} as never,
      );
      assert.doesNotThrow(() => JSON.stringify(result.outputs));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // format-convert
  // ────────────────────────────────────────────────────────────────────────────

  describe("format-convert executor", () => {
    it("converts PNG → JPEG and returns ArtifactRef with correct mimeType", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "jpeg", quality: 80 }),
        {} as never,
      );
      assert.ok(isArtifactRef(result.outputs.image_out), "image_out should be ArtifactRef");
      const ref = result.outputs.image_out as ArtifactRef;
      assert.equal(ref.mimeType,          "image/jpeg", "mimeType should be image/jpeg");
      assert.equal(result.metadata?.format,   "jpeg",       "metadata.format should be jpeg");
      assert.equal(result.metadata?.mimeType, "image/jpeg", "metadata.mimeType should be image/jpeg");
      // Verify the file is actually JPEG
      const meta = await sharp(ref.path).metadata();
      assert.equal(meta.format, "jpeg", "written file format should be jpeg");
    });

    it("converts PNG → WebP and reports correct format", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "webp", quality: 75 }),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      assert.equal(ref.mimeType, "image/webp", "mimeType should be image/webp");
      const meta = await sharp(ref.path).metadata();
      assert.equal(meta.format, "webp", "written file format should be webp");
    });

    it("converts PNG → PNG (re-encode) and preserves dimensions", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "png" }),
        {} as never,
      );
      assert.equal(result.metadata?.width,  100, "png re-encode should preserve width");
      assert.equal(result.metadata?.height, 100, "png re-encode should preserve height");
    });

    it("defaults to PNG when format param is omitted", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, {}),
        {} as never,
      );
      const ref = result.outputs.image_out as ArtifactRef;
      assert.equal(ref.mimeType, "image/png", "default mimeType should be image/png");
    });

    it("preserves source dimensions through format conversion", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "jpeg" }),
        {} as never,
      );
      assert.equal(result.metadata?.width,  100, "dimensions preserved through conversion");
      assert.equal(result.metadata?.height, 100, "dimensions preserved through conversion");
    });

    it("cost is always 0", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "png" }),
        {} as never,
      );
      assert.equal(result.cost, 0);
    });

    it("output is JSON-serializable", async () => {
      const result = await executeFormatConvert(
        makeCtx(srcPng, { format: "webp" }),
        {} as never,
      );
      assert.doesNotThrow(() => JSON.stringify(result.outputs));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Chaining: resize → crop → format-convert (via ArtifactRef)
  // ────────────────────────────────────────────────────────────────────────────

  describe("executor chaining (resize → crop → format-convert via ArtifactRef)", () => {
    it("pipelines three transforms via ArtifactRef — no raw Buffer crosses node boundaries", async () => {
      // 1. resize 100×100 → 80×80
      const resized = await executeResize(
        makeCtx(srcPng, { width: 80, height: 80, fit: "cover" }),
        {} as never,
      );
      const resizedRef = resized.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(resizedRef), "resize output should be ArtifactRef");

      // 2. crop — accepts ArtifactRef directly as image_in
      const cropped = await executeCrop(
        makeCtx(resizedRef, { x: 0, y: 0, width: 40, height: 40 }),
        {} as never,
      );
      const croppedRef = cropped.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(croppedRef), "crop output should be ArtifactRef");

      // 3. format-convert — accepts ArtifactRef
      const converted = await executeFormatConvert(
        makeCtx(croppedRef, { format: "webp", quality: 85 }),
        {} as never,
      );
      const finalRef = converted.outputs.image_out as ArtifactRef;
      assert.ok(isArtifactRef(finalRef), "format-convert output should be ArtifactRef");

      // Verify final file dimensions and format
      const meta = await sharp(finalRef.path).metadata();
      assert.equal(meta.format, "webp", "final output should be webp");
      assert.equal(meta.width,  40,     "final width should be 40 after crop");
      assert.equal(meta.height, 40,     "final height should be 40 after crop");

      // Verify all three outputs are JSON-serializable
      assert.doesNotThrow(() => JSON.stringify(resized.outputs),   "resize outputs serializable");
      assert.doesNotThrow(() => JSON.stringify(cropped.outputs),   "crop outputs serializable");
      assert.doesNotThrow(() => JSON.stringify(converted.outputs), "format-convert outputs serializable");

      // Verify all files actually exist on disk
      await assert.doesNotReject(fs.access(resizedRef.path));
      await assert.doesNotReject(fs.access(croppedRef.path));
      await assert.doesNotReject(fs.access(finalRef.path));
    });
  });
});
