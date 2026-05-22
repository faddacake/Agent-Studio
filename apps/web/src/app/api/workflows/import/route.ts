export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@iterastudio/db";
import { WorkflowGraphSchema } from "@iterastudio/shared";

// POST /api/workflows/import — create a new workflow from an exported definition
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "PARSE_ERROR", message: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Expected a JSON object" },
      { status: 400 },
    );
  }

  const obj = body as Record<string, unknown>;

  // Version gate — only version 1 supported
  if (obj.exportVersion !== 1) {
    return NextResponse.json(
      { error: "UNSUPPORTED_VERSION", message: `Unsupported export version: ${obj.exportVersion}` },
      { status: 400 },
    );
  }

  // Validate name
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Workflow name is required" },
      { status: 400 },
    );
  }

  const description = typeof obj.description === "string" ? obj.description.trim() : "";

  // Validate graph against the canonical schema
  const graphResult = WorkflowGraphSchema.safeParse(obj.graph);
  if (!graphResult.success) {
    return NextResponse.json(
      {
        error: "INVALID_GRAPH",
        message: "Workflow graph failed validation",
        details: graphResult.error.flatten(),
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const db = getDb();
  db.insert(schema.workflows)
    .values({
      id,
      name,
      description,
      graph: JSON.stringify(graphResult.data),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return NextResponse.json({ id, name }, { status: 201 });
}
