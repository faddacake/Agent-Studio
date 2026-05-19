# ReAct Agent Node — Phase 1 Design

**Date:** 2026-05-19  
**Status:** Implemented  

---

## Goal

Add a ReAct (Reasoning + Acting) Agent node to Itera Studio as the first step in turning the platform into a visual agentic workflow builder. The agent node lets users drop an autonomous LLM agent onto the canvas, give it a goal and a set of tools (canvas nodes), and watch it reason live through Thought/Action/Observation cycles until it reaches a final answer.

---

## Approach

**Approach B — Step-emitting** was chosen:
- Custom ~150-line ReAct loop (no LangGraph dependency)
- `onAgentStep` callback on `NodeExecutionContext` → coordinator emits `agent:step` RunEvent → SSE snapshot → Run Debugger shows live T→A→O trace
- Coupling is minimal: an optional callback on an existing context type

---

## Architecture

```
packages/shared/
  nodeDefinition.ts          ← PATCHED: AgentStep type, onAgentStep callback, NodeCategory.Agent
  nodeTypes.ts               ← PATCHED: NodeType.ReactAgent = "react-agent"
  nodeDefinitions/
    capabilities.ts          ← PATCHED: reactAgentNode NodeDefinition
    index.ts                 ← PATCHED: export reactAgentNode

packages/engine/
  runCoordinator.ts          ← PATCHED: agentSteps in NodeState, agent:step RunEvent, onAgentStep()
  debugSnapshot.ts           ← PATCHED: agentSteps in NodeDebugInfo
  llm/                       ← NEW: LLM text adapter layer
    llmClient.ts             ← LLMTextClient interface + LLMMessage type
    anthropicClient.ts       ← Anthropic Messages API
    openaiClient.ts          ← OpenAI Chat Completions API
    grokClient.ts            ← Grok/xAI (OpenAI-compatible wrapper)
    ollamaClient.ts          ← Ollama local API
    index.ts                 ← createLLMClient() factory
  capabilities/
    reactAgent.ts            ← NEW: ReAct loop executor
    index.ts                 ← PATCHED: registerCapability("react-agent", executeReactAgent)
  index.ts                   ← PATCHED: LLM + reactAgent exports

apps/web/
  api/workflows/[id]/runs/route.ts  ← PATCHED: onAgentStep wired to coordinator
  stores/workflowStore.ts           ← PATCHED: toFlowNode uses "react-agent" type for agent nodes
  components/canvas/
    AgentNode.tsx                   ← NEW: specialized visual component with live step trace
    WorkflowCanvas.tsx              ← PATCHED: "react-agent": AgentNode in nodeTypes
    NodePalette.tsx                 ← PATCHED: NodeCategory.Agent group (order -1, first in palette)
```

---

## LLM Text Adapter Layer

All adapters implement `LLMTextClient`:

```typescript
interface LLMTextClient {
  chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string>;
}
```

| Provider | Default model | Auth |
|---|---|---|
| `anthropic` | claude-3-5-haiku-20241022 | `apiKey` param |
| `openai` | gpt-4o-mini | `apiKey` param |
| `grok` | grok-3-mini | `apiKey` param (OpenAI-compatible) |
| `ollama` | llama3.2 | none (local) |

Factory: `createLLMClient(provider, model, apiKey, ollamaBaseUrl?)`  
No external SDKs — all providers use `fetch` directly.

---

## ReAct Loop

The loop in `capabilities/reactAgent.ts`:

1. Build system prompt with tool descriptions (from NodeRegistry)
2. Loop up to `maxSteps` times:
   - Call LLM with message history
   - Parse response for `Thought:` / `Action:` / `Final Answer:` format
   - If `Action:` → call the tool node via `nodeExecutor.execute()` with a synthetic context
   - Append `Observation:` to message history
   - Call `context.onAgentStep(step)` after each cycle
   - If `Final Answer:` → break
3. Return `{ answer_out: string, steps_out: AgentStep[] }`

**Tool routing** (smart input/param split): Action Input JSON keys matching registered input port IDs go to `inputs`, all other keys go to `params`. This makes tool calling work correctly for utility nodes like `prompt-template`.

---

## Agent Step Type

```typescript
interface AgentStep {
  index: number;
  thought: string;
  action?: { tool: string; params: Record<string, unknown> };
  observation?: string;
  isFinal: boolean;
  answer?: string;
  timestamp: number;
}
```

---

## SSE Live Trace

Each `onAgentStep` call:
1. `coordinator.onAgentStep(runId, nodeId, step)` → pushes to `NodeState.agentSteps`
2. Emits `{ type: "agent:step", ... }` RunEvent
3. SSE route catches the event, rebuilds `RunDebugSnapshot` (which includes `NodeDebugInfo.agentSteps`)
4. Sends updated snapshot to all connected clients
5. `AgentNode.tsx` reads `node.agentSteps` from the snapshot and renders live badges

---

## Node Definition

- **Type:** `react-agent`
- **Category:** `Agent` (new — appears first in palette)
- **runtimeKind:** `capability`
- **Ports:**
  - Input: `goal_in` (text, optional — overrides Goal param when connected)
  - Output: `answer_out` (text), `steps_out` (json)
- **Params:** goal (multiline), provider (enum), model (string), apiKey (string), maxSteps (number 1–20), tools (json array of node type strings)

---

## Frontend: AgentNode.tsx

Specialized React Flow component registered as `"react-agent"` node type. Renders:
- Violet-themed header with robot icon + "Agent" badge
- Live step trace: last 3 steps visible, expandable to all
- Each `StepBadge` shows step index, label, thought preview, expandable detail
- "Thinking…" pulse while running with no steps yet
- Step count summary when completed

All other nodes continue using the existing `CustomNode` generic renderer.

---

## API Key Model

BYO (Bring Your Own) key per node instance. Keys are stored only in the workflow node params field — never in platform DB or logs. Ollama (local) requires no key.

---

## Testing

1. Add a **ReAct Agent** node to a workflow canvas
2. Set Goal: "Explain the concept of recursion in one paragraph"
3. Set Provider: anthropic / openai / ollama
4. Enter API key in the node's API Key field
5. Run — watch the AgentNode show live T→A→O steps
6. Check Run Debugger panel → node should show agent steps in its debug info

For tool use:
1. Add `tools: ["prompt-template"]` to the agent params
2. Run with a goal that would benefit from template expansion
3. Agent should call `prompt-template` as a tool and show the observation

---

## Phase 2 (Future)

- Agent can wire its output ports directly to downstream canvas nodes (multi-agent graphs)
- Canvas-node tools selected visually (click to connect)
- Memory/scratch pad port (persistent context across steps)
- Streaming token-by-token Thought display
- Worker (BullMQ) execution for long-running agents
