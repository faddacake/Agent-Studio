# Architecture: Node Platform Plan

Date: 2026-03-05

---

## 1. What Was Changed

### New files created in `packages/shared/src/`

| File | Purpose |
|------|---------|
| `nodeDefinition.ts` | Core types: `NodeDefinition`, `PortDefinition`, `NodeParameterField`, `NodeParameterSchema`, `UISchema`, `NodeRuntimeKind`, `NodeCategory`, `CostEstimate`, `NodeExecutionContext`, `NodeExecutionResult`, `SerializableNodeDefinition`. Zod schemas for wire-safe serialization. |
| `nodeRegistry.ts` | `NodeRegistry` class with `register()`, `get()`, `getByCategory()`, `getAvailable()`, `getAllSerializable()`. Global singleton `nodeRegistry`. |
| `nodeDefHelpers.ts` | Utilities: `getDefaultParams()`, `toWorkflowPorts()`, `validateParams()`, `arePortsCompatible()`, `getNodeSummary()`. |
| `modelBridge.ts` | `modelToNodeDefinition()` and `modelsToNodeDefinitions()` — converts existing `ModelOption` catalog entries into registry-compatible `NodeDefinition` objects. |
| `nodeDefinitions/index.ts` | Aggregator that registers all built-in definitions via `registerBuiltInNodes()`. |
| `nodeDefinitions/io.ts` | `imageInputNode`, `outputNode` definitions. |
| `nodeDefinitions/utility.ts` | `resizeNode`, `cropNode`, `formatConvertNode`, `compositingNode`, `promptTemplateNode`, `commentNode` definitions. |
| `nodeDefinitions/provider.ts` | `imageGenerationNode`, `videoGenerationNode` templates. `createProviderNodeDefinition()` factory for model-specific nodes. |
| `nodeDefinitions/capabilities.ts` | `clipScoringNode`, `socialFormatNode`, `exportBundleNode`, `rankingNode` definitions. |

### Modified files

| File | Change |
|------|--------|
| `packages/shared/src/nodeTypes.ts` | Added `ClipScoring`, `SocialFormat`, `ExportBundle`, `Ranking` to the `NodeType` enum. |
| `packages/shared/src/index.ts` | Added exports for all new types, registry, definitions, helpers, and bridge. |

### New file in `apps/web/src/lib/`

| File | Purpose |
|------|---------|
| `nodeRegistryInit.ts` | `initializeNodeRegistry()` — one-call setup that registers built-in nodes + model catalog entries. |

---

## 2. What Architectural Problem This Solves

### Before

- `NodeType` was a bare enum — consumers had to hardcode what each type meant (its ports, parameters, runtime behavior).
- Model definitions lived only in `apps/web/src/config/models.ts` — frontend-only, invisible to the engine.
- There was no way for the inspector to render a form from schema — every model would need hand-built UI.
- Export, scoring, and social formatting were standalone services with no node contract — they couldn't participate in workflow pipelines.
- Adding a new model required changes in multiple places with no single registration point.

### After

- Every node type (utility, provider, capability) is described by a `NodeDefinition` with ports, parameters, runtime kind, and optional UI hints.
- The `NodeRegistry` is a single query point for the inspector, palette, engine, and validator.
- New models can be registered at startup via `createProviderNodeDefinition()` or `modelToNodeDefinition()` without touching UI code.
- Scoring, formatting, and export are defined as capability nodes and can be composed in workflows.
- The engine can dispatch execution by `runtimeKind` instead of hardcoding model-specific logic.

---

## 3. What Was Added in Session 2 — Inspector + Execution Engine

### Schema-driven Inspector Components (`apps/web/src/components/inspector/`)

| File | Purpose |
|------|---------|
| `SchemaField.tsx` | Atomic field renderer for all parameter types. Infers widget from `NodeParameterField.type` (text, textarea, slider, toggle, dropdown, upload, json, color). Zero knowledge of specific models. |
| `SchemaForm.tsx` | Renders complete parameter forms from `parameterSchema` + `uiSchema`. Supports collapsible grouped sections, hidden fields, widget overrides. Falls back to flat rendering if no groups. |
| `NodeConfig.tsx` | Schema-driven config panel. Queries `nodeRegistry.get(node.type)`, renders SchemaForm from definition, validates with `validateParams()`, shows cost badge, falls back to raw JSON editor for unknown types. |
| `InspectorPanel.tsx` | Right-side panel with 3 tabs: Config (NodeConfig), Ports (color-coded port list), Run (placeholder for SSE). |
| `index.ts` | Barrel export for all inspector components. |

### Execution Engine (`packages/engine/src/`)

| File | Purpose |
|------|---------|
| `executionGraph.ts` | `buildExecutionGraph()` — DAG builder from WorkflowGraph. Kahn's topological sort with cycle detection. `computeTiers()` for parallel scheduling. `getReadyNodes()` returns pending nodes whose deps are complete. `resolveNodeInputs()` maps upstream outputs to downstream input ports via edges. |
| `runCoordinator.ts` | `RunCoordinator` — manages run lifecycle. Node state machine: pending→queued→running→completed/failed/cancelled. Run state machine: pending→running→completed/failed/partial_failure/cancelled/budget_exceeded. Event system (`RunEvent` types). Budget cap enforcement. Downstream cancellation on failure. `DispatchJob` callback for queue integration. |
| `executor.ts` | `NodeExecutor` — dispatch by `NodeRuntimeKind`: provider→`ProviderExecutor`, local→`LocalExecutor` map, capability→`CapabilityExecutor` map, virtual→passthrough. Resolves node type via `__nodeType` param or `providerId/modelId` fallback. Runs `definition.validate()` before execution. |
| `index.ts` | Updated from stub to full exports of all engine modules. |

### Worker Integration (`packages/worker/src/`)

| File | Purpose |
|------|---------|
| `nodeJobProcessor.ts` | `processNodeJob()` — bridges BullMQ jobs and the engine executor. Builds `NodeExecutionContext` from `NodeJobData`, delegates to `nodeExecutor.execute()`, returns `NodeJobResult`. |
| `index.ts` | Updated to use `nodeJobProcessor` in prediction job handler. |
| `package.json` | Added `/engine` and `/shared` workspace dependencies. |

---

## 4. What Was Added in Session 3 — Registry-Aware Node Palette

### Canvas Components (`apps/web/src/components/canvas/`)

