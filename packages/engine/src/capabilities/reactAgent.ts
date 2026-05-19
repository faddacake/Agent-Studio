/**
 * ReAct Agent capability executor.
 *
 * Implements the ReAct (Reasoning + Acting) pattern:
 *   Thought → Action → Observation  (repeat up to maxSteps)
 *   → Final Answer
 *
 * Tools are canvas nodes: each listed node type becomes a callable tool.
 * Tool descriptions are derived from the NodeRegistry at execution time.
 *
 * The `onAgentStep` callback on NodeExecutionContext is called once per cycle
 * so the Run Coordinator can emit `agent:step` events and update the SSE stream.
 *
 * Node type: "react-agent"
 */

import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  AgentStep,
} from "@aistudio/shared";
import { nodeRegistry } from "@aistudio/shared";
import { nodeExecutor } from "../executor.js";
import { createLLMClient } from "../llm/index.js";
import type { LLMMessage } from "../llm/index.js";

// ── Tool description ───────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  /** Human-readable schema for the Action Input JSON object */
  schemaDoc: string;
}

/**
 * Build tool descriptions from the NodeRegistry for the given node types.
 * Nodes that are not registered are silently skipped.
 */
function buildToolDefs(toolTypes: string[]): ToolDef[] {
  return toolTypes
    .map((type) => {
      const def = nodeRegistry.get(type);
      if (!def) return null;

      const inputDocs = def.inputs
        .map((p) => `  "${p.id}": (${p.type}) — ${p.description ?? p.label}`)
        .join("\n");

      const paramDocs = def.parameterSchema
        .filter((p) => !p.key.startsWith("__"))
        .map((p) => `  "${p.key}": (${p.type}) — ${p.description ?? p.label}`)
        .join("\n");

      const schemaDoc = [inputDocs, paramDocs].filter(Boolean).join("\n") ||
        "  (no parameters)";

      return { name: type, description: def.description, schemaDoc };
    })
    .filter((t): t is ToolDef => t !== null);
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(tools: ToolDef[]): string {
  const toolsSection =
    tools.length === 0
      ? "No tools available. Reason from your own knowledge only."
      : tools
          .map(
            (t) =>
              `### ${t.name}\n${t.description}\nAction Input keys:\n${t.schemaDoc}`,
          )
          .join("\n\n");

  return `You are a ReAct (Reasoning + Acting) agent. Solve the user's goal step by step.

## Response format

Each response must be ONE of:

**For a reasoning step with a tool call:**
Thought: <your reasoning about what to do next>
Action: <exact tool name from the list below>
Action Input: <valid JSON object with the tool's parameters>

**For the final answer:**
Thought: <your final reasoning>
Final Answer: <your complete, helpful answer to the user's goal>

## Rules
- Always start with "Thought:"
- "Action" must be the exact tool name (no extra text)
- "Action Input" must be a valid JSON object on one line
- Use "Final Answer:" only when you have a complete answer — never use Action: after it
- Be concise in Thoughts — one or two sentences

## Available tools

${toolsSection}`;
}

// ── Response parser ────────────────────────────────────────────────────────────

interface ParsedResponse {
  thought: string;
  action?: string;
  actionInput?: Record<string, unknown>;
  finalAnswer?: string;
}

function parseReActResponse(text: string): ParsedResponse {
  // Extract Thought (everything up to the next keyword or end)
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action|Final Answer):|$)/);
  const thought = thoughtMatch?.[1]?.trim() ?? text.trim();

  // Final answer path
  const finalMatch = text.match(/Final Answer:\s*([\s\S]*?)$/);
  if (finalMatch) {
    return { thought, finalAnswer: finalMatch[1].trim() };
  }

  // Action path
  const actionMatch = text.match(/Action:\s*(\S+)/);
  const inputMatch  = text.match(/Action Input:\s*(\{[\s\S]*?\})/);

  let actionInput: Record<string, unknown> | undefined;
  if (inputMatch) {
    try {
      actionInput = JSON.parse(inputMatch[1]) as Record<string, unknown>;
    } catch {
      // Best-effort: treat as raw string parameter
      actionInput = { input: inputMatch[1] };
    }
  }

  return {
    thought,
    action:      actionMatch?.[1]?.trim(),
    actionInput: actionInput ?? {},
  };
}

// ── Tool invocation ────────────────────────────────────────────────────────────

/**
 * Call a canvas node as a tool.
 *
 * Input keys that match a registered input port are routed to `inputs`;
 * all other keys become `params`. Text outputs are returned as the observation;
 * non-text outputs are JSON-serialized.
 */
