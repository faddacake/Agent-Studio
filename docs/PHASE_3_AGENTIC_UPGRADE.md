# Phase 3: Agentic Upgrade — Feature Summary

> Five features added to Agent Studio's ReAct Agent system.  
> All features are backward compatible. Existing workflows are unaffected.

---

## Feature A: Web Search Tool

**Node type:** `web-search`  
**Category:** Utility  
**Commits:** `5e79d1c`, `490fdab`

### What it does

Adds a **Web Search** canvas node that queries DuckDuckGo (free, no API key) or SerpAPI (requires key) and returns structured results. The node is also callable as a tool by any ReAct Agent via `tools: ["web-search"]`.

### Files

| Action | File |
|--------|------|
| Modified | `packages/shared/src/nodeTypes.ts` |
| Modified | `packages/shared/src/nodeDefinitions/capabilities.ts` |
| Created | `packages/engine/src/capabilities/webSearch.ts` |
| Created | `packages/engine/src/capabilities/__tests__/webSearch.test.ts` |
| Modified | `packages/engine/src/capabilities/index.ts` |
| Modified | `packages/engine/src/index.ts` |

### Inputs / Outputs

| Port | Type | Description |
|------|------|-------------|
| `query_in` | Text | Search query (optional — falls back to `query` param) |
| `results_out` | JSON | Structured array of `{ title, url, snippet }` results |
| `content_out` | Text | Numbered plain-text summary of results |

### Parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `query` | string | — | Query if `query_in` port is not wired |
| `provider` | enum | `duckduckgo` | `duckduckgo` (free) or `serpapi` |
| `maxResults` | number | 5 | 1–10 |
| `apiKey` | string | — | Required for SerpAPI only |

### How to test

1. Add Node → search "Web Search" → add it to the canvas
2. Set `Query` to `"latest AI benchmarks"`, leave provider as `duckduckgo`
3. Run the workflow — `results_out` contains structured JSON, `content_out` is readable text
4. Or add a ReAct Agent, set `Tools` to `["web-search"]`, and give it a question requiring current info

---

## Feature B: Reflection / Self-Critique Loop

**Affects:** `react-agent` node  
**Commits:** `1dcd6cb`, `621c047`

### What it does

After the ReAct Agent produces a Final Answer, it optionally runs 1–3 **self-critique rounds**. Each round asks the LLM to critique its own answer and produce an improved version. The loop stops early if the LLM signals no revision is needed. Reflection steps appear in the Run Debugger tagged separately from reasoning steps.

### Files

| Action | File |
|--------|------|
| Modified | `packages/shared/src/nodeDefinition.ts` |
| Modified | `packages/shared/src/nodeDefinitions/capabilities.ts` |
| Modified | `packages/engine/src/capabilities/reactAgent.ts` |
| Created | `packages/engine/src/capabilities/__tests__/reactAgent.test.ts` |

### New params on the ReAct Agent node

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `reflection` | boolean | `false` | Enable self-critique after Final Answer |
| `reflectionRounds` | number | 2 | Max critique rounds (1–3). Set `reflection: false` to disable, not `reflectionRounds: 0` |

### New exports from `reactAgent.ts`

```typescript
export function buildReflectionPrompt(goal, answer, roundNum): string
export function parseReflectionResponse(text): ParsedReflection
// interface ParsedReflection { critique, revisedAnswer?, noRevisionNeeded }
```

### How to test

1. Open any ReAct Agent node → Inspector → Behavior group
2. Toggle **Enable Reflection** on, set **Reflection Rounds** to 2
3. Run the workflow — the Run Debugger shows Reflection steps after the Final Answer
4. The final output reflects the self-improved answer

---

## Feature E: Polish & Bug Fixes

**Affects:** Canvas toolbar, Node Palette, ReactFlow viewport  
**Commit:** `2b97e8e`

### What it does

Three UI polish fixes:

#### 1. Toolbar overflow at narrow widths
The workflow toolbar rows now scroll horizontally (hidden scrollbar) at narrow widths instead of wrapping over the Properties Inspector.

#### 2. Node position flash on load
`fitView` was firing unconditionally, causing a jarring viewport jump when a workflow loaded. Now fires only when nodes are present (`nodes.length > 0`) with a smooth 200ms animation.

#### 3. Add Node button positioning
The floating `+` button (shown when the Node Palette is closed) was positioned with `fixed left-4 top-20`, landing it inside the app sidebar (16px from the viewport edge). Replaced with a zero-width flex container and `absolute` positioning so it anchors to the canvas left edge regardless of sidebar width.

### Files

| Action | File |
|--------|------|
| Modified | `apps/web/src/components/canvas/WorkflowCanvas.tsx` |
| Modified | `apps/web/src/components/canvas/NodePalette.tsx` |

### How to test

1. Load a saved workflow — no viewport flash/jump on load
2. Close the Node Palette — the `+` button appears at the canvas left edge (not inside the sidebar)
3. Narrow the browser window — the toolbar scrolls horizontally instead of overlapping the inspector

---

## Feature C: Human-in-the-Loop Approval Steps

**Affects:** `react-agent` node  
**Commit:** `402b35f`

### What it does

When **Require Approval** is enabled on a ReAct Agent node, the agent pauses after proposing its Final Answer and waits for human review. The Run Debugger shows an amber banner with the pending answer and Approve / Reject buttons. Rejection injects feedback back into the LLM conversation and the agent continues reasoning.

### Files