| File | Purpose |
|------|---------|
| `NodePalette.tsx` | Registry-driven palette sidebar. Calls `nodeRegistry.getAvailable()` for all node listings — no hardcoded lists. Groups by `NodeCategory` (with Input/Output merged). Text filter searches label, description, type, and tags. Shows label, description, runtime badge, port counts, and provider ID. Collapsible category sections. |
| `createWorkflowNode.ts` | `createWorkflowNode(definition, position)` — converts a `NodeDefinition` into a `WorkflowNode` with correct type, default params via `getDefaultParams()`, ports via `toWorkflowPorts()`, provider info, and sensible retry/timeout defaults by runtime kind. |
| `index.ts` | Barrel export for all canvas components. |

### How it works

1. On mount, `NodePalette` calls `initializeNodeRegistry()` (idempotent) which registers built-in nodes + model catalog entries via the model bridge.
2. All node listings come from `nodeRegistry.getAvailable()` — a single source of truth.
3. Nodes are grouped by `NodeCategory` using a display-order map. Input and Output share a group.
4. The search filter matches against `label`, `description`, `type`, and `tags` (case-insensitive substring).
5. When a user clicks a node, `createWorkflowNode()` builds a complete `WorkflowNode` from the definition with correct defaults, ports, and provider metadata.
6. Model catalog entries (IMAGE_MODELS, VIDEO_MODELS) flow through the model bridge → registry → palette. No parallel data source.

---

## 4b. What Was Added in Session 4 — Workflow Debugger

### Engine Debug Helper (`packages/engine/src/debugSnapshot.ts`)

| Export | Purpose |
|--------|---------|
| `buildDebugSnapshot(run)` | Projects `RunState` + `ExecutionGraph` into a flat, serializable `RunDebugSnapshot` for the debugger UI. Computes tier assignments, topological order indices, blocked reasons, output key summaries, and per-status counts. |
| `buildGraphPreview(graph)` | Preview-only variant for showing execution order / tiers before a run starts (no run state needed). |
| `NodeDebugInfo` | Per-node structure with label, type, runtimeKind, status, tier, topoIndex, dependencies, dependents, attempt, timing, cost, error, blockedReason, outputKeys, inputKeys, providerId, modelId. |
| `BlockedReason` | Discriminated union: `waiting_on_dependency`, `failed_upstream`, `cancelled_upstream`, `budget_exceeded`, `validation_error`, `run_cancelled`. |
| `RunDebugSnapshot` | Run-level snapshot with summary counts, tiers, execution order, all NodeDebugInfo, cost/budget/timing. |

### Debugger UI (`apps/web/src/components/debugger/`)

| File | Purpose |
|------|---------|
| `RunDebuggerPanel.tsx` | Debugger panel showing: run status badge, interactive summary pills (filter by status), cost/budget/timing, tier view vs flat topological view, collapsible per-node rows with status dot + runtime badge + duration, expanded detail showing type/ID/tier/topo-order/attempts/provider/model/timing/dependencies/dependents/data-flow/blocked-reason/error. |
| `index.ts` | Barrel export. |

### How it works

1. The engine's `buildDebugSnapshot(runState)` shapes a `RunState` into a flat `RunDebugSnapshot` — one function call, fully serializable.
2. `RunDebuggerPanel` takes this snapshot as a prop and renders everything from it. No engine imports in the UI beyond types.
3. Blocked reasons are computed from the graph topology + node states: why a node is waiting, which upstream failed, whether budget stopped it, etc.
4. Two view modes: **Tier view** groups nodes by execution tier (parallel scheduling level), **Flat view** shows topological order.
5. Summary pills act as status filters — click to filter the node list to just failed, running, etc.
6. The `onNodeClick` callback enables future canvas highlighting integration.
7. `buildGraphPreview(graph)` enables showing execution order before a run starts.

## 4c. What Was Added in Session 5 — React Flow Canvas Integration

### Zustand Workflow Store (`apps/web/src/stores/workflowStore.ts`)

| Export | Purpose |
|--------|---------|
| `useWorkflowStore` | Zustand store managing workflow nodes, edges, selection, palette/inspector/debugger UI state, save/load, and all React Flow callbacks (onNodesChange, onEdgesChange, onConnect). |
| `toFlowNode()` / `toFlowEdge()` | Adapters converting `WorkflowNode`/`WorkflowEdge` to React Flow `Node`/`Edge`. |
| `fromFlowNode()` | Reverse adapter for extracting `WorkflowNode` from React Flow state. |

### Canvas Components (`apps/web/src/components/canvas/`)

| File | Purpose |
|------|---------|
| `CustomNode.tsx` | Memoized React Flow custom node with color-coded port handles (left=inputs, right=outputs), label, runtime kind badge, and selection ring. Handle positions auto-distribute based on port count. |
| `WorkflowCanvas.tsx` | Main canvas composition: ReactFlowProvider wrapper, ReactFlow with Background/Controls/MiniMap, NodePalette (left), InspectorPanel (right, on selection), RunDebuggerPanel (bottom, toggleable). Save button with dirty state tracking. Keyboard shortcut Cmd+S to save. |

### Workflow Editor Page (`apps/web/src/app/(app)/workflows/[id]/page.tsx`)

Replaced placeholder with full client component that fetches workflow from API, parses the graph JSON, loads it into the Zustand store, and renders `WorkflowCanvas`.

### How it works

1. The Zustand store (`useWorkflowStore`) is the single source of truth for all canvas state — nodes, edges, selection, UI panel visibility, and dirty tracking.
2. `WorkflowCanvas` wraps `ReactFlow` in a `ReactFlowProvider` and composes all sidebar panels: `NodePalette` (left), `InspectorPanel` (right on selection), `RunDebuggerPanel` (bottom on toggle).
3. `CustomNode` renders each node with color-coded port handles matching the port type (image=purple, video=orange, text=green, number=blue, json=yellow) and a runtime kind badge (AI/Local/Virtual/Cap).
4. The palette's `onAddNode` callback creates nodes centered in the viewport via `screenToFlowPosition`.
5. Clicking a node opens the inspector; clicking the pane deselects. `InspectorPanel` receives a `WorkflowNode` reconstructed from React Flow state via `fromFlowNode()`.
6. The save button persists the graph via `PATCH /api/workflows/:id` with `getWorkflowGraph()` reconstructing the `WorkflowGraph` from React Flow state.
7. `@xyflow/react` and `zustand` added as dependencies.

## 4d. What Was Added in Session 6 — SSE Run Updates

### SSE Streaming (`apps/web/src/app/api/workflows/[id]/runs/[runId]/events/route.ts`)

