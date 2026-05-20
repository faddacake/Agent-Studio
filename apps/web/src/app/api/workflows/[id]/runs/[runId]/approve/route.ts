export const runtime = "nodejs";

import { getRunCoordinator } from "@/lib/runCoordinator";

/**
 * POST /api/workflows/:id/runs/:runId/approve
 *
 * Body: { approved: boolean; feedback?: string }
 *
 * Resolves a pending human-in-the-loop approval for the given run.
 * Returns { success: true } if a pending approval was found and resolved,
 * or { success: false, error: "No pending approval for this run" } otherwise.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;

  let body: { approved: boolean; feedback?: string };
  try {
    body = await req.json() as { approved: boolean; feedback?: string };
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { approved, feedback } = body;
  if (typeof approved !== "boolean") {
    return Response.json({ error: "approved field must be a boolean" }, { status: 400 });
  }

  const coordinator = getRunCoordinator();
  const resolved = coordinator.resolveApproval(runId, approved, feedback);

  if (!resolved) {
    return Response.json(
      { success: false, error: "No pending approval for this run" },
      { status: 404 },
    );
  }

  return Response.json({ success: true });
}
