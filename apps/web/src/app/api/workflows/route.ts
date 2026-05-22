export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema, sql } from "@iterastudio/db";

function parseTags(raw: string | null | undefined): string[] {
  try { return JSON.parse(raw ?? "[]") ?? []; } catch { return []; }
}

function graphHasProvenanceNodes(graphJson: string | null | undefined): boolean {
  if (!graphJson) return false;
  try {
    const g: { nodes?: Array<{ data?: { params?: Record<string, unknown> } }> } = JSON.parse(graphJson);
    return (g.nodes ?? []).some((n) => n.data?.params?.__provenance != null);
  } catch { return false; }
}

// GET /api/workflows — list all non-deleted workflows
export async function GET() {
  const db = getDb();
  const rows = db
    .select({
      id: schema.workflows.id,
      name: schema.workflows.name,
      description: schema.workflows.description,
      tags: schema.workflows.tags,
      isPinned: schema.workflows.isPinned,
      lastRunStatus: schema.workflows.lastRunStatus,
      lastRunAt: schema.workflows.lastRunAt,
      lastRunError: schema.workflows.lastRunError,
      updatedAt: schema.workflows.updatedAt,
      createdAt: schema.workflows.createdAt,
      graph: schema.workflows.graph,
    })
    .from(schema.workflows)
    .where(sql`${schema.workflows.deletedAt} IS NULL`)
    .all();

  // Single grouped query — no N+1
  const revisionCountRows = db
    .select({
      workflowId: schema.workflowRevisions.workflowId,
      count: sql<number>`count(*)`,
    })
    .from(schema.workflowRevisions)
    .groupBy(schema.workflowRevisions.workflowId)
    .all();
  const revisionCountMap = new Map(revisionCountRows.map((r) => [r.workflowId, r.count]));

  const parsed = rows.map(({ graph, ...r }) => ({
    ...r,
    tags: parseTags(r.tags),
    hasProvenanceNodes: graphHasProvenanceNodes(graph),
    revisionCount: revisionCountMap.get(r.id) ?? 0,
  }));
  return NextResponse.json(parsed);
}

// POST /api/workflows — create a new workflow
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, graph } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Workflow name is required" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const emptyGraph = JSON.stringify({ version: 1, nodes: [], edges: [] });
  const graphStr =
    graph && typeof graph === "object" ? JSON.stringify(graph) : emptyGraph;

  const db = getDb();
  db.insert(schema.workflows)
    .values({
      id,
      name: name.trim(),
      description: description?.trim() || "",
      graph: graphStr,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return NextResponse.json({ id, name: name.trim() }, { status: 201 });
}
