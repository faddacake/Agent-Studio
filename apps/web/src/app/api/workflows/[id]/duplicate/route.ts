export const runtime = "nodejs";

/**
 * POST /api/workflows/:id/duplicate
 *
 * Creates a copy of the specified workflow.
 *
 * Copied:   name (suffixed with " (Copy)"), description, graph (nodes + edges)
 * NOT copied: run history, nodeExecutions, lastRunId, lastRunStatus, lastRunAt
 *
 * Returns { id, name } of the new workflow.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const source = db
    .select({
      name: schema.workflows.name,
      description: schema.workflows.description,
      graph: schema.workflows.graph,
    })
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id))
    .get();

  if (!source) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  const newId = randomUUID();
  const now = new Date().toISOString();
  const newName = `${source.name} (Copy)`;

  db.insert(schema.workflows)
    .values({
      id: newId,
      name: newName,
      description: source.description ?? "",
      graph: source.graph as string,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return NextResponse.json({ id: newId, name: newName }, { status: 201 });
}
