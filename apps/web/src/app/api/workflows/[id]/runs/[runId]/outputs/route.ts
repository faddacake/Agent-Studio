export const runtime = "nodejs";

/**
 * GET /api/workflows/:id/runs/:runId/outputs
 *
 * Returns the completed node outputs for a run, keyed by nodeId.
 * Used by the debugger Outputs tab to render images, text, and JSON values.
 *
 * Read strategy:
 *   1. In-memory coordinator state — used for the active run; always up-to-date.
 *   2. DB fallback (nodeExecutions.outputs) — used after page refresh or when
 *      the coordinator has recycled the run.  The DB record is written at node
 *      completion time in makeDispatch() in runs/route.ts.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@iterastudio/db";
import { getRunCoordinator } from "@/lib/runCoordinator";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;
  const coordinator = getRunCoordinator();

  // ── Primary path: live coordinator state ──────────────────────────────────
  if (coordinator.hasRun(runId)) {
    const run = coordinator.getRun(runId);
    const outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }> = [];
    for (const [nodeId, state] of run.nodeStates) {
      if (state.status === "completed" && Object.keys(state.outputs).length > 0) {
        outputs.push({ nodeId, outputs: state.outputs });
      }
    }
    return NextResponse.json({ outputs });
  }

  // ── Fallback: DB-persisted node execution records ─────────────────────────
  const db = getDb();

  // Confirm the run exists at all (avoids 200 with empty array for unknown IDs)
  const runRow = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get();

  if (!runRow) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const rows = db
    .select({
      nodeId: schema.nodeExecutions.nodeId,
      outputs: schema.nodeExecutions.outputs,
    })
    .from(schema.nodeExecutions)
    .where(
      and(
        eq(schema.nodeExecutions.runId, runId),
        eq(schema.nodeExecutions.status, "completed"),
      ),
    )
    .all();

  const outputs = rows
    .filter((r) => r.outputs)
    .map((r) => ({
      nodeId: r.nodeId,
      outputs: JSON.parse(r.outputs!) as Record<string, unknown>,
    }));

  return NextResponse.json({ outputs });
}
