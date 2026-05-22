export const runtime = "nodejs";

/**
 * GET /api/workflows/:id/runs/:runId
 *
 * Returns a single run's metadata plus all persisted nodeExecution records
 * for that run.  Used exclusively by the historical run detail page — this
 * endpoint reads only from the database and does NOT require the in-memory
 * coordinator to still hold the run.
 *
 * Response shape:
 *   {
 *     run:            RunDetail          — status, timestamps, cost, etc.
 *     nodeExecutions: NodeExecutionRow[] — per-node results
 *     nodeLabels:     Record<string, string>  — nodeId → label from graphSnapshot
 *   }
 *
 * nodeLabels is extracted from the graphSnapshot so the UI can show human-
 * readable node names without shipping the full graph to the client.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@iterastudio/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;
  const db = getDb();

  const run = db
    .select({
      id:           schema.runs.id,
      workflowId:   schema.runs.workflowId,
      status:       schema.runs.status,
      totalCost:    schema.runs.totalCost,
      error:        schema.runs.error,
      budgetCap:    schema.runs.budgetCap,
      budgetMode:   schema.runs.budgetMode,
      startedAt:    schema.runs.startedAt,
      completedAt:  schema.runs.completedAt,
      createdAt:    schema.runs.createdAt,
      graphSnapshot: schema.runs.graphSnapshot,
    })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get();

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Extract nodeId → label from the graph snapshot without sending the full
  // graph to the client.  The graph is a WorkflowGraph: { nodes: WorkflowNode[] }
  // where each node has { id, data: { label } }.
  const nodeLabels: Record<string, string> = {};
  try {
    const graph = JSON.parse(run.graphSnapshot) as {
      nodes?: Array<{ id: string; data?: { label?: string } }>;
    };
    for (const node of graph.nodes ?? []) {
      if (node.id && node.data?.label) {
        nodeLabels[node.id] = node.data.label;
      }
    }
  } catch {
    // Non-fatal — labels fall back to nodeId in the UI
  }

  const nodeExecutions = db
    .select({
      id:          schema.nodeExecutions.id,
      nodeId:      schema.nodeExecutions.nodeId,
      status:      schema.nodeExecutions.status,
      attempt:     schema.nodeExecutions.attempt,
      cost:        schema.nodeExecutions.cost,
      startedAt:   schema.nodeExecutions.startedAt,
      completedAt: schema.nodeExecutions.completedAt,
      error:       schema.nodeExecutions.error,
      providerId:  schema.nodeExecutions.providerId,
      modelId:     schema.nodeExecutions.modelId,
    })
    .from(schema.nodeExecutions)
    .where(eq(schema.nodeExecutions.runId, runId))
    .all();

  // Sort by startedAt ascending (execution order); nodes without startedAt last
  nodeExecutions.sort((a, b) => {
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return a.startedAt < b.startedAt ? -1 : 1;
  });

  // Strip graphSnapshot from the run response — it's large and not needed directly
  const { graphSnapshot: _, ...runDetail } = run;

  return NextResponse.json({ run: runDetail, nodeExecutions, nodeLabels });
}
