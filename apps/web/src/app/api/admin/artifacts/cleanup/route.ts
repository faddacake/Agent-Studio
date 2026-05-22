export const runtime = "nodejs";

/**
 * GET /api/admin/artifacts/cleanup
 *
 * Returns current artifact storage usage without modifying anything.
 *   { totalBytes: number, runCount: number }
 *
 * POST /api/admin/artifacts/cleanup
 *
 * Deletes artifact directories under data/artifacts/ for runs that are either:
 *   (a) orphaned — the <runId> directory has no matching row in the runs table, or
 *   (b) older than `olderThanDays` days (based on the run's createdAt timestamp).
 *
 * Body (JSON, all optional):
 *   { olderThanDays?: number }   — also delete runs older than N days (default: none)
 *   { dryRun?: boolean }         — if true, report what would be deleted without deleting
 *
 * Returns:
 *   { deleted: string[], skipped: string[], dryRun: boolean, freedBytes: number }
 */
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";

async function dirSizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        total += stat.size;
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return total;
}

export async function GET() {
  let runCount = 0;
  let totalBytes = 0;

  try {
    const dirEntries = await fs.readdir(ARTIFACTS_DIR, { withFileTypes: true });
    const dirs = dirEntries.filter((e) => e.isDirectory());
    runCount = dirs.length;
    for (const dir of dirs) {
      totalBytes += await dirSizeBytes(path.join(ARTIFACTS_DIR, dir.name));
    }
  } catch {
    // ARTIFACTS_DIR doesn't exist yet
  }

  return NextResponse.json({ totalBytes, runCount });
}

export async function POST(req: NextRequest) {
  let body: { olderThanDays?: number; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — use defaults
  }

  const { olderThanDays, dryRun = false } = body;

  // List all run-id subdirectories under ARTIFACTS_DIR
  let entries: string[];
  try {
    const dirEntries = await fs.readdir(ARTIFACTS_DIR, { withFileTypes: true });
    entries = dirEntries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // ARTIFACTS_DIR doesn't exist yet — nothing to clean
    return NextResponse.json({ deleted: [], skipped: [], dryRun, freedBytes: 0 });
  }

  if (entries.length === 0) {
    return NextResponse.json({ deleted: [], skipped: [], dryRun, freedBytes: 0 });
  }

  // Load all known run IDs from DB (and their createdAt for age check)
  const db = getDb();
  const runs = db
    .select({ id: schema.runs.id, createdAt: schema.runs.createdAt })
    .from(schema.runs)
    .all();

  const runById = new Map(runs.map((r) => [r.id, r.createdAt]));

  const cutoffMs = olderThanDays != null
    ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    : null;

  const deleted: string[] = [];
  const skipped: string[] = [];
  let freedBytes = 0;

  for (const runId of entries) {
    const dirPath = path.join(ARTIFACTS_DIR, runId);
    const createdAt = runById.get(runId);

    const isOrphaned = createdAt === undefined;
    const isTooOld =
      cutoffMs != null &&
      createdAt != null &&
      new Date(createdAt).getTime() < cutoffMs;

    if (isOrphaned || isTooOld) {
      const bytes = await dirSizeBytes(dirPath);
      freedBytes += bytes;

      if (!dryRun) {
        try {
          await fs.rm(dirPath, { recursive: true, force: true });
        } catch (err) {
          console.error(`[artifacts/cleanup] Failed to delete ${dirPath}:`, err);
          skipped.push(runId);
          freedBytes -= bytes;
          continue;
        }
      }

      deleted.push(runId);
    } else {
      skipped.push(runId);
    }
  }

  return NextResponse.json({ deleted, skipped, dryRun, freedBytes });
}
