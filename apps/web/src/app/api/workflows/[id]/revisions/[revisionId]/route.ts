export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { and, eq } from "drizzle-orm";

// DELETE /api/workflows/:id/revisions/:revisionId
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const { id: workflowId, revisionId } = await params;
  const db = getDb();

  const revision = db
    .select({ id: schema.workflowRevisions.id })
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

  db.delete(schema.workflowRevisions)
    .where(eq(schema.workflowRevisions.id, revisionId))
    .run();

  return NextResponse.json({ success: true });
}
