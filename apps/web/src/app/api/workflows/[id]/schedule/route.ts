export const runtime = "nodejs";

/**
 * GET  /api/workflows/:id/schedule — fetch the stored cron schedule
 * POST /api/workflows/:id/schedule — upsert a cron schedule
 * DELETE /api/workflows/:id/schedule — remove the schedule
 *
 * Schedule is persisted in the `settings` table (key/value store) under
 * the key `workflow_schedule:<workflowId>`.  Actual execution requires a
 * scheduler process that polls this table and hits POST /api/workflows/:id/runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@aistudio/db";
import { eq } from "drizzle-orm";

interface ScheduleRecord {
  cron: string;
  enabled: boolean;
  updatedAt: string;
}

function scheduleKey(workflowId: string): string {
  return `workflow_schedule:${workflowId}`;
}

/** Minimal cron validation: exactly 5 whitespace-delimited fields. */
function isValidCron(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, scheduleKey(id)))
    .get();

  if (!row) return NextResponse.json({ schedule: null });

  try {
    const schedule = JSON.parse(row.value) as ScheduleRecord;
    return NextResponse.json({ schedule });
  } catch {
    return NextResponse.json({ schedule: null });
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { cron?: string; enabled?: boolean };
  const cron = (body.cron ?? "").trim();

  if (!isValidCron(cron)) {
    return NextResponse.json(
      { error: "INVALID_CRON", message: "Enter a valid cron expression with 5 fields (e.g. 0 9 * * *)" },
      { status: 400 },
    );
  }

  const record: ScheduleRecord = {
    cron,
    enabled: body.enabled !== false, // default true
    updatedAt: new Date().toISOString(),
  };

  const key = scheduleKey(id);
  const db = getDb();
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();

  if (existing) {
    db.update(schema.settings)
      .set({ value: JSON.stringify(record) })
      .where(eq(schema.settings.key, key))
      .run();
  } else {
    db.insert(schema.settings)
      .values({ key, value: JSON.stringify(record) })
      .run();
  }

  return NextResponse.json({ ok: true, schedule: record });
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  db.delete(schema.settings).where(eq(schema.settings.key, scheduleKey(id))).run();
  return NextResponse.json({ ok: true });
}