Rewrote placeholder SSE route to stream real RunCoordinator events. On connect, sends initial `RunDebugSnapshot`. Subscribes to coordinator events, rebuilds and streams snapshot on each change. Auto-closes on terminal run status. 15s heartbeat. Cleans up on client disconnect.

### Frontend Hook (`apps/web/src/hooks/useRunEvents.ts`)

`useRunEvents(workflowId, runId)` — opens EventSource, receives `snapshot` events, updates `workflowStore.debugSnapshot`. Auto-closes on terminal status. Returns `{ connected, error }`.

### Store Extension (`apps/web/src/stores/workflowStore.ts`)

Added `currentRunId` state and `setCurrentRunId()` action. When set, `useRunEvents` hook auto-subscribes to SSE updates.

## 4e. What Was Added in Session 7 — CLIP Scoring & Ranking Executors

### Upgraded Node Definitions (`packages/shared/src/nodeDefinitions/capabilities.ts`)

| Node | Changes |
|------|---------|
| `clipScoringNode` | Array-based `images_in` input port (`isArray: true`), optional `prompt_in`, `scores_out` + `scored_images_out` outputs. New params: `model` (enum: open_clip variants), `normalizeScores` (boolean), `topKPreview` (optional number). Added `uiSchema` with grouped sections. |
| `rankingNode` | New `items_in` + `scores_in` array input ports, `top_items_out` + `ranked_items_out` outputs. New params: `mode` (enum: topK/threshold/sort), `topK` (number), `threshold` (optional number). Added `uiSchema`. |

### Capability Executors (`packages/engine/src/capabilities/`)

| File | Purpose |
|------|---------|
| `clipScoring.ts` | `executeClipScoring()` — scores an array of images against an optional prompt. Uses mock CLIP scoring (deterministic pseudo-random). Supports normalization to 0–100 and topK preview filtering. Returns `scores_out` (number array) and `scored_images_out` (scored + ranked image objects). |
| `ranking.ts` | `executeRanking()` — sorts parallel items/scores arrays. Three modes: `topK` (take N best), `threshold` (filter by minimum score), `sort` (sort only, return all). Returns `top_items_out` and `ranked_items_out` with rank metadata. |
| `index.ts` | `registerCapabilityExecutors()` — registers both executors with the global `nodeExecutor` singleton. Call at worker startup. |

### Engine Exports (`packages/engine/src/index.ts`)

Added exports for `registerCapabilityExecutors`, `executeClipScoring`, `executeRanking`.

### How it works

1. Node definitions in `packages/shared` describe ports, params, and `runtimeKind: capability`.
2. The inspector renders config forms automatically from `parameterSchema` + `uiSchema` — no custom UI needed.
3. At worker startup, `registerCapabilityExecutors()` registers handlers keyed by node type.
4. During execution, `NodeExecutor.execute()` routes capability nodes to the registered handler via `executeCapability()`.
5. Executors receive `NodeExecutionContext` with resolved inputs/params and return `NodeExecutionResult`.
6. The mock CLIP scorer will be replaced with a real model backend (Python sidecar or ONNX) in a future session.

### Pipeline compatibility

These nodes chain naturally in workflows:

```
Prompt → ImageGen → ClipScoring → Ranking
```

- `ImageGen` outputs images on its output port
- `ClipScoring` receives them on `images_in` (array port), scores each, outputs `scores_out` + `scored_images_out`
- `Ranking` receives `scored_images_out` as `items_in` and `scores_out` as `scores_in`, sorts and selects

## 4f. What Was Added in Session 8 — Candidate Data Contract

### Problem

Capability nodes (ClipScoring, Ranking) worked but passed ad hoc arrays between each other — raw image arrays, parallel score arrays, inline `{ image, score, rank }` objects. This made it impossible for downstream nodes (SocialFormat, ExportBundle, best-of-N selection) to operate generically on scored/ranked results without custom glue per node pair.

### Solution

A lightweight shared data contract in `packages/shared/src/` that normalizes multi-candidate data flow.

### Types (`packages/shared/src/candidateTypes.ts`)

| Type | Purpose |
|------|---------|
| `CandidateItem` | Atomic unit — one image/video/text result with id, type, value, optional prompt, scores, rank, sourceNodeId, metadata |
| `CandidateScore` | Single metric measurement — metric name, raw value, optional normalized value, model |
| `CandidateCollection` | Batch of items with collectionType (generated/scored/ranked/selected/formatted) and provenance |
| `CandidateSelection` | Extends CandidateCollection with selectionMode, selectionMetric, totalBeforeSelection |
| `CandidateMetadata` | Extensible metadata bag (providerId, modelId, durationMs, cost, plus index signature) |
| `CandidateType` | `"image" \| "video" \| "text" \| "audio" \| "json"` |
| `CollectionType` | `"generated" \| "scored" \| "ranked" \| "selected" \| "formatted" \| "mixed"` |

### Helpers (`packages/shared/src/candidateHelpers.ts`)

| Function | Purpose |
|----------|---------|
| `attachScore(item, score)` | Immutably append a score to a candidate |
| `attachScores(collection, scoreFn)` | Score all items in a collection |
| `getScore(item, metric)` | Get score value for a metric (prefers normalized) |
| `getBestScore(item)` | Get highest score across all metrics |
| `sortByMetric(items, metric)` | Sort candidates by metric (descending) |
| `rankByMetric(items, metric)` | Sort + assign 1-based ranks |
| `takeTopK(items, k, metric)` | Select top K by metric |
| `filterByThreshold(items, metric, threshold)` | Filter by minimum score |
| `selectBest(items, metric)` | Get the single best candidate |
| `toCollection(items, type, nodeId)` | Wrap items into a CandidateCollection |
| `toSelection(items, total, mode, metric)` | Build a CandidateSelection |
| `fromRawValues(values, type, nodeId)` | Convert raw values to CandidateItems |
| `extractValues(collection)` | Extract raw values from a collection |
| `isCandidateCollection(value)` | Structural type guard |
| `ensureCollection(input, fallbackType)` | Normalize raw or typed input to collection |

### Executor Integration

Both ClipScoring and Ranking executors now use the candidate contract:

**ClipScoring** (`packages/engine/src/capabilities/clipScoring.ts`):
- Accepts raw image arrays OR CandidateCollections via `ensureCollection()`
- Attaches `CandidateScore` with metric `"clip_similarity"` to each item
- Outputs `scored_images_out` as a typed `CandidateCollection` (collectionType: "scored")
- Still outputs `scores_out` as a plain number array for backward compatibility

