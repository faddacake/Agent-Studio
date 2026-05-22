export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

// GET /api/node-presets?nodeType=<type> — list presets, optionally filtered by node type
export async function GET(request: NextRequest) {
  const nodeType = request.nextUrl.searchParams.get("nodeType");
  const db = getDb();

  const rows = nodeType
    ? db.select().from(schema.nodePresets).where(eq(schema.nodePresets.nodeType, nodeType)).all()
    : db.select().from(schema.nodePresets).all();

  const parsed = rows.map(({ params, ...r }) => ({
    ...r,
    params: JSON.parse(params as string) as Record<string, unknown>,
  }));

  return NextResponse.json(parsed);
}

// POST /api/node-presets — save a new preset
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, nodeType, params } = body as {
    name?: unknown;
    nodeType?: unknown;
    params?: unknown;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "name is required" }, { status: 400 });
  }
  if (!nodeType || typeof nodeType !== "string") {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "nodeType is required" }, { status: 400 });
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "params must be an object" }, { status: 400 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  getDb().insert(schema.nodePresets).values({
    id,
    name: name.trim(),
    nodeType,
    params: JSON.stringify(params),
    createdAt: now,
  }).run();

  return NextResponse.json({ id, name: name.trim(), nodeType, params, createdAt: now }, { status: 201 });
}

// DELETE /api/node-presets?id=<id> — delete a preset
export async function DELETE(request: NextRequest) {
  const presetId = request.nextUrl.searchParams.get("id");
  if (!presetId) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "id query param is required" }, { status: 400 });
  }

  getDb().delete(schema.nodePresets).where(eq(schema.nodePresets.id, presetId)).run();
  return NextResponse.json({ success: true });
}
