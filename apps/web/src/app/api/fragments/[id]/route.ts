export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

// PATCH /api/fragments/[id] — rename a fragment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { name } = body as { name?: unknown };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "name is required" },
      { status: 400 },
    );
  }

  const trimmed = (name as string).trim();

  const result = getDb()
    .update(schema.workflowFragments)
    .set({ name: trimmed })
    .where(eq(schema.workflowFragments.id, id))
    .run();

  if (result.changes === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ id, name: trimmed });
}

// DELETE /api/fragments/[id] — hard-delete a fragment
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = getDb()
    .delete(schema.workflowFragments)
    .where(eq(schema.workflowFragments.id, id))
    .run();

  if (result.changes === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
