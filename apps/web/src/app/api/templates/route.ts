export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema, sql } from "@iterastudio/db";
import { eq } from "drizzle-orm";

function parseGraph(raw: string) {
  try { return JSON.parse(raw); } catch { return { version: 1, nodes: [], edges: [] }; }
}

function parseTags(raw: string | null | undefined): string[] {
  try { return JSON.parse(raw ?? "[]") ?? []; } catch { return []; }
}

// GET /api/templates — list all user-saved templates
export async function GET() {
  const db = getDb();
  const rows = db
    .select({
      id: schema.workflows.id,
      name: schema.workflows.name,
      description: schema.workflows.description,
      graph: schema.workflows.graph,
      tags: schema.workflows.tags,
      updatedAt: schema.workflows.updatedAt,
      createdAt: schema.workflows.createdAt,
    })
    .from(schema.workflows)
    .where(
      sql`${schema.workflows.isTemplate} = 1 AND ${schema.workflows.templateSource} = 'user' AND ${schema.workflows.deletedAt} IS NULL`,
    )
    .all();

  return NextResponse.json(
    rows.map((r) => ({ ...r, graph: parseGraph(r.graph), tags: parseTags(r.tags) })),
  );
}

// POST /api/templates — save a reusable template.
// Accepts either:
//   { sourceWorkflowId, name?, description? }  — copy from an existing workflow (list page path)
//   { name, description?, graph }              — save directly from provided graph (editor path)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sourceWorkflowId, name: rawName, description: rawDesc, graph: directGraph, tags: rawTags } = body;
  const tagsJson = JSON.stringify(Array.isArray(rawTags) ? rawTags.filter((t: unknown) => typeof t === "string" && t.trim()) : []);

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  if (sourceWorkflowId) {
    // ── Copy-from-workflow path ──
    if (typeof sourceWorkflowId !== "string") {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "sourceWorkflowId must be a string" },
        { status: 400 },
      );
    }

    const source = db
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.id, sourceWorkflowId))
      .get();

    if (!source || source.deletedAt) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Workflow not found" },
        { status: 404 },
      );
    }

    db.insert(schema.workflows)
      .values({
        id,
        name: rawName?.trim() || source.name,
        description: rawDesc?.trim() ?? source.description ?? "",
        graph: source.graph,
        tags: tagsJson,
        isTemplate: true,
        templateSource: "user",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return NextResponse.json({ id }, { status: 201 });
  }

  // ── Direct-graph path (from editor) ──
  const name = rawName?.trim();
  if (!name) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "name is required" },
      { status: 400 },
    );
  }
  if (!directGraph || typeof directGraph !== "object") {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "graph is required" },
      { status: 400 },
    );
  }

  db.insert(schema.workflows)
    .values({
      id,
      name,
      description: rawDesc?.trim() ?? "",
      graph: JSON.stringify(directGraph),
      tags: tagsJson,
      isTemplate: true,
      templateSource: "user",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return NextResponse.json({ id }, { status: 201 });
}