async function callTool(
  toolName: string,
  actionInput: Record<string, unknown>,
  context: NodeExecutionContext,
): Promise<string> {
  const def = nodeRegistry.get(toolName);
  if (!def) {
    return `Error: Tool "${toolName}" is not registered. Available tools depend on your configuration.`;
  }

  // Route keys to inputs vs params based on registered port IDs
  const inputPortIds = new Set(def.inputs.map((p) => p.id));
  const inputs: Record<string, unknown> = {};
  const params: Record<string, unknown> = { __nodeType: toolName };

  for (const [k, v] of Object.entries(actionInput)) {
    if (inputPortIds.has(k)) {
      inputs[k] = v;
    } else {
      params[k] = v;
    }
  }

  const syntheticCtx: NodeExecutionContext = {
    nodeId:    `${context.nodeId}--tool-${toolName}-${Date.now()}`,
    runId:     context.runId,
    inputs,
    params,
    outputDir: context.outputDir,
    signal:    context.signal,
  };

  const result = await nodeExecutor.execute(syntheticCtx);

  // Prefer text outputs; fall back to JSON
  const textOutputs = def.outputs
    .filter((p) => p.type === "text")
    .map((p) => result.outputs[p.id])
    .filter((v): v is string => typeof v === "string");

  if (textOutputs.length > 0) return textOutputs.join("\n");

  // Any string outputs (regardless of declared port type)
  const anyStrings = Object.values(result.outputs).filter(
    (v): v is string => typeof v === "string",
  );
  if (anyStrings.length > 0) return anyStrings.join("\n");

  return JSON.stringify(result.outputs);
}

// ── Main executor ──────────────────────────────────────────────────────────────

/** Parse the `tools` param into an array of node type strings */
function parseToolTypes(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch { /* ignore */ }
  }
  return [];
}

export async function executeReactAgent(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // ── Resolve configuration ─────────────────────────────────────────────────

  const goal =
    (inputs.goal_in as string | undefined) ??
    (params.goal as string | undefined) ??
    "";

  if (!goal.trim()) {
    throw new Error(
      "ReAct Agent requires a goal. Set the Goal parameter or connect the goal_in port.",
    );
  }

  const provider  = (params.provider as string | undefined) ?? "anthropic";
  const modelRaw  = (params.model as string | undefined) ?? "";
  const apiKey    = (params.apiKey as string | undefined) ??
                    (params.__apiKey as string | undefined);
  const maxSteps  = Math.min(20, Math.max(1, Number(params.maxSteps ?? 10)));
  const toolTypes = parseToolTypes(params.tools);

  // Validate API key early (Ollama is exempt)
  if (!apiKey && provider !== "ollama") {
    throw new Error(
      `LLM provider "${provider}" is not configured. ` +
      `Enter your API key in the node's API Key field.`,
    );
  }

  // ── Build tool descriptions ───────────────────────────────────────────────

  const toolDefs = buildToolDefs(toolTypes);
  const llm      = createLLMClient(provider, modelRaw, apiKey);

  // ── Seed the conversation ─────────────────────────────────────────────────

  const systemPrompt = buildSystemPrompt(toolDefs);
  const messages: LLMMessage[] = [
    { role: "system",  content: systemPrompt },
    { role: "user",    content: `Goal: ${goal}` },
  ];

  const steps: AgentStep[] = [];
  let finalAnswer: string | null = null;

  // ── ReAct loop ────────────────────────────────────────────────────────────

  for (let i = 0; i < maxSteps; i++) {
    if (context.signal?.aborted) break;

    // Call the LLM
    let response: string;
    try {
      response = await llm.chat(messages, {
        maxTokens: 1024,
        signal: context.signal,
      });
    } catch (err) {
      throw new Error(
        `LLM call failed on step ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    messages.push({ role: "assistant", content: response });

    const parsed = parseReActResponse(response);

    // ── Final Answer branch ───────────────────────────────────────────────
    if (parsed.finalAnswer !== undefined) {
      const step: AgentStep = {
        index:     i,
        thought:   parsed.thought,
        isFinal:   true,
        answer:    parsed.finalAnswer,
        timestamp: Date.now(),
      };
      steps.push(step);
      context.onAgentStep?.(step);
      finalAnswer = parsed.finalAnswer;
      break;
    }

    // ── Action branch ─────────────────────────────────────────────────────
    if (parsed.action) {
      let observation: string;
      try {
        observation = await callTool(parsed.action, parsed.actionInput ?? {}, context);
      } catch (err) {
        observation = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const step: AgentStep = {
        index:       i,
        thought:     parsed.thought,
        action:      { tool: parsed.action, params: parsed.actionInput ?? {} },
        observation,
        isFinal:     false,
        timestamp:   Date.now(),
      };
      steps.push(step);
      context.onAgentStep?.(step);

      // Feed observation back into the conversation
      messages.push({ role: "user", content: `Observation: ${observation}` });

    } else {
      // LLM didn't follow the format — treat full response as final answer
      const step: AgentStep = {
        index:     i,
        thought:   parsed.thought,
        isFinal:   true,
        answer:    response,
        timestamp: Date.now(),
      };
      steps.push(step);
      context.onAgentStep?.(step);
      finalAnswer = response;
      break;
    }
  }

  // If maxSteps exhausted without a final answer
  if (!finalAnswer) {
    finalAnswer =
      steps.length > 0
        ? `Agent reached the step limit (${maxSteps}) without a final answer. Last thought: ${steps[steps.length - 1].thought}`
        : `Agent produced no output.`;
  }

  return {
    outputs: {
      answer_out: finalAnswer,
      steps_out:  steps,
    },
    cost: 0,
    metadata: {
      provider,
      model: modelRaw || undefined,
      stepsCount: steps.length,
      toolsUsed:  toolTypes,
      goalLength: goal.length,
    },
  };
}
