export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { desc } from "drizzle-orm";

// GET /api/fragments — list all fragments newest first
export async function GET() {
  const rows = getDb()
    .select()
    .from(schema.workflowFragments)
    .orderBy(desc(schema.workflowFragments.createdAt))
    .all();

  const parsed = rows.map(({ graphSnapshot, ...r }) => ({
    ...r,
    graph: JSON.parse(graphSnapshot as string) as {
      nodes: Array<{ id: string; type?: string }>;
      edges: unknown[];
    },
    nodeCount: (() => {
      try {
        const g = JSON.parse(graphSnapshot as string) as { nodes?: unknown[] };
        return (g.nodes ?? []).length;
      } catch { return 0; }
    })(),
  }));

  return NextResponse.json(parsed);
}

// POST /api/fragments — save a new fragment
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, graph } = body as { name?: unknown; graph?: unknown };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "name is required" }, { status: 400 });
  }
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "graph must be an object" }, { status: 400 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  getDb().insert(schema.workflowFragments).values({
    id,
    name: (name as string).trim(),
    graphSnapshot: JSON.stringify(graph),
    createdAt: now,
  }).run();

  return NextResponse.json({ id, name: (name as string).trim(), createdAt: now }, { status: 201 });
}