**Ranking** (`packages/engine/src/capabilities/ranking.ts`):
- Accepts CandidateCollections with pre-attached scores (direct chain from ClipScoring)
- Falls back to legacy parallel items/scores arrays if scores not already attached
- Outputs `top_items_out` as a `CandidateSelection` with selection metadata
- Outputs `ranked_items_out` as a `CandidateCollection` (collectionType: "ranked")

### Pipeline flow with candidate contract

```
ImageGen (raw images)
  → ClipScoring: ensureCollection() wraps raw images → scores each → CandidateCollection(scored)
    → Ranking: receives scored collection → ranks → CandidateSelection + CandidateCollection(ranked)
      → SocialFormat (future): receives CandidateSelection → formats best items
        → ExportBundle (future): receives formatted candidates → export package
```

### What this enables (future)

- **Best-of-N generation**: generate N variants, score, auto-select best
- **Multi-metric scoring**: attach CLIP + aesthetic + safety scores, rank by composite
- **Batch workflows**: process collections of candidates uniformly
- **Format/export nodes**: receive typed candidates, access metadata and scores
- **Comparison views**: UI can read CandidateCollection to show scored results

## 4g. What Was Added in Session 9 — SocialFormat & ExportBundle Executors

### Problem

The full pipeline `Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle` was incomplete — SocialFormat and ExportBundle had node definitions but no executors, and their port definitions didn't accept the candidate contract from Ranking.

### Solution

Candidate-aware executors for both nodes, upgraded node definitions with richer parameterSchema, and a new `attachMetadata`/`attachCollectionMetadata` helper pair for per-candidate metadata enrichment.

### SocialFormat Executor (`packages/engine/src/capabilities/socialFormat.ts`)

`executeSocialFormat()` — generates per-candidate, per-platform social content:

- **Input**: `candidates_in` — CandidateCollection/Selection (typically from Ranking); optional `text_in` for context
- **Output**: `formatted_out` — CandidateCollection with `socialVariants` attached to each candidate's metadata
- **Per-candidate social metadata**: caption, hook, hashtags, CTA, title, shortDescription, imageSpec per platform
- **Parameters**: platforms (JSON array), tone (professional/casual/bold), topic, includeHashtags, includeCTA
- **Preserves**: all upstream scores, ranks, sourceNodeId, existing metadata
- **Mock**: deterministic caption/hashtag generation; real implementation will use LLM for captions

### ExportBundle Executor (`packages/engine/src/capabilities/exportBundle.ts`)

`executeExportBundle()` — produces a structured export manifest:

- **Input**: `candidates_in` — CandidateCollection (typically from SocialFormat)
- **Outputs**: `bundle_out` (manifest JSON), `candidates_out` (collection with export metadata)
- **Manifest structure**: bundleName, format, createdAt, assets (with assetRef/rank/scores), socialEntries (extracted from candidate metadata), summary (counts, topScore, platforms)
- **Parameters**: bundleName, format (manifest-only/zip/folder), includeImages, includeMetadata, includeSocialText, includeScores
- **Preserves**: all upstream scores, ranks, social variants
- **Mock**: manifest-only mode; real zip/folder creation to be added with file system integration

### Candidate Helpers (`packages/shared/src/candidateHelpers.ts`)

Added:
- `attachMetadata(item, metadata)` — immutably merge metadata into a candidate item
- `attachCollectionMetadata(collection, metadataFn)` — apply per-item metadata transforms to a collection

### Updated Node Definitions (`packages/shared/src/nodeDefinitions/capabilities.ts`)

| Node | Changes |
|------|---------|
| `socialFormatNode` | New `candidates_in` port (replaces image_in + text_in), optional `text_in` for context, `formatted_out` output. New params: tone (enum), includeHashtags, includeCTA. Added uiSchema. |
| `exportBundleNode` | New `candidates_in` port (replaces variants_in + images_in + prompt_in), `bundle_out` + `candidates_out` outputs. New params: bundleName, format (enum), includeImages, includeMetadata, includeSocialText, includeScores. Added uiSchema. |

### Full pipeline flow

```
Prompt → ImageGen (raw images)
  → ClipScoring: ensureCollection() → scores each → CandidateCollection(scored)
    → Ranking: ranks → CandidateSelection + CandidateCollection(ranked)
      → SocialFormat: attachCollectionMetadata() → captions/hashtags/CTAs per platform per candidate
        → ExportBundle: builds manifest with assets, social entries, scores, ranks → ExportManifest
```

Each stage preserves upstream data — the final ExportBundle manifest contains scores from ClipScoring, ranks from Ranking, and social content from SocialFormat, all traceable per candidate.

### What is mocked vs real

| Component | Status |
|-----------|--------|
| CLIP scoring | Mock (deterministic pseudo-random) — needs Python sidecar or ONNX |
| Caption generation | Mock (template-based) — needs LLM integration for real captions |
| Hashtag generation | Mock (topic-based combinatorial) — functional but basic |
| Platform image specs | Real (correct dimensions/aspects per platform) |
| Export manifest | Real (structured JSON) — file bundling (zip) needs file system integration |

## 4h. What Was Added in Session 10 — Pipeline Integration Test

### Problem

The full pipeline `Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle` had individual executors but no integration test verifying that candidate data flows correctly through every stage with metadata preservation.

### Solution

A single integration test file that exercises the full 6-node pipeline end-to-end using mock provider output, verifying stage-by-stage output shape and cross-stage metadata integrity.

### Test file (`packages/engine/src/capabilities/pipeline.integration.test.ts`)

Uses Node.js native `node:test` module (matching existing conventions in `packages/crypto`). 9 test cases in one suite:

| Test | Verifies |
|------|----------|
| Stage 1-2: mock provider | Raw image URLs enter ClipScoring via `ensureCollection()` |
| Stage 3: ClipScoring scores | CandidateCollection with `clip_similarity` scores, normalized to 0-100, ranks assigned |
| Stage 3: determinism | Same inputs produce identical scores across runs |
| Stage 4: Ranking | Top-K selection, correct sort order, CandidateSelection shape, upstream scores preserved |
| Stage 5: SocialFormat | Per-candidate, per-platform social variants (caption, hook, hashtags, CTA, imageSpec), upstream scores+ranks preserved |
| Stage 6: ExportBundle manifest | Manifest with assets, social entries, summary; correct counts and structure |
| Stage 6: metadata preservation | Exported candidates have export metadata + all upstream data |
| Cross-stage: no metadata drops | Final output retains scores (stage 3), ranks (stage 4), social variants (stage 5), export metadata (stage 6) |
| Cross-stage: stable IDs | Candidate IDs trace back from export output to ClipScoring output |