| Action | File |
|--------|------|
| Modified | `packages/shared/src/nodeDefinition.ts` |
| Modified | `packages/shared/src/nodeDefinitions/capabilities.ts` |
| Modified | `packages/engine/src/capabilities/reactAgent.ts` |
| Modified | `packages/engine/src/runCoordinator.ts` |
| Modified | `apps/web/src/app/api/workflows/[id]/runs/route.ts` |
| Created | `apps/web/src/app/api/workflows/[id]/runs/[runId]/approve/route.ts` |
| Modified | `apps/web/src/components/debugger/RunDebuggerPanel.tsx` |
| Modified | `apps/web/src/components/canvas/WorkflowCanvas.tsx` |

### New param on the ReAct Agent node

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `requireApproval` | boolean | `false` | Pause before finalizing the agent's answer |

### New API endpoint

```
POST /api/workflows/:id/runs/:runId/approve
Body: { approved: boolean; feedback?: string }
Returns: { success: true } | 404
```

### New types (in `@aistudio/shared`)

```typescript
interface ApprovalResult {
  approved: boolean;
  feedback?: string;
}

// On NodeExecutionContext:
onApprovalRequired?: (pendingAnswer: string, stepIndex: number) => Promise<ApprovalResult>;

// On AgentStep:
requiresApproval?: boolean;
```

### How to test

1. Add a ReAct Agent node → Inspector → Behavior group → toggle **Require Approval** on
2. Run any workflow using this agent
3. When the agent reaches a Final Answer, the run pauses — an **amber banner** appears in the Run Debugger
4. Click **✓ Approve** → run completes normally
5. Click **✗ Reject** → type optional feedback → **Send Rejection** → agent revises and proposes a new answer

---

## Feature D: Multi-Agent Teams

**Node type:** `sub-agent`  
**Commits:** `1971346`, `3666bdc`, `c238cdc`, `76423f7`

### What it does

Adds a **Sub-Agent** canvas node — a focused worker agent with a custom role (persona) that a parent ReAct Agent can call as a tool. Enables **Planner → Researcher → Executor** multi-agent patterns. API credentials are inherited from the parent agent automatically.

### Files

| Action | File |
|--------|------|
| Modified | `packages/shared/src/nodeTypes.ts` |
| Modified | `packages/shared/src/nodeDefinitions/capabilities.ts` |
| Modified | `packages/shared/src/nodeDefinitions/index.ts` |
| Created | `packages/engine/src/capabilities/subAgent.ts` |
| Created | `packages/engine/src/capabilities/__tests__/subAgent.test.ts` |
| Modified | `packages/engine/src/capabilities/reactAgent.ts` |
| Modified | `packages/engine/src/capabilities/index.ts` |
| Modified | `packages/engine/src/index.ts` |
| Created | `apps/web/src/components/canvas/SubAgentNode.tsx` |
| Modified | `apps/web/src/components/canvas/WorkflowCanvas.tsx` |
| Modified | `apps/web/src/stores/workflowStore.ts` |

### Inputs / Outputs

| Port | Type | Description |
|------|------|-------------|
| `task_in` | Text | The task or goal for this sub-agent |
| `result_out` | Text | The sub-agent's final answer |
| `steps_out` | JSON | The reasoning steps taken |

### Parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `role` | string | — | Persona / specialization (e.g. "You are a research specialist…") |
| `tools` | JSON array | `[]` | Node types available to this sub-agent |
| `maxSteps` | number | 5 | Max ReAct reasoning steps (1–15) |
| `provider` | enum | *(inherit)* | Leave blank to inherit from parent agent |
| `model` | string | *(inherit)* | Leave blank to inherit from parent agent |
| `apiKey` | string | *(inherit)* | Leave blank to inherit from parent agent |

### Changes to `reactAgent.ts`

| Change | Detail |
|--------|--------|
| `callTool` credential injection | Injects `__parentCredentials: { apiKey, provider, model }` + `__agentDepth: depth+1` into every tool call's synthetic context |
| `__rolePrefix` support | If `params.__rolePrefix` is set, it's prepended to the system prompt (used by sub-agent executor to inject the role) |
| Depth guard | Throws `"Sub-agent nesting depth exceeded (max depth: 2)"` when `__agentDepth > 2`. NaN-safe: non-numeric values are treated as 0 |

### How to use — Planner → Researcher → Executor

```
Canvas setup:
  [Sub-Agent: Researcher]
    Role: "You are a research specialist focused on finding accurate, up-to-date information."
    Tools: ["web-search"]
    Max Steps: 5
    (leave provider/model/apiKey blank — inherited from parent)

  [ReAct Agent: Planner]
    Tools: ["sub-agent"]
    Goal: "Research recent LLM benchmarks and write a concise summary"
    API Key: sk-...
```

The Planner calls the Researcher sub-agent as a tool, delegating the search work. The Sub-Agent node shows an indigo **depth: 1** badge during execution. Max nesting depth is 2 levels (sub-agent of a sub-agent is the deepest allowed).

### Visual identity

The Sub-Agent canvas node uses an **indigo** color scheme (distinct from `react-agent`'s violet and `obsidian-memory`'s emerald), a Users icon, role text below the label, and a depth badge when nested.

---

## Test Coverage Summary

| Feature | Tests | Location |
|---------|-------|----------|
| A — Web Search | 9 | `packages/engine/src/capabilities/__tests__/webSearch.test.ts` |
| B — Reflection | 12 | `packages/engine/src/capabilities/__tests__/reactAgent.test.ts` |
| C — HITL Approval | (integration) | Covered by run coordinator + API route |
| D — Multi-Agent | 7 (5 sub-agent + 2 depth guard) | `__tests__/subAgent.test.ts` + `reactAgent.test.ts` |
| **Total** | **212** | All passing |

---

*Generated 2026-05-20*
