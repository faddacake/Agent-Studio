export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { and, eq } from "drizzle-orm";

// POST /api/workflows/:id/revisions/:revisionId/restore
// Replaces the workflow's current graph with the revision snapshot.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const { id: workflowId, revisionId } = await params;
  const db = getDb();

  const revision = db
    .select()
    .from(schema.workflowRevisions)
    .where(
      and(
        eq(schema.workflowRevisions.id, revisionId),
        eq(schema.workflowRevisions.workflowId, workflowId),
      ),
    )
    .get();

  if (!revision) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Revision not found" },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  db.update(schema.workflows)
    .set({ graph: revision.graphSnapshot as string, updatedAt: now })
    .where(eq(schema.workflows.id, workflowId))
    .run();

  return NextResponse.json({ ok: true });
}
