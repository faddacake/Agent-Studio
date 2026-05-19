export const runtime = "nodejs";

/**
 * POST /api/workflows/:id/runs — start a new run for a workflow.
 *
 * Loads the workflow graph from the DB, bootstraps engine registries,
 * creates a RunCoordinator run, fires the dispatch loop async (fire-and-
 * forget), and returns { id: runId } immediately so clients can subscribe
 * to the SSE stream at /api/workflows/:id/runs/:runId/events.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@aistudio/db";
import { desc, eq } from "drizzle-orm";
import path from "node:path";

import {
  nodeExecutor,
  registerCapabilityExecutors,
  registerLocalExecutors,
  createGenerator,
  createVideoGenerator,
  writeArtifact,
  type DispatchJob,
} from "@aistudio/engine";
// registerCapabilityExecutors / registerLocalExecutors register on the
// module-level nodeExecutor singleton and take no arguments.
import {
  registerBuiltInNodes,
  nodeRegistry,
  type NodeExecutionContext,
} from "@aistudio/shared";
import { getRunCoordinator } from "@/lib/runCoordinator";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
import { resolveProviderKey } from "@/lib/providers/resolveProviderKey";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";

// ── Registry bootstrap (idempotent) ──────────────────────────────────────────

let executorsRegistered = false;

function ensureEngineBootstrapped(): void {
  // Node registry (shared package definitions)
  initializeNodeRegistry();

  // Executor handlers (engine package)
  if (!executorsRegistered) {
    registerCapabilityExecutors();
    registerLocalExecutors();

    // Provider executor: resolves credentials from DB and delegates to the
    // appropriate GeneratorAdapter.  Supports image-generation nodes.
    nodeExecutor.setProviderExecutor(async (context, definition) => {
      const providerId = context.providerId ?? definition.provider?.providerId ?? "fal";
      const modelId = context.modelId ?? definition.provider?.modelId;

      // __apiKey is injected in makeDispatch() after DB lookup; fall back to the
      // provider-specific env var.  If neither is present the provider is not
      // configured — fail clearly.
      // Map is exhaustive: unknown providers get undefined, not the fal key by accident.
      const ENV_KEYS: Record<string, string | undefined> = {
        fal:       process.env.FAL_API_KEY,
        replicate: process.env.REPLICATE_API_TOKEN,
      };
      const apiKey =
        (context.params.__apiKey as string | undefined) ?? ENV_KEYS[providerId];

      if (!apiKey) {
        throw new Error(
          `Provider "${providerId}" is not configured. ` +
          `Add your API key in Settings → Providers to run this workflow.`,
        );
      }

      const prompt =
        (context.inputs.prompt_in as string | undefined) ??
        (context.params.prompt as string | undefined) ??
        "abstract art";
      const width    = Number(context.params.width  ?? 1024);
      const height   = Number(context.params.height ?? 1024);
      const duration = Number(context.params.duration ?? 5);
      const seed =
        context.params.seed !== undefined && Number(context.params.seed) !== -1
          ? Number(context.params.seed)
          : undefined;
      // Read node-level quality params so user-configured values (e.g. 28 steps
      // for FLUX Pro vs 4 for Schnell) reach the provider adapter rather than
      // being silently discarded. Both are optional — adapters supply their own
      // defaults when absent.
      const numInferenceSteps =
        context.params.num_inference_steps !== undefined
          ? Number(context.params.num_inference_steps)
          : undefined;
      const guidanceScale =
        context.params.guidance_scale !== undefined
          ? Number(context.params.guidance_scale)
          : undefined;

      // Route to the video path for any node whose output is a video port.
      // This covers the generic "video-generation" type, provider-specific
      // video nodes (e.g. "fal/kling-1.6", "replicate/minimax-video-01"),
      // and any future video provider — without model-ID inspection.
      if (definition.outputs.some((o) => o.type === "video")) {
        const videoGen  = createVideoGenerator({ provider: providerId, apiKey, modelId });
        const generated = await videoGen.generateVideo({ prompt, width, height, duration, signal: context.signal });

        const artifactRef = await writeArtifact({
          buffer:    generated.buffer,
          outputDir: context.outputDir ?? ARTIFACTS_DIR,
          runId:     context.runId,
          nodeId:    context.nodeId,
          suffix:    "generated",
          format:    "mp4",
        });

        return {
          outputs:  { video_out: artifactRef },
          cost:     0,
          metadata: { provider: providerId, model: modelId, generatorKind: videoGen.kind, durationSecs: generated.durationSecs },
        };
      }

      // Image path (FLUX, SDXL, etc.)
      const generator = createGenerator({ provider: providerId, apiKey, modelId });
      const generated = await generator.generate({ prompt, width, height, seed, numInferenceSteps, guidanceScale, signal: context.signal });

      const format = generated.mimeType.replace(/^image\//, "") === "jpeg" ? "jpeg" : "png";
      const artifactRef = await writeArtifact({
        buffer:    generated.buffer,
        outputDir: context.outputDir ?? ARTIFACTS_DIR,
        runId:     context.runId,
        nodeId:    context.nodeId,
        suffix:    "generated",
        format,
        width:     generated.width,
        height:    generated.height,
      });

      return {
        outputs:  { image_out: artifactRef },
        cost:     0,
        metadata: { provider: providerId, model: modelId, generatorKind: generator.kind },
      };
    });

    executorsRegistered = true;
  }
}

// ── Dispatch loop ─────────────────────────────────────────────────────────────

/**
 * Inline dispatch: the coordinator calls this for each ready node.
 * We execute the node synchronously (within the async callback) and
 * report the result back so the coordinator can advance the DAG.
 *
 * This runs entirely in the Node.js process — no external queue.
 */
