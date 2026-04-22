export const runtime = "nodejs";

/**
 * GET /api/artifacts?path=<absolute-path>
 *
 * Serves a local artifact file produced by the engine (e.g. generated images,
 * rendered MP4 exports).
 *
 * Allowed prefixes:
 *   1. ARTIFACTS_DIR (apps/web/data/artifacts/) — durable storage, survives restarts
 *   2. /tmp/aistudio-runs/                      — legacy transient storage; refs
 *      written before the durable-storage change still work as long as the
 *      server has not restarted since those files were written.
 *
 * All other paths are rejected with 403.
 *
 * HTTP range requests (RFC 7233) are supported so browsers can seek within MP4
 * files without re-downloading from the start. Only single-range `bytes=` requests
 * are handled; multi-range requests fall back to a full 200 response.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";

const ALLOWED_PREFIXES = [
  path.normalize(ARTIFACTS_DIR) + path.sep,
  path.normalize("/tmp/aistudio-runs") + path.sep,
];

const MIME_BY_EXT: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4":  "video/mp4",
};

/** Parse a `Range: bytes=<start>-<end>` header into numeric bounds. */
function parseByteRange(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  let start = startStr !== "" ? parseInt(startStr, 10) : fileSize - parseInt(endStr, 10);
  let end   = endStr   !== "" ? parseInt(endStr,   10) : fileSize - 1;

  // Clamp and validate
  end = Math.min(end, fileSize - 1);
  if (isNaN(start) || isNaN(end) || start > end || start < 0) return null;

  return { start, end };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return new Response("Missing path parameter", { status: 400 });
  }

  // Normalize to resolve any ".." components and validate the prefix
  const normalized = path.normalize(filePath);
  const allowed = ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!allowed) {
    return new Response("Forbidden", { status: 403 });
  }

  const ext = path.extname(normalized).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";

  // Stat the file first so we can serve Content-Length and handle range requests
  // without reading the whole file into memory.
  let fileSize: number;
  try {
    const stat = await fs.stat(normalized);
    fileSize = stat.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const rangeHeader = req.headers.get("range");

  // ── Range request (206 Partial Content) ──────────────────────────────────
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, fileSize);
    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const { start, end } = range;
    const chunkSize = end - start + 1;

    // Read only the requested byte slice
    let chunk: Buffer;
    try {
      const fd = await fs.open(normalized, "r");
      try {
        chunk = Buffer.allocUnsafe(chunkSize);
        await fd.read(chunk, 0, chunkSize, start);
      } finally {
        await fd.close();
      }
    } catch {
      return new Response("Not found", { status: 404 });
    }

    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  }

  // ── Full file (200 OK) ────────────────────────────────────────────────────
  try {
    const buffer = await fs.readFile(normalized);
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
