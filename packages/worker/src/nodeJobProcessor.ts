import { nodeExecutor } from "@aistudio/engine";
import { registerBuiltInNodes } from "@aistudio/shared";
import type { NodeExecutionContext, NodeExecutionResult } from "@aistudio/shared";
import { resolveProviderKey } from "@aistudio/db";

// Ensure node definitions are registered
let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  registerBuiltInNodes();
  initialized = true;
}

/**
 * Job data shape for node execution jobs on the predictions queue.
 */
export interface NodeJobData {
  runId: string;
  nodeId: string;
  nodeType: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  attempt: number;
}

/**
 * Job result returned to the coordinator after node execution.
 */
export interface NodeJobResult {
  status: "completed" | "failed";
  nodeId: string;
  runId: string;
  outputs: Record<string, unknown>;
  cost?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Process a node execution job.
 *
 * This is called by the BullMQ worker for each job on the predictions queue.
 * It builds an execution context from the job data and delegates to the
 * engine's NodeExecutor, which routes by runtimeKind.
 */
export async function processNodeJob(jobData: NodeJobData): Promise<NodeJobResult> {
  ensureInitialized();

  // Resolve image/video provider key for provider-backed nodes.
  const resolvedKey = jobData.providerId
    ? resolveProviderKey(jobData.providerId)
    : null;

  // Resolve LLM provider key for agent/ReAct/SubAgent nodes.
  // When the node itself has no apiKey configured, fall back to the key stored
  // in Settings → Providers so users only need to enter it once.
  const llmProvider = (jobData.params.provider as string | undefined)?.trim();
  const llmKeyInNode = (jobData.params.apiKey as string | undefined)?.trim();
  const resolvedLLMKey =
    llmProvider && !llmKeyInNode ? resolveProviderKey(llmProvider) : null;

  const context: NodeExecutionContext = {
    nodeId: jobData.nodeId,
    runId: jobData.runId,
    inputs: jobData.inputs,
    params: {
      ...jobData.params,
      // Inject node type for the executor's type resolution
      __nodeType: jobData.nodeType,
      // Inject resolved API key so provider executor doesn't need DB access.
      ...(resolvedKey ? { __apiKey: resolvedKey } : {}),
      // Inject resolved LLM key when the node itself has no key configured.
      ...(resolvedLLMKey ? { apiKey: resolvedLLMKey } : {}),
    },
    providerId: jobData.providerId,
    modelId: jobData.modelId,
    outputDir: getOutputDir(jobData.runId, jobData.nodeId),
  };

  try {
    const result: NodeExecutionResult = await nodeExecutor.execute(context);

    return {
      status: "completed",
      nodeId: jobData.nodeId,
      runId: jobData.runId,
      outputs: result.outputs,
      cost: result.cost,
      durationMs: result.durationMs,
      metadata: result.metadata,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      status: "failed",
      nodeId: jobData.nodeId,
      runId: jobData.runId,
      outputs: {},
      error: errorMessage,
    };
  }
}

/**
 * Compute the output directory for a node execution.
 */
function getOutputDir(runId: string, nodeId: string): string {
  const dataDir = process.env.DATA_DIR || "/data";
  return `${dataDir}/assets/runs/${runId}/nodes/${nodeId}`;
}
