export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

// PATCH /api/templates/:id — update template name
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { name } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "name is required" },
      { status: 400 },
    );
  }

  const db = getDb();
  db.update(schema.workflows)
    .set({ name: name.trim(), updatedAt: new Date().toISOString() })
    .where(eq(schema.workflows.id, id))
    .run();

  return NextResponse.json({ ok: true });
}

// DELETE /api/templates/:id — soft-delete a saved template
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  db.update(schema.workflows)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.workflows.id, id))
    .run();

  return NextResponse.json({ ok: true });
}
