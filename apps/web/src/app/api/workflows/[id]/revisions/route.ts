export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { eq, desc } from "drizzle-orm";

interface RevisionGraphStats {
  nodeCount: number;
  edgeCount: number;
  nodeIds: string[];
}

function parseGraphStats(snapshot: string): RevisionGraphStats {
  try {
    const g: { nodes?: Array<{ id?: string }>; edges?: unknown[] } = JSON.parse(snapshot);
    const nodes = g.nodes ?? [];
    return {
      nodeCount: nodes.length,
      edgeCount: (g.edges ?? []).length,
      nodeIds: nodes.map((n) => n.id ?? "").filter(Boolean),
    };
  } catch { return { nodeCount: 0, edgeCount: 0, nodeIds: [] }; }
}

function autoLabel(): string {
  return `Checkpoint ${new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// GET /api/workflows/:id/revisions — list revisions newest first
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const db = getDb();

  const workflow = db
    .select({ id: schema.workflows.id })
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId))
    .get();

  if (!workflow) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  const rows = db
    .select({
      id: schema.workflowRevisions.id,
      workflowId: schema.workflowRevisions.workflowId,
      label: schema.workflowRevisions.label,
      createdAt: schema.workflowRevisions.createdAt,
      graphSnapshot: schema.workflowRevisions.graphSnapshot,
    })
    .from(schema.workflowRevisions)
    .where(eq(schema.workflowRevisions.workflowId, workflowId))
    .orderBy(desc(schema.workflowRevisions.createdAt))
    .all();

  const response = rows.map(({ graphSnapshot, ...row }) => ({
    ...row,
    graphStats: parseGraphStats(graphSnapshot),
  }));

  return NextResponse.json(response);
}

// POST /api/workflows/:id/revisions — create a revision checkpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const db = getDb();

  const workflow = db
    .select({ id: schema.workflows.id, graph: schema.workflows.graph })
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId))
    .get();

  if (!workflow) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  let body: { label?: unknown; graph?: unknown } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  // Caller may send a live graph snapshot; fall back to current persisted graph
  let graphSnapshot: string;
  if (body.graph && typeof body.graph === "object") {
    graphSnapshot = JSON.stringify(body.graph);
  } else {
    graphSnapshot = workflow.graph as string;
  }

  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : autoLabel();

  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(schema.workflowRevisions)
    .values({ id, workflowId, label, graphSnapshot, createdAt: now })
    .run();

  return NextResponse.json({ id, label, createdAt: now }, { status: 201 });
}
