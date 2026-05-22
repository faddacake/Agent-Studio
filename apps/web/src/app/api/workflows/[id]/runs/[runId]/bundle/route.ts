export const runtime = "nodejs";

/**
 * GET /api/workflows/:id/runs/:runId/bundle
 *
 * Downloads a ZIP archive containing all image artifacts produced by a
 * completed run, plus a metadata.json manifest.
 *
 * Bundle contents:
 *   metadata.json      — run summary, node costs/durations, artifact count
 *   <node-label>.png   — one file per image-producing node (deduplicated)
 *
 * Path safety: artifact files are validated against the same allowed-prefix
 * list used by /api/artifacts before being read.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@iterastudio/db";
import { extractImageRefs } from "@/lib/artifactRefs";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";

const ALLOWED_PREFIXES = [
  path.normalize(ARTIFACTS_DIR) + path.sep,
  path.normalize("/tmp/aistudio-runs") + path.sep,
];

function isAllowedPath(p: string): boolean {
  const norm = path.normalize(p);
  return ALLOWED_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

// ── Shared bundle-building helper ─────────────────────────────────────────────

/**
 * Build and return a ZIP Response for a run.
 *
 * @param pathFilter  When provided, only artifact files whose filesystem path
 *                    appears in this set are included.  null/undefined = all.
 */
async function buildBundleResponse(
  runId: string,
  workflowId: string,
  pathFilter?: ReadonlySet<string> | null,
): Promise<Response> {
  const db = getDb();

  // ── Run header ──────────────────────────────────────────────────────────────
  const run = db
    .select({
      id:            schema.runs.id,
      status:        schema.runs.status,
      totalCost:     schema.runs.totalCost,
      startedAt:     schema.runs.startedAt,
      completedAt:   schema.runs.completedAt,
      graphSnapshot: schema.runs.graphSnapshot,
    })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get();

  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  // ── Node labels from graph snapshot ─────────────────────────────────────────
  const nodeLabels: Record<string, string> = {};
  try {
    const graph = JSON.parse(run.graphSnapshot) as {
      nodes?: Array<{ id: string; data?: { label?: string } }>;
    };
    for (const node of graph.nodes ?? []) {
      if (node.id && node.data?.label) nodeLabels[node.id] = node.data.label;
    }
  } catch {
    // Non-fatal — labels fall back to nodeId
  }

  // ── Completed node executions with persisted outputs ─────────────────────────
  const allNodeExecs = db
    .select({
      nodeId:      schema.nodeExecutions.nodeId,
      status:      schema.nodeExecutions.status,
      cost:        schema.nodeExecutions.cost,
      startedAt:   schema.nodeExecutions.startedAt,
      completedAt: schema.nodeExecutions.completedAt,
      providerId:  schema.nodeExecutions.providerId,
      modelId:     schema.nodeExecutions.modelId,
      outputs:     schema.nodeExecutions.outputs,
    })
    .from(schema.nodeExecutions)
    .where(
      and(
        eq(schema.nodeExecutions.runId, runId),
        eq(schema.nodeExecutions.status, "completed"),
      ),
    )
    .all();

  // ── Collect image artifact refs — apply optional path-level filter ──────────
  interface ArtifactEntry { path: string; filename: string; nodeLabel: string }
  const artifacts: ArtifactEntry[] = [];

  for (const ne of allNodeExecs) {
    if (!ne.outputs) continue;
    let outputs: Record<string, unknown>;
    try {
      outputs = JSON.parse(ne.outputs) as Record<string, unknown>;
    } catch {
      continue;
    }
    const label = nodeLabels[ne.nodeId] ?? ne.nodeId;
    const refs = Object.values(outputs).flatMap((v) => extractImageRefs(v));
    for (const ref of refs) {
      // Skip files the user deselected; null filter = include everything
      if (pathFilter && !pathFilter.has(ref.path)) continue;
      artifacts.push({ path: ref.path, filename: ref.filename, nodeLabel: label });
    }
  }

  // ── Build ZIP ────────────────────────────────────────────────────────────────
  const zipFiles: Record<string, Uint8Array> = {};

  // metadata.json
  const metadata = {
    runId,
    workflowId,
    exportedAt: new Date().toISOString(),
    status: run.status,
    totalCost: run.totalCost,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    nodes: allNodeExecs.map((ne) => ({
      nodeId:     ne.nodeId,
      label:      nodeLabels[ne.nodeId] ?? ne.nodeId,
      status:     ne.status,
      cost:       ne.cost,
      providerId: ne.providerId,
      modelId:    ne.modelId,
    })),
    artifactCount: artifacts.length,
  };
  zipFiles["metadata.json"] = new TextEncoder().encode(JSON.stringify(metadata, null, 2));

  // Artifact files — validate paths, read, deduplicate names
  const usedNames = new Set<string>();
  for (const { path: artifactPath, filename, nodeLabel } of artifacts) {
    const normalized = path.normalize(artifactPath);
    if (!isAllowedPath(normalized)) continue;

    try {
      const buffer = await fs.readFile(normalized);
      const ext = path.extname(filename || artifactPath) || ".png";
      const base = nodeLabel
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase()
        .replace(/^-|-$/g, "") || "artifact";
      let name = `${base}${ext}`;
      if (usedNames.has(name)) {
        let n = 2;
        while (usedNames.has(`${base}-${n}${ext}`)) n++;
        name = `${base}-${n}${ext}`;
      }
      usedNames.add(name);
      zipFiles[name] = new Uint8Array(buffer);
    } catch {
      // File not found or unreadable — skip silently
    }
  }

  const zipBuffer = Buffer.from(zipSync(zipFiles));
  const safeRunId = runId.slice(0, 8);

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="run-${safeRunId}.zip"`,
    },
  });
}

// ── Route handlers ─────────────────────────────────────────────────────────────

/** GET — download all artifacts (no filtering). Preserved for backward compatibility. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: workflowId, runId } = await params;
  return buildBundleResponse(runId, workflowId);
}

/**
 * POST — download a filtered artifact bundle.
 *
 * Body: `{ paths?: string[] }`
 * When `paths` is provided, only the artifact files at those filesystem paths
 * are included.  When absent or null, behaviour matches GET (all artifacts).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: workflowId, runId } = await params;

  let pathFilter: ReadonlySet<string> | null = null;
  try {
    const body = (await req.json()) as { paths?: string[] };
    if (Array.isArray(body.paths) && body.paths.length > 0) {
      pathFilter = new Set(body.paths);
    }
  } catch {
    // Malformed body — fall back to "include all" (same as GET)
  }

  return buildBundleResponse(runId, workflowId, pathFilter);
}
