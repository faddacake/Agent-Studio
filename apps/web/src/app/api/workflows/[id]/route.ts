export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema, sql } from "@iterastudio/db";
import { eq } from "drizzle-orm";

// GET /api/workflows/:id — get a single workflow
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id))
    .get();

  if (!row) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.workflowRevisions)
    .where(eq(schema.workflowRevisions.workflowId, id))
    .get();

  return NextResponse.json({ ...row, revisionCount: countRow?.count ?? 0 });
}

// PATCH /api/workflows/:id — update workflow fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const existing = db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id))
    .get();

  if (!existing) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.graph !== undefined) updates.graph = JSON.stringify(body.graph);
  if (typeof body.isPinned === "boolean") updates.isPinned = body.isPinned;
  if (Array.isArray(body.tags)) {
    updates.tags = JSON.stringify(
      body.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim()),
    );
  }

  db.update(schema.workflows)
    .set(updates)
    .where(eq(schema.workflows.id, id))
    .run();

  return NextResponse.json({ ok: true });
}

// DELETE /api/workflows/:id — soft delete
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