### What is tested vs what is mocked

| Component | Test coverage |
|-----------|--------------|
| `ensureCollection()` normalization | Tested — raw arrays → CandidateCollection |
| CLIP scoring logic | Tested — mock scorer, deterministic |
| Score attachment/structure | Tested — metric, value, normalized, model fields |
| Ranking (topK mode) | Tested — sort order, selection count, metadata |
| Social formatting | Tested — platform variants, caption/hook/hashtag/CTA structure |
| Export manifest builder | Tested — assets, social entries, summary, metadata |
| Metadata preservation | Tested — cross-stage integrity assertions |
| Real CLIP model | Not tested — needs Python sidecar or ONNX |
| Real LLM captions | Not tested — needs provider integration |
| Real file bundling (zip) | Not tested — needs file system integration |
| Graph-driven execution | Not tested — executors called directly, not via RunCoordinator/ExecutionGraph |

### What future real-provider E2E should verify

1. Provider nodes produce valid image/video assets that ClipScoring can consume
2. Real CLIP model returns meaningful similarity scores (not just pseudo-random)
3. LLM-generated captions are platform-appropriate and within character limits
4. ZIP/folder export produces valid downloadable archives
5. Full graph-driven execution via RunCoordinator dispatches nodes in correct topological order
6. SSE streaming delivers live progress events during pipeline execution

### Engine test infrastructure

Added `test` script to `packages/engine/package.json` using `node --import tsx --test`, matching the convention in `packages/crypto`. Added `tsx` dev dependency.

## 4i. What Was Added in Session 11 — Graph-Driven Orchestration Test

### Problem

The Session 10 pipeline integration test called executors directly in sequence. It didn't exercise the real orchestration path: `WorkflowGraph → buildExecutionGraph() → RunCoordinator → NodeExecutor`. There was no test proving that the coordinator correctly builds dependency graphs, dispatches nodes in topological order, resolves upstream outputs as downstream inputs, and drives execution to completion.

### Solution

A graph-driven integration test that constructs a real 6-node `WorkflowGraph`, feeds it through `buildExecutionGraph()`, and uses `RunCoordinator` with a dispatch callback that delegates to `NodeExecutor`. This closes the gap between "executors work" and "the full orchestration engine works."

### Test file (`packages/engine/src/orchestration.integration.test.ts`)

9 test cases verifying the complete orchestration path:

| Test | Verifies |
|------|----------|
| Graph build | `buildExecutionGraph()` produces 6 nodes, correct tiers, valid topological order, dependency ordering |
| Full pipeline dispatch loop | `RunCoordinator.startRun()` drives all 6 nodes to `completed`, run status = `completed` |
| Dependency ordering | Execution order respects DAG: Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle |
| Event stream | `run:started`, `node:queued`, `node:completed` events for every node; `run:completed` at end; no `node:failed` |
| No duplicate execution | Each node executes exactly once (6 total dispatches) |
| Node state completeness | All nodes reach `completed` status with `completedAt` timestamps and `attempt = 1` |
| Final output integrity | Export manifest has correct bundleName, assets with scores/ranks, social entries, summary |
| Input resolution | `resolveNodeInputs()` correctly wires upstream outputs to downstream inputs across all edges |
| Cost tracking | `run.totalCost` accumulates cost from mock provider node |

### Architecture exercised

```
WorkflowGraph (6 nodes, 6 edges)
  → buildExecutionGraph(): Kahn's topological sort, tier computation
    → RunCoordinator.createRun(): initializes node states
      → RunCoordinator.startRun(dispatch):
        → getReadyNodes() finds tier-0 nodes
          → dispatch() callback:
            → NodeExecutor.execute(): resolves __nodeType, looks up registry, routes by runtimeKind
              → local/capability executor runs
            → coordinator.onNodeCompleted(): updates state, resolves downstream inputs
              → getReadyNodes() finds next tier
                → dispatch() again (recursive)
```

### What is tested vs what is mocked

| Component | Test coverage |
|-----------|--------------|
| `buildExecutionGraph()` | Tested — real DAG build from WorkflowGraph |
| Topological sort + tiers | Tested — tier assignments verified, dependency ordering asserted |
| `RunCoordinator` state machine | Tested — run lifecycle, node state transitions, event emission |
| `getReadyNodes()` | Tested — implicitly via coordinator dispatch loop |
| `resolveNodeInputs()` | Tested — upstream outputs correctly flow to downstream inputs |
| `NodeExecutor` dispatch | Tested — routes by runtimeKind via registry lookup |
| Capability executors (4) | Tested — real executors for clip-scoring, ranking, social-format, export-bundle |
| Prompt/ImageGen nodes | Mocked — local executors returning deterministic output |
| Budget enforcement | Not tested — no budget cap set in this test |
| Node failure/cancellation | Not tested — all nodes succeed |
| Retry logic | Not tested — all nodes succeed on first attempt |
| BullMQ worker integration | Not tested — dispatch callback runs inline, not via queue |

### What the next runtime-level gap is

1. ~~**Error handling E2E**~~ — **DONE** (Session 18): node failure → downstream cancellation → `partial_failure` run status
2. **Budget enforcement E2E**: Test budget cap → `budget_exceeded` status → pending node cancellation
3. **BullMQ integration**: Test real queue dispatch with `nodeJobProcessor` bridging BullMQ jobs to executor
4. **Retry logic**: Test node failure with `retryCount > 0` → re-dispatch → eventual success

## 4j. What Was Added in Session 12 — Template Pack Architecture

### Problem

No way to ship pre-built workflow templates. Users had to build every workflow from scratch. The project needed a lightweight system for bundling and loading template workflows without building a hosted marketplace.

### Solution

A minimal template pack system in `packages/shared` with types, a loader, a parser, and a built-in pack containing the social content pipeline workflow.

### Files

| File | Purpose |
|------|---------|
| `packages/shared/src/templatePack.ts` | `TemplatePackManifest` (Zod schema), `TemplatePack`, `TemplateEntry`, `PackAvailability` types. `TemplatePackLoader` class with register/lookup/filter/availability. `parseTemplatePack()` for JSON validation. Global `templatePackLoader` singleton. |
| `packages/shared/src/builtinPacks.ts` | `registerBuiltInPacks(rawPacks)` — validates and registers raw JSON data as template packs. |
| `packages/shared/src/templatePack.test.ts` | 12 tests: loader CRUD, template retrieval, source/category filtering, parse validation, error handling, availability checking against node registry. |
| `templates/packs/social-content-pipeline.json` | Built-in pack with 2 templates: `full-pipeline` (6 nodes) and `score-and-rank` (3 nodes). |
| `docs/TEMPLATE_PACKS_PLAN.md` | Full architecture documentation. |

