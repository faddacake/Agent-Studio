/**
 * Shared helpers for local image-transform executors.
 *
 * bufferFromInput — coerce any accepted image_in value to a Buffer.
 * writeArtifact  — write a Buffer to outputDir and return an ArtifactRef.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isArtifactRef, type ArtifactRef } from "@iterastudio/shared";

// ── MIME type map (sharp format name → MIME string) ──

const MIME: Record<string, string> = {
  png:  "image/png",
  jpeg: "image/jpeg",
  jpg:  "image/jpeg",
  webp: "image/webp",
  mp4:  "video/mp4",
};

// ── Buffer coercion ──

/**
 * Coerce an image_in port value to a Node.js Buffer.
 *
 * Accepts:
 * - Buffer — returned as-is
 * - Uint8Array — wrapped in Buffer.from()
 * - ArtifactRef (kind: "local-file") — file read from disk
 *
 * Throws a clear error for any other type.
 */
export async function bufferFromInput(value: unknown, port: string): Promise<Buffer> {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (isArtifactRef(value)) return fs.readFile(value.path);
  throw new Error(
    `${port}: expected Buffer, Uint8Array, or ArtifactRef — got ${typeof value}`,
  );
}

// ── Artifact writer ──

/**
 * Write a processed image Buffer to outputDir and return a serializable ArtifactRef.
 *
 * File naming:  <runId>-<nodeId>-<suffix>.<ext>
 *   e.g.  "abc123-def456-resize.png"
 *
 * runId + nodeId is unique per node execution, so files are collision-safe.
 * outputDir is created (recursively) if it does not exist.
 */
export async function writeArtifact(opts: {
  buffer:    Buffer;
  outputDir: string;
  runId:     string;
  nodeId:    string;
  suffix:    string;   // "resize" | "crop" | "format-convert"
  format:    string;   // "png" | "jpeg" | "webp"
  width?:    number;
  height?:   number;
}): Promise<ArtifactRef> {
  const ext      = opts.format === "jpeg" ? "jpg" : opts.format;
  const filename = `${opts.runId}-${opts.nodeId}-${opts.suffix}.${ext}`;
  const filePath = path.join(opts.outputDir, filename);

  await fs.mkdir(opts.outputDir, { recursive: true });
  await fs.writeFile(filePath, opts.buffer);

  return {
    kind:      "local-file",
    path:      filePath,
    mimeType:  MIME[opts.format] ?? `image/${opts.format}`,
    filename,
    sizeBytes: opts.buffer.length,
    width:     opts.width,
    height:    opts.height,
  };
}
