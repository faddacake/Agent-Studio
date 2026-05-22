export const runtime = "nodejs";

/**
 * GET /api/workflows/:id/runs/:runId/graph
 *
 * Returns the WorkflowGraph snapshot captured when the run was dispatched.
 * Used by the editor's "Edit & Replay" flow to load a past run's graph —
 * including node positions and parameters — into the canvas for editing.
 *
 * The snapshot is validated against WorkflowGraphSchema before returning so
 * callers can trust the shape.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@iterastudio/db";
import { WorkflowGraphSchema } from "@iterastudio/shared";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;
  const db = getDb();

  const row = db
    .select({ graphSnapshot: schema.runs.graphSnapshot })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get();

  if (!row) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(row.graphSnapshot);
  } catch {
    return NextResponse.json({ error: "Graph snapshot is malformed" }, { status: 500 });
  }

  const result = WorkflowGraphSchema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json({ error: "Graph snapshot failed schema validation" }, { status: 500 });
  }

  return NextResponse.json(result.data);
}