### How it works

1. Template packs are plain JSON files containing a manifest and a map of template IDs to `WorkflowGraph` objects.
2. `parseTemplatePack()` validates the manifest via Zod and each template against `WorkflowGraphSchema`.
3. `TemplatePackLoader` is the central registry — register packs, look up templates, filter by source/category.
4. `checkAvailability()` checks whether required node types and providers exist in the node registry.
5. Built-in packs live in `templates/packs/` and are registered via `registerBuiltInPacks()` at startup.

### What is NOT included

- No marketplace, discovery, or remote fetching
- No pack versioning/upgrade logic
- No premium pack enforcement
- No template picker UI (future session)

See `/docs/TEMPLATE_PACKS_PLAN.md` for full details.

## 4k. What Was Added in Session 13 — Template Picker UI

### Problem

Template packs existed in the backend (`TemplatePackLoader`, `registerBuiltInPacks`, built-in JSON packs) but there was no UI for browsing and loading templates into the editor.

### Solution

A modal-based template picker integrated into the workflow canvas, reading from `templatePackLoader` and loading selected `WorkflowGraph` objects into the Zustand store via the existing `loadWorkflow()` action.

### Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/canvas/TemplatePicker.tsx` | Modal component showing all templates from `templatePackLoader`. Groups by category. Shows name, preview description, source badge (Built-in/User/Imported/Premium), availability badge (Ready/Missing deps), pack label, node/edge counts, and missing node types. 6-mode filter: All/Available/Unavailable/Built-in/Imported/Packs. Text search across name, preview, pack name, category, tags. |
| `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Added Templates button in top bar (next to Debugger). Renders `TemplatePicker` modal. `handleTemplateSelect` loads selected graph via `loadWorkflow()` preserving existing workflow meta. |
| `apps/web/src/stores/workflowStore.ts` | Added `templatePickerOpen` state and `toggleTemplatePicker()` action. |
| `apps/web/src/components/canvas/index.ts` | Added `TemplatePicker` and `TemplatePickerProps` exports. |

### How it works

1. User clicks "Templates" button in the canvas top bar → opens modal.
2. `TemplatePicker` calls `ensurePacksLoaded()` on mount, which runs `registerBuiltInPacks()` once with the built-in JSON pack data.
3. Templates are read from `templatePackLoader.getAllPacks()`, enriched with availability from `checkAvailability()`.
4. Templates are grouped by pack category and filtered by the active filter mode + text search.
5. Each template card shows: display name, source badge, availability badge, preview text, pack name, node/edge count, and missing deps if any.
6. On click, the selected `WorkflowGraph` is loaded into the Zustand store via `loadWorkflow()`, replacing the current canvas contents but preserving the workflow meta (ID, name, description).
7. The modal closes after selection.

### What is NOT included

- No file import dialog (add in next session via `parseTemplatePack()`)
- No "save as template" functionality
- No template preview/thumbnail images
- No confirmation dialog before replacing current graph

## 4l. What Was Added in Session 14 — Template Gallery UI Polish

### Problem

The template picker modal from Session 13 was functional but lacked the product-grade polish expected of a user-facing gallery — the filter system used generic pills, badges were minimal, and pack membership wasn't visually distinct.

### Solution

Upgraded the `TemplatePicker` component into a "Template Gallery" with proper tab navigation, richer badges, pack labels, tag pills, micro-icons, and an empty state.

### Changes to `apps/web/src/components/canvas/TemplatePicker.tsx`

| Feature | Before | After |
|---------|--------|-------|
| **Filter row** | 6 flat pill buttons (all/available/unavailable/builtin/imported/pack) | 5 underline-style tabs (All/Built-in/Imported/My Templates/Packs) with per-tab counts and active indicator bar |
| **Source badges** | Color-coded labels: Built-in, User, Imported, Premium | Refined styling with stronger contrast: Built-in (blue), My Template (violet), Imported (cyan), Premium (amber) |
| **Pack badge** | Pack name shown as gray text in bottom row | Dedicated `PackBadge` component with briefcase icon, only on multi-template pack cards |
| **Availability** | Full-text "Ready" / "Missing deps" badge | Compact dot indicator (green/amber) on card + legend in footer |
| **Missing deps** | Inline amber text in bottom row | Dedicated warning row with triangle icon listing all missing node types + providers |
| **Tags** | Not shown | First 3 pack tags as gray pills + overflow count |
| **Node/edge counts** | Plain text | Micro-icons (square for nodes, diagonal line for edges) |
| **Search** | Plain input | Input with search magnifying glass icon |
| **Empty state** | Plain text | Illustration icon + "Clear search" action link |
| **Header** | "Templates" | "Template Gallery" + subtitle "Start from a pre-built workflow" |
| **Footer** | Count text only | Count text + availability legend |

### How it works

Same data flow as Session 13 — all templates from `templatePackLoader`, enriched with `checkAvailability()`, grouped by category. The filter system was simplified from 6 modes to 5 tabs, dropping the "Available" and "Unavailable" filters (availability is now communicated visually via dot indicators instead of requiring a dedicated filter). "My Templates" filter was added for `source === "user"`.

---

## 4m. What Was Added in Session 15 — Template Pack Import From File

### Problem

The Template Gallery could only display built-in packs. There was no way for users to load external template packs — the `parseTemplatePack()` and `templatePackLoader.register()` APIs existed but had no UI surface.

### Solution

Added an "Import Pack" button to the Template Gallery header that opens a native file picker for JSON files, validates the file client-side via `parseTemplatePack()`, registers it at runtime, and refreshes the gallery immediately.

### Changes to `apps/web/src/components/canvas/TemplatePicker.tsx`

| Feature | Implementation |
|---------|---------------|
| **Import button** | "Import Pack" button with download icon in gallery header, triggers hidden `<input type="file" accept=".json">` |
| **File reading** | Client-side `FileReader.readAsText()` — no server round-trip |
| **Validation** | `JSON.parse()` → `parseTemplatePack()` (Zod manifest schema + WorkflowGraphSchema per template) |
| **Source override** | Forces `manifest.source = "imported"` regardless of original source in the JSON |
| **Registration** | `templatePackLoader.register(pack)` — duplicates are handled by unregistering the old pack first |
| **Gallery refresh** | `importCount` state counter is a dependency of the `enriched` memo — incrementing it forces recalculation |
| **Tab switch** | Auto-switches to "Imported" tab after successful import |
| **Error handling** | Red inline banner with error message and dismiss button; catches JSON parse errors, Zod validation errors, and FileReader errors |
| **Success feedback** | Green inline banner showing pack name and template count, auto-dismisses after 4 seconds |

### Import flow

```
User clicks "Import Pack" → file picker opens → user selects .json file
  → FileReader.readAsText() → JSON.parse()
    → force source = "imported"
      → parseTemplatePack() validates manifest + templates
        → if duplicate: unregister old → register new
          → importCount++ triggers enriched memo refresh
            → gallery shows imported templates under "Imported" tab