function makeDispatch(runId: string, outputDir: string): DispatchJob {
  const coordinator = getRunCoordinator();

  const dispatch: DispatchJob = async (job) => {
    // Mark node as running
    const run = coordinator.getRun(runId);
    const nodeState = run.nodeStates.get(job.nodeId);
    if (nodeState) {
      nodeState.status = "running";
      nodeState.startedAt = Date.now();
    }

    try {
      // Resolve provider API key from DB (DB config takes precedence over env).
      // Falls back to null — the provider executor will use env var as fallback.
      const resolvedProviderId = job.providerId;
      const resolvedKey = resolvedProviderId
        ? resolveProviderKey(resolvedProviderId)
        : null;

      const context: NodeExecutionContext = {
        nodeId: job.nodeId,
        runId: job.runId,
        inputs: job.inputs,
        params: {
          ...job.params,
          // Inject node type so executor can look up the NodeDefinition.
          __nodeType: job.nodeType,
          // Inject resolved API key so provider executor doesn't need DB access.
          ...(resolvedKey ? { __apiKey: resolvedKey } : {}),
        },
        providerId: job.providerId,
        modelId: job.modelId,
        outputDir,
        // Wire agent step callback: stores each T/A/O step on NodeState and
        // emits an agent:step event so the SSE stream updates in real time.
        onAgentStep: (step) => {
          coordinator.onAgentStep(job.runId, job.nodeId, step);
        },
      };

      const result = await nodeExecutor.execute(context);

      await coordinator.onNodeCompleted(
        job.runId,
        job.nodeId,
        result.outputs,
        result.cost,
        dispatch,
      );

      // Persist node execution record with outputs to DB.
      // Non-fatal: a DB error must not interrupt the run.
      try {
        const finalState = coordinator.getRun(runId).nodeStates.get(job.nodeId);
        getDb().insert(schema.nodeExecutions).values({
          id: randomUUID(),
          runId: job.runId,
          nodeId: job.nodeId,
          status: "completed",
          attempt: finalState?.attempt ?? 1,
          cost: result.cost ?? 0,
          outputs: JSON.stringify(result.outputs),
          startedAt: finalState?.startedAt
            ? new Date(finalState.startedAt).toISOString()
            : undefined,
          completedAt: finalState?.completedAt
            ? new Date(finalState.completedAt).toISOString()
            : undefined,
          providerId: job.providerId,
          modelId: job.modelId,
          createdAt: new Date().toISOString(),
        }).run();
      } catch (dbErr) {
        console.error(`[runs/route] Failed to persist nodeExecution for ${job.nodeId}:`, dbErr);
      }
    } catch (err) {
      await coordinator.onNodeFailed(
        job.runId,
        job.nodeId,
        err instanceof Error ? err.message : String(err),
        dispatch,
      );

      // Persist failed node execution record.
      try {
        const finalState = coordinator.getRun(runId).nodeStates.get(job.nodeId);
        getDb().insert(schema.nodeExecutions).values({
          id: randomUUID(),
          runId: job.runId,
          nodeId: job.nodeId,
          status: "failed",
          attempt: finalState?.attempt ?? 1,
          error: err instanceof Error ? err.message : String(err),
          startedAt: finalState?.startedAt
            ? new Date(finalState.startedAt).toISOString()
            : undefined,
          completedAt: finalState?.completedAt
            ? new Date(finalState.completedAt).toISOString()
            : undefined,
          providerId: job.providerId,
          modelId: job.modelId,
          createdAt: new Date().toISOString(),
        }).run();
      } catch (dbErr) {
        console.error(`[runs/route] Failed to persist nodeExecution failure for ${job.nodeId}:`, dbErr);
      }
    }
  };

  return dispatch;
}

// ── Route handlers ────────────────────────────────────────────────────────────

// ── Graph stats helper ────────────────────────────────────────────────────────

interface ProvenanceLink {
  sourceRunId: string;
  artifactPath: string;
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  provenanceNodeCount: number;
  nodeTypes: string[];
  provenanceLinks: ProvenanceLink[];
}

