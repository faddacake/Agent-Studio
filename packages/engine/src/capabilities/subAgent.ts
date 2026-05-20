/**
 * Sub-Agent capability executor.
 *
 * Executes a focused ReAct Agent with a custom role (persona), its own
 * tool list, and configurable step budget. Credential inheritance:
 * if provider/model/apiKey are blank, the values injected by the parent
 * callTool() via __parentCredentials are used as fallback.
 *
 * Node type: "sub-agent"
 */

import type { NodeDefinition, NodeExecutionContext, NodeExecutionResult } from "@aistudio/shared";
import { executeReactAgent } from "./reactAgent.js";

export async function executeSubAgent(
  context: NodeExecutionContext,
  definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // ── Resolve task ─────────────────────────────────────────────────────────
  const task =
    (inputs.task_in as string | undefined)?.trim() ??
    (params.task   as string | undefined)?.trim() ??
    "";

  if (!task) {
    throw new Error(
      "Sub-Agent requires a task. Connect the task_in port or set the Task parameter.",
    );
  }

  // ── Credential inheritance ────────────────────────────────────────────────
  const parentCreds = (params.__parentCredentials ?? {}) as {
    apiKey?: string;
    provider?: string;
    model?: string;
  };

  const provider = (params.provider as string | undefined)?.trim() || parentCreds.provider || "anthropic";
  const model    = (params.model    as string | undefined)?.trim() || parentCreds.model    || "";
  const apiKey   = (params.apiKey   as string | undefined)?.trim() || parentCreds.apiKey   || "";

  // ── Role prefix ───────────────────────────────────────────────────────────
  const role = (params.role as string | undefined)?.trim() ?? "";

  // ── Build delegated params ────────────────────────────────────────────────
  const delegatedParams: Record<string, unknown> = {
    goal:           task,
    provider,
    model,
    apiKey,
    maxSteps:       params.maxSteps ?? 5,
    tools:          params.tools    ?? [],
    __rolePrefix:   role,
    __agentDepth:   params.__agentDepth,  // propagated from callTool
  };

  // ── Delegate to executeReactAgent ─────────────────────────────────────────
  const result = await executeReactAgent(
    { ...context, inputs: {}, params: delegatedParams },
    definition,
  );

  // ── Map outputs ───────────────────────────────────────────────────────────
  return {
    outputs: {
      result_out: result.outputs.answer_out,
      steps_out:  result.outputs.steps_out,
    },
    cost:     result.cost,
    metadata: result.metadata,
  };
}