```

### What is NOT included

- No persistence — imported packs are lost on page reload (localStorage or DB persistence is future work)
- No drag-and-drop import
- No URL-based import (fetch from remote)
- No pack removal UI (unregister)
- No pack editing

## 4n. What Was Added in Session 16 — Save As Template

### Problem

Users could import and browse template packs but had no way to export their current workflow as a reusable template pack. The round-trip was incomplete — templates could flow in but not out.

### Solution

A `SaveAsTemplateDialog` component that reads the current workflow graph from the Zustand store, wraps it in a valid `TemplatePack` with `source: "user"`, and triggers a JSON file download.

### Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/canvas/SaveAsTemplateDialog.tsx` | Modal dialog with form fields (name, description, category, tags). Builds `TemplatePackManifest` with auto-derived `requiredNodeTypes` and `requiredProviders` from the graph. Serializes as JSON, triggers download via Blob URL. |
| `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Added "Save as Template" button in canvas top bar. Renders `SaveAsTemplateDialog` with `getWorkflowGraph` and pre-filled name from workflow meta. |
| `apps/web/src/stores/workflowStore.ts` | Added `saveAsTemplateOpen` state and `toggleSaveAsTemplate()` action. |
| `apps/web/src/components/canvas/index.ts` | Added `SaveAsTemplateDialog` export. |

### How it works

1. User clicks "Save as Template" in the canvas top bar → dialog opens.
2. Name is pre-filled from workflow meta. User can add description, category, and comma-separated tags.
3. On "Export as JSON":
   - Reads current graph via `getWorkflowGraph()`.
   - Validates non-empty name and non-empty graph.
   - Derives `requiredNodeTypes` from `Set(graph.nodes.map(n => n.type))`.
   - Derives `requiredProviders` from nodes with `data.providerId`.
   - Builds a `TemplatePack` with `source: "user"`, unique timestamped pack ID.
   - Serializes to JSON, creates Blob URL, triggers download with `<a>.click()`.
4. Dialog closes on success; shows inline error on failure.

### What is NOT included

- ~~No persistence to localStorage or DB (download-only)~~ **DONE in Session 17**
- ~~No auto-registration of saved template into gallery~~ **DONE in Session 17**
- No template editing (re-export from scratch)
- No thumbnail generation

## 4o. What Was Added in Session 17 — Template Pack Persistence

### Problem

Imported packs and user-created templates were lost on page reload. The `TemplatePackLoader` is an in-memory singleton — its contents don't survive navigation or refresh.

### Solution

A `templatePackStorage.ts` utility that persists packs to `localStorage` under `iteraStudio.templatePacks` and rehydrates them on gallery mount.

### Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/templatePackStorage.ts` | `rehydratePersistedPacks()` — reads localStorage, validates each pack via `parseTemplatePack()`, registers valid non-builtin packs into `templatePackLoader`. `persistPack(pack)` — adds/replaces a pack in localStorage. `removePersistedPack(packId)` — removes a pack by ID. |

### Modified files

| File | Change |
|------|--------|
| `apps/web/src/components/canvas/TemplatePicker.tsx` | `ensurePacksLoaded()` now calls `rehydratePersistedPacks()` after built-in registration. Import handler calls `persistPack(pack)` after successful import. |
| `apps/web/src/components/canvas/SaveAsTemplateDialog.tsx` | `handleExport()` now calls `templatePackLoader.register(pack)` + `persistPack(pack)` before download, so the saved template appears in the gallery immediately and survives reload. |

### How it works

1. **Storage format**: `iteraStudio.templatePacks` localStorage key contains a JSON array of raw `TemplatePack` objects (same shape as `parseTemplatePack()` input).
2. **Rehydration** (on gallery mount): `ensurePacksLoaded()` → `registerBuiltInPacks()` → `rehydratePersistedPacks()`. Each stored pack is validated via `parseTemplatePack()`. Built-in packs and duplicates are skipped. Invalid packs are silently dropped.
3. **Persist on import**: After `templatePackLoader.register(pack)`, `persistPack(pack)` adds/replaces the pack in localStorage.
4. **Persist on save-as**: After building the `TemplatePack`, it's registered in the loader AND persisted to localStorage before the download triggers.
5. **Duplicate handling**: `persistPack()` replaces by pack ID. `rehydratePersistedPacks()` skips packs already registered.
6. **Error resilience**: All localStorage operations are wrapped in try/catch. SSR-safe (`typeof window` guard). Corrupt data is silently ignored.

### What is NOT included

- No server-side persistence
- No pack deletion UI (removePersistedPack exists but has no button)
- No storage quota management
- No migration/versioning of storage format

## 4p. What Was Added in Session 18 — Error Handling E2E Test

### Problem

The Session 11 orchestration test proved the happy path (all nodes succeed), but `RunCoordinator` had untested error handling: `onNodeFailed()`, `cancelDownstream()`, `partial_failure` finalization. Additionally, a reentrancy bug in `dispatchReadyNodes()` caused double-dispatch when the dispatch callback ran synchronously (inline).

### Solution

A dedicated error-handling E2E test with a branching DAG topology, plus a one-line reentrancy guard in the coordinator.

### Test file (`packages/engine/src/error-handling.integration.test.ts`)

**Graph topology:**
```
              ┌── ok-branch ── ok-leaf
root ─────────┤
              └── fail-node ── downstream (cancelled)
```

5 nodes, 4 edges. Two independent branches from a shared root. The fail branch throws a simulated error; the success branch completes normally.

9 test cases:

| Test | Verifies |
|------|----------|
| Graph topology | 5 nodes, correct dependencies, correct topological order |
| Run reaches partial_failure | `run.status === "partial_failure"` when one branch fails and one succeeds |
| Failing node status | `status: "failed"`, error message preserved, completedAt set |
| Downstream cancellation | Dependent node `status: "cancelled"`, never appears in execution order |
| Independent branch success | Root, ok-branch, ok-leaf all reach `completed` with outputs |
| DAG ordering | Root before both branches, ok-branch before ok-leaf |
| Event stream | `run:started`, `node:failed`, `node:completed` x3, `run:partial_failure`; no `run:completed` or `run:failed` |
| No cancelled execution | Exactly 4 dispatches (not 5); downstream never dispatched |
| State summary | 3 completed, 1 failed, 1 cancelled, 0 pending/queued/running |

### Bug fix (`packages/engine/src/runCoordinator.ts`)

Added reentrancy guard in `dispatchReadyNodes()`: before processing each node in the ready list, check if it's still `"pending"`. When dispatch runs inline (as in tests), a recursive `dispatchReadyNodes` call from `onNodeCompleted`/`onNodeFailed` can process nodes that are still in the outer loop's pre-computed `readyIds`. The guard skips nodes that have already been moved past pending by a recursive call, preventing double-dispatch.

### What is tested vs what is still untested

| Component | Status |
|-----------|--------|
| `onNodeFailed()` + `cancelDownstream()` | **Tested** |
| `partial_failure` finalization | **Tested** |
| Independent branch continuation | **Tested** |
| Reentrancy guard | **Tested** (implicitly — test would fail without it) |
| Budget enforcement → `budget_exceeded` | Not tested |
| Retry logic (`retryCount > 0`) | Not tested |
| `cancelRun()` external cancellation | Not tested |
| Multi-level cascading cancellation (>2 tiers) | Not tested (could add) |

---

## 5. What Still Remains to Be Migrated

### Provider adapter unification
The thin `ProviderAdapter` interface in `apps/web/src/lib/providers/types.ts` (`generate(input)`) should be deprecated in favor of the richer `ProviderAdapter` interface in `packages/adapters/src/types.ts`. The model catalog in `config/models.ts` should eventually be replaced by dynamic adapter discovery.

### Local executors
Utility nodes (resize, crop, format-convert) need local executor implementations using sharp. Register them via `nodeExecutor.registerLocal()` at worker startup.

### SSE integration for run progress
The InspectorPanel's "Run" tab is a placeholder. Wire it to `RunCoordinator` events via SSE to show real-time per-node progress during workflow execution.

---

## 5. Recommended Next Implementation Steps

~~Step 1: Schema-driven inspector rendering~~ — **DONE** (SchemaField, SchemaForm, NodeConfig, InspectorPanel)

~~Step 2: Engine runtime dispatch~~ — **DONE** (NodeExecutor with runtimeKind dispatch, RunCoordinator, ExecutionGraph)

~~Step 3: Worker integration~~ — **DONE** (nodeJobProcessor.ts wired into BullMQ worker)

~~Step 4: Registry-aware node palette~~ — **DONE** (NodePalette.tsx, createWorkflowNode.ts)

~~Step 4b: Workflow debugger~~ — **DONE** (debugSnapshot.ts, RunDebuggerPanel.tsx)

~~Step 5: React Flow canvas integration~~ — **DONE** (WorkflowCanvas.tsx, CustomNode.tsx, workflowStore.ts, editor page wired up)

### Step 6: Local executors for utility nodes
Implement sharp-based local executors for resize, crop, and format-convert nodes. Register them via `nodeExecutor.registerLocal()` at worker startup. This enables utility nodes to actually execute in workflows.

~~Step 7: Capability executors for scoring and ranking~~ — **DONE** (clipScoring.ts, ranking.ts, registerCapabilityExecutors())

### Step 8: Deprecate dual adapter interfaces
Consolidate the thin `ProviderAdapter` in `apps/web/src/lib/providers/types.ts` with the richer one in `packages/adapters/src/types.ts`.

~~Step 9: SSE run progress~~ — **DONE** (SSE route, useRunEvents hook, workflowStore integration)

### Step 10: Capability executors for social format and export
Create executor wrappers for `socialFormatNode` and `exportBundleNode` that call the existing services but conform to the `NodeExecutionContext → NodeExecutionResult` contract.

---

## 6. Which Current Features Should Be Converted Into Nodes Next

| Feature | Current Location | Priority | Rationale |
|---------|-----------------|----------|-----------|
| **Resize/Crop** | Defined in registry, no executor yet | High | Most commonly needed utility nodes; sharp-based, zero external deps |
| ~~**CLIP Scoring**~~ | ~~`services/qualityScoring.ts`~~ | ~~High~~ | **DONE** — `executeClipScoring` in `packages/engine/src/capabilities/clipScoring.ts` (mock scorer, real model TBD) |
| **Social Formatting** | `services/socialFormatter.ts` | Medium | Discrete function, but less likely to appear mid-pipeline |
| **Prompt Template** | Defined in registry, no executor | Medium | Enables prompt composition workflows |
| **Export Bundle** | `services/exportService.ts` | Medium | Large service; start with executor wrapper, refine later |
| **Compositing** | Defined in registry, no executor | Low | Less common; implement after resize/crop proven |
| ~~**Ranking**~~ | ~~`lib/ranking/score.ts`~~ | ~~Low~~ | **DONE** — `executeRanking` in `packages/engine/src/capabilities/ranking.ts` (topK/threshold/sort modes) |

---

## 7. Which Current Page-Level Features Are Acceptable to Leave Alone

| Feature | Location | Why It's Fine |
|---------|----------|---------------|
| **Prompt Studio** (`/(app)/prompt`) | Page + `usePromptRunner` hook | It's a high-level UI flow, not a node execution. The hook orchestrates multi-model comparison which maps to a DAG of generation nodes — this composition is valid at the page level. |
| **Canvas Editor** (`/(app)/canvas`) | Page + `useCanvasStore` hook | Social variant editing is a UI concern. The underlying formatting already delegates to `socialFormatter` which is now a capability node. |
| **Settings / Provider Keys** | Pages + API routes | Configuration UI is inherently page-level. Provider key management doesn't belong in the node system. |
| **Login / Setup / Auth** | Pages + middleware | Infrastructure, not pipeline logic. |
| **Marketing pages** | Static content | No pipeline logic involved. |
| **License tier checks** | `lib/license-tiers.ts` | Feature gating is orthogonal to node architecture. Can optionally be connected to node `isAvailable` flags later. |
| **Presets** | `config/presets.ts` | Pre-configured model sets are a UI convenience. They can reference node definitions by type but don't need to be nodes themselves. |