function parseGraphStats(snapshot: string | null): GraphStats {
  const fallback: GraphStats = { nodeCount: 0, edgeCount: 0, provenanceNodeCount: 0, nodeTypes: [], provenanceLinks: [] };
  if (!snapshot) return fallback;
  try {
    const g: { nodes?: Array<{ type?: string; data?: { params?: Record<string, unknown> } }>; edges?: unknown[] } = JSON.parse(snapshot);
    const nodes = g.nodes ?? [];
    const provenanceLinks: ProvenanceLink[] = nodes
      .map((n) => n.data?.params?.__provenance)
      .filter((p): p is { runId: string; artifactPath: string } =>
        p != null && typeof p === "object" && typeof (p as Record<string, unknown>).runId === "string",
      )
      .map((p) => ({ sourceRunId: p.runId, artifactPath: p.artifactPath }));
    return {
      nodeCount: nodes.length,
      edgeCount: (g.edges ?? []).length,
      provenanceNodeCount: provenanceLinks.length,
      nodeTypes: [...new Set(nodes.map((n) => n.type ?? "unknown").filter(Boolean))],
      provenanceLinks,
    };
  } catch { return fallback; }
}

/**
 * GET /api/workflows/:id/runs — list historical run records, newest first.
 * Returns summary fields plus lightweight graphStats derived from graphSnapshot.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const db = getDb();

  const workflow = db
    .select({ id: schema.workflows.id })
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId))
    .get();

  if (!workflow) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  const rows = db
    .select({
      id: schema.runs.id,
      workflowId: schema.runs.workflowId,
      status: schema.runs.status,
      totalCost: schema.runs.totalCost,
      error: schema.runs.error,
      startedAt: schema.runs.startedAt,
      completedAt: schema.runs.completedAt,
      createdAt: schema.runs.createdAt,
      graphSnapshot: schema.runs.graphSnapshot,
    })
    .from(schema.runs)
    .where(eq(schema.runs.workflowId, workflowId))
    .orderBy(desc(schema.runs.createdAt))
    .all();

  const response = rows.map(({ graphSnapshot, ...row }) => ({
    ...row,
    graphStats: parseGraphStats(graphSnapshot),
  }));

  return NextResponse.json(response);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;

  // Parse optional budget cap from request body.
  // Non-positive or missing values are treated as "no cap" (undefined).
  let budgetCap: number | undefined;
  try {
    const body = (await request.json()) as { budgetCap?: unknown };
    if (typeof body.budgetCap === "number" && body.budgetCap > 0) {
      budgetCap = body.budgetCap;
    }
  } catch {
    // Empty or non-JSON body — budgetCap stays undefined.
  }

  // Load workflow from DB
  const db = getDb();
  const row = db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId))
    .get();

  if (!row) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Workflow not found" },
      { status: 404 },
    );
  }

  let graph: ReturnType<typeof JSON.parse>;
  try {
    graph = JSON.parse(row.graph as string);
  } catch {
    return NextResponse.json(
      { error: "INVALID_GRAPH", message: "Workflow graph is malformed" },
      { status: 422 },
    );
  }

  // Bootstrap engine registries (idempotent)
  ensureEngineBootstrapped();

  // Create run
  const runId = randomUUID();
  const outputDir = path.join(ARTIFACTS_DIR, runId);
  const coordinator = getRunCoordinator();

  coordinator.createRun({
    runId,
    workflowId,
    workflow: graph,
    budgetCap,
  });

  // Insert the runs record immediately so nodeExecutions FK references are valid
  // while the DAG is executing.  Status starts as "running" and is updated to
  // the final terminal status in the .then() continuation below.
  const runCreatedAt = new Date().toISOString();
  db.insert(schema.runs)
    .values({
      id: runId,
      workflowId,
      status: "running",
      graphSnapshot: JSON.stringify(graph),
      graphVersion: 1,
      totalCost: 0,
      startedAt: runCreatedAt,
      createdAt: runCreatedAt,
    })
    .run();

  // Fire dispatch loop async — response returns immediately.
  // startRun() resolves only after the full DAG is processed (inline dispatch).
  const dispatch = makeDispatch(runId, outputDir);
  coordinator.startRun(runId, dispatch)
    .then(() => {
      const finalRun = coordinator.getRun(runId);
      const now = new Date().toISOString();
      const completedAt = finalRun.completedAt
        ? new Date(finalRun.completedAt).toISOString()
        : now;

      const db2 = getDb();

      // Collect error summary from the first failed node (if any)
      let lastRunError: string | null = null;
      for (const nodeState of finalRun.nodeStates.values()) {
        if (nodeState.status === "failed" && nodeState.error) {
          lastRunError = nodeState.error;
          break;
        }
      }

      // Update run record to final terminal status
      db2.update(schema.runs)
        .set({
          status: finalRun.status,
          totalCost: finalRun.totalCost,
          error: lastRunError,
          completedAt,
        })
        .where(eq(schema.runs.id, runId))
        .run();

      // Update workflow record with last run outcome
      db2.update(schema.workflows)
        .set({
          lastRunId: runId,
          lastRunStatus: finalRun.status,
          lastRunAt: completedAt,
          lastRunError,
          updatedAt: now,
        })
        .where(eq(schema.workflows.id, workflowId))
        .run();
    })
    .catch((err) => {
      console.error(`[runs/route] Run ${runId} failed:`, err);
    });

  return NextResponse.json({ id: runId }, { status: 202 });
}
