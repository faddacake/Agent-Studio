export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@iterastudio/db";
import { eq } from "drizzle-orm";

// GET /api/workflows/:id/export — download a portable workflow definition
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

  if (!row || row.deletedAt) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  let graph: unknown;
  try {
    graph = JSON.parse(row.graph);
  } catch {
    return NextResponse.json(
      { error: "INVALID_GRAPH", message: "Workflow graph is malformed" },
      { status: 500 },
    );
  }

  const payload = {
    exportVersion: 1,
    name: row.name,
    description: row.description ?? "",
    graph,
  };

  const filename = `${row.name.replace(/[^a-z0-9_\-\s]/gi, "").trim().replace(/\s+/g, "-") || "workflow"}.workflow.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
