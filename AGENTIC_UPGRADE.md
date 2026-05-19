# Itera Studio — Agentic Upgrade

Tracks the phased rollout of autonomous agent capabilities on the Itera Studio canvas.

---

## Phase 1 — ReAct Agent Node ✅ COMPLETE

**Date completed:** 2026-05-19  
**Branch:** `blissful-mahavira-5e55f2`

### What was built

A fully functional ReAct (Reasoning + Acting) agent node that runs an autonomous
Thought → Action → Observation loop until it produces a Final Answer.
Each reasoning step is streamed live to the Run Debugger via a new `agent:step`
SSE event, so you can watch the agent think in real time.

### Architecture summary

| Layer | Change |
|---|---|
| `packages/shared` | `AgentStep` type; `NodeCategory.Agent` (order -1); `NodeType.ReactAgent`; `onAgentStep?` on `NodeExecutionContext`; `reactAgentNode` definition |
| `packages/engine` | Full LLM adapter layer (`anthropicClient`, `openaiClient`, `grokClient`, `ollamaClient`, factory `createLLMClient`); `executeReactAgent` capability; `RunCoordinator.onAgentStep()`; `agentSteps` on `NodeState` + `NodeDebugInfo`; new `agent:step` `RunEvent` |
| `apps/web` | `AgentNode.tsx` specialized React Flow component with live step trace; `NodePalette` Agent category; `WorkflowCanvas` node-type registration; `workflowStore` `toFlowNode` routing; SSE dispatch wires `onAgentStep` → coordinator |

### LLM providers supported

| Provider | Default model | Key required |
|---|---|---|
| Anthropic | `claude-3-5-haiku-20241022` | Yes — `sk-ant-…` |
| OpenAI | `gpt-4o-mini` | Yes — `sk-…` |
| Grok (xAI) | `grok-3-mini` | Yes — `xai-…` |
| Ollama | `llama3.2` | No — local server |

All keys are BYO and stored only in the node's `apiKey` param.
The platform never logs or persists them beyond the workflow definition.

### Key design decisions

- **Stop token `Observation:`** — prevents the LLM from hallucinating its own
  observations; the loop injects real tool results itself.
- **`temperature: 0.2`** — consistent ReAct format with a small variance to avoid
  stuck loops.
- **Tool routing by port ID** — Action Input JSON keys matching registered input
  port IDs go to `inputs`; all other keys become `params`. No tool-specific
  glue code needed.
- **Specialized React Flow node type** — `SPECIALIZED_NODE_TYPES` set in
  `toFlowNode` lets agent nodes render with the full step-trace UI while every
  other node continues to use the standard `CustomNode` component.
- **Backward-compatible** — zero changes to existing node definitions, execution
  graph, BullMQ jobs, or candidate contract.

### Node defaults

| Param | Default |
|---|---|
| Goal | "Research and summarize the key benefits of using a ReAct agent for multi-step reasoning tasks." |
| Provider | `anthropic` |
| Max Steps | `8` |
| Tools | `[]` (reasoning-only) |

### Manual E2E test guide

These steps verify the agent end-to-end once the worktree is merged and Docker
is rebuilt:

**Setup:**
1. Open the canvas, click **Add Node** → **Agent** → **ReAct Agent**
2. Set provider to `ollama` (no API key needed) or enter your Anthropic key
3. Set Goal to: `"List 3 AI image generation models released in 2024 and one key feature of each"`
4. Leave Tools empty (reasoning-only test)
5. Click **Run**

**Expected results:**
- Run Debugger shows live `Thought → …` steps appearing as the loop iterates
- Each step card shows the thought text; action steps show the tool name and observation
- After the loop, `answer_out` contains a structured answer
- Run status shows **Completed** with step count in metadata

**Tool use test (requires Prompt Template node):**
1. Add a **Prompt Template** node to the canvas; wire `answer_out → text_in`
2. Set Agent tools param to `["prompt-template"]`
3. Set Goal to: `"Use the prompt-template tool to format a tweet about AI agents"`
4. Run — verify the agent calls the tool and passes the observation back into its loop

**Error handling tests:**
- Wrong API key → node errors immediately with `"Anthropic auth error: …"`
- Ollama not running → network error surfaces clearly with `"Ensure Ollama is running (ollama serve)"`
- `maxSteps` exhausted → `answer_out` contains the step-limit message with last thought

---

## Phase 2 — Planned

> Not yet started. Scope TBD based on Phase 1 feedback.

Candidate features:
- **Tool-result rendering** — show tool output inline in the step trace (images,
  structured JSON) rather than raw text
- **Memory nodes** — persistent key-value store accessible as a tool
- **Web search tool** — lightweight search node (SerpAPI / DuckDuckGo) callable
  by the agent
- **Parallel tool execution** — allow the agent to call multiple tools in one
  step and fan-in observations
- **Agent-to-Agent delegation** — one ReAct Agent node can call another as a
  sub-agent tool
- **Budget enforcement** — hard token/cost cap per run with graceful termination
- **Streaming observations** — pipe long tool outputs as a stream rather than
  blocking until completion
