# MVP Engineering Tasks

Each task is atomic — completable by one person in one sitting. Dependencies reference task IDs.

---

## Week 1: Foundation (Days 1–7)

### T-001: Initialize monorepo with pnpm workspaces and Turborepo
- **Description**: Create root `package.json` with pnpm workspace config, `pnpm-workspace.yaml` listing `apps/*` and `packages/*`, `turbo.json` with build/test/lint pipelines, and `tsconfig.base.json` with shared compiler options (strict, ESM, path aliases).
- **Owner**: Fullstack
- **Effort**: S
- **Dependencies**: None

### T-002: Scaffold Next.js app with App Router
- **Description**: Initialize `apps/web` with Next.js (App Router), TypeScript, Tailwind CSS. Install and initialize **shadcn/ui** (Radix + Tailwind, copy-paste components committed to repo). Configure `next.config.ts` with standalone output mode for Docker. Create placeholder pages for all routes: `/` (redirects to `/workflows`), `/workflows`, `/workflows/[id]`, `/workflows/[id]/history`, `/settings`, `/settings/providers`, `/usage`, `/login`, `/setup`, `/trash`.
- **Owner**: Frontend
- **Effort**: S
- **Dependencies**: T-001

### T-003: Set up linting and formatting
- **Description**: Configure ESLint (with `@typescript-eslint`), Prettier, and Husky pre-commit hooks at the monorepo root. Ensure all packages and apps inherit shared config. Add `lint` and `format` Turbo tasks.
- **Owner**: Fullstack
- **Effort**: S
- **Dependencies**: T-001

### T-004: Implement database schema package (`packages/db`)
- **Description**: Create Drizzle ORM schema in `packages/db/src/schema.ts` for all tables: `workflows` (include `workflow_version` integer column for optimistic concurrency, denormalized `last_run_status`, `last_run_at`, `last_run_cost` columns, `deleted_at` nullable timestamp for soft-delete), `runs`, `node_executions` (include `awaiting_download` status), `provider_configs`, `pricing_overrides`, `settings`, `audit_logs`, `sessions`, `model_schema_cache` (columns: provider, model, schema JSON, fetched_at, override flag). Configure `drizzle.config.ts` for SQLite. Open SQLite in **WAL mode** with auto-checkpoint threshold; add a safety checkpoint call before graceful shutdown. Implement DB connection singleton that creates the SQLite file at `DATA_DIR/db/agentstudio.db`. Set up migration generation. On startup: create a backup copy of the DB file, then auto-run migrations; if migration fails, log error and **exit** (fail-and-exit strategy).
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-001

### T-005: Implement crypto package (`packages/crypto`)
- **Description**: Build `packages/crypto` with: (1) `masterKey.ts` — generate 256-bit random key, load from env var or file, write to `/data/config/master.key` with 0600 permissions; (2) `encrypt.ts` — AES-256-GCM encrypt/decrypt functions using PBKDF2 key derivation (100k iterations); (3) Unit tests covering encrypt/decrypt round-trip, key generation, missing key handling.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-001

### T-006: Implement shared types package (`packages/shared`)
- **Description**: Create `packages/shared` with: (1) `workflowSchema.ts` — Zod schema for workflow graph JSON (nodes, edges, ports, parameters); (2) `portTypes.ts` — port type enum and compatibility matrix; (3) `nodeTypes.ts` — node type registry (image-generation, video-generation, image-input, output, resize, crop, format-convert, compositing, prompt-template, **comment**); (4) `errors.ts` — shared error codes, mapped error code enum, and error class; (5) `modelEquivalents.ts` — cross-provider model equivalence map for template substitution; (6) `validateForUI.ts` — wrapper around Zod schemas that returns `{ ok, data?, fieldErrors? }` for frontend form-friendly validation. All Zod schemas in this package are the single source of truth shared between frontend and backend.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-001

### T-007: Build UI shell and layout
- **Description**: Implement `Layout.tsx` (sidebar + main content area), `Sidebar.tsx` (navigation links with icons for Workflows, Templates, Settings, Usage, Trash), `TopBar.tsx` (breadcrumbs, run button placeholder). Set up **dark theme only** using **semantic CSS variables** (e.g., `--color-surface`, `--color-text-primary`) so a future light theme can be added by swapping values. Use **shadcn/ui** components throughout. Build `EmptyState.tsx` component for contextual empty states (e.g., "No workflows yet — start from a template" with action button). Wire layout into `app/layout.tsx`. All pages render within the shell. Non-canvas pages must be responsive; canvas pages are **desktop-only** (show a "use desktop" message on narrow viewports).
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-002

### T-008: Integrate React Flow canvas
- **Description**: Install `@xyflow/react`. Build `WorkflowCanvas.tsx` wrapping `ReactFlow` in **controlled mode** — Zustand store is the single source of truth for nodes/edges; React Flow receives them as props. Implement drag-performance batching: buffer `onNodesChange` position updates during drag and flush on `dragStop` to prevent per-pixel re-renders. Snap-to-grid (16px), minimap, zoom controls, background grid. Build `CustomNode.tsx` base component rendering a card with: label, provider icon slot, status badge, thumbnail slot (for live thumbnails during run), typed input/output ports. Build `CommentNode.tsx` — sticky-note style annotation node (text-only, no ports, draggable, yellow background). Build `NodePort.tsx` — custom Handle component color-coded by port type. Implement `onConnect` validation: reject type-mismatched connections and enforce **one connection per input port** rule. Build `CanvasContextMenu.tsx` — right-click context menu with basic actions (add node, copy, paste, delete, add comment). Implement **client-side node limits** (configurable, default 50 nodes per workflow). Build `shortcuts.ts` — hardcoded keyboard shortcut registry with an abstraction layer mapping logical actions to key combos, for future rebinding.
- **Owner**: Frontend
- **Effort**: L
- **Dependencies**: T-006, T-007

### T-009: Workflow CRUD API routes
- **Description**: Implement API routes: `POST /api/workflows` (create with name, empty graph), `GET /api/workflows` (list all non-deleted, use denormalized `last_run_status`/`last_run_at`/`last_run_cost` columns — no join to runs table), `GET /api/workflows/:id` (full detail with graph), `PUT /api/workflows/:id` (update name, description, graph — include **optimistic concurrency**: client sends `workflow_version`, server checks match, increments on success, returns 409 on mismatch), `DELETE /api/workflows/:id` (**soft-delete**: sets `deleted_at` timestamp). Add `POST /api/workflows/:id/restore` (clears `deleted_at`). Add `DELETE /api/workflows/:id/permanent` (hard-deletes from DB and removes associated assets). Add `GET /api/trash` (list soft-deleted workflows). Validate **server-side node limits** (configurable, default 50). All routes validate request bodies with Zod (shared schemas from `packages/shared`). Return consistent error format with mapped error codes.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004, T-006

### T-010: Wire canvas auto-save to backend
- **Description**: In `workflowStore.ts` (Zustand), implement debounced auto-save (1 second after last change). On canvas changes (add/remove/move nodes, add/remove edges, update params), serialize the graph and `PUT /api/workflows/:id` with `workflow_version` for optimistic concurrency. Handle 409 conflict response (show "workflow changed externally" notification). On page load, `GET /api/workflows/:id` and hydrate the canvas. Show save indicator (saved/saving/error) in TopBar. On page navigation or tab close, **flush any pending save immediately** using `sendBeacon()` fallback to ensure no data loss.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-008, T-009

### T-011: Implement undo/redo system
- **Description**: In `workflowStore.ts`, integrate Immer with patch tracking. Every mutation generates forward and inverse patches. Structural edits (add/remove node/edge) push to undo stack immediately. Parameter changes are coalesced: if the same node+field is edited within 500ms, merge into one undo step. Wire `Ctrl+Z` / `Ctrl+Shift+Z` keyboard shortcuts via the shortcut registry. Add undo/redo buttons to toolbar. Unit tests for stack behavior and coalescing.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-010

---

## Week 2: Adapters & Provider System (Days 8–14)

### T-012: Implement adapter framework (`packages/adapters`)
- **Description**: Create `packages/adapters` with: (1) `types.ts` — `ProviderAdapter` **interface** (id, displayName, icon, validateKey, listModels, getModelSchema, runPrediction, getPredictionStatus, cancelPrediction, estimateCost, schemaVersion). The engine depends only on this interface, never on concrete adapter code (**plugin-ready** boundary). (2) `index.ts` — `AdapterRegistry` class with `loadAll()`, `register()`, `get()`, `listAll()` methods. Include runtime validation of adapter shape on registration. (3) `httpClient.ts` — shared fetch wrapper with timeout, retry, structured error handling, and logging. Adapters use this wrapper for all HTTP calls; selective use of provider SDKs is allowed where beneficial.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-006

### T-013: Implement mock adapter
- **Description**: Build `packages/adapters/src/mock/adapter.ts` implementing `ProviderAdapter`. Configurable behavior: latency (0–5s), failure rate (0–100%), output type (returns placeholder image/video URLs). Supports 3 fake models with realistic schemas. Used in all engine/worker tests and local development. Unit tests.
- **Owner**: Backend
- **Effort**: S
- **Dependencies**: T-012

### T-014: Implement Replicate adapter
- **Description**: Build `packages/adapters/src/replicate/adapter.ts`. Implement all `ProviderAdapter` methods against Replicate's HTTP API using the shared fetch wrapper. `listModels()` returns MVP models: **Flux 1.1 Pro** (txt2img), **Flux 1.1 Pro** (img2img) — as **separate node types** per mode, **SDXL** (image), **Minimax Video-01-Live** (video). `getModelSchema()` implements **dynamic schema fetching**: call provider API at discovery time, cache result in `model_schema_cache` table with TTL, apply hardcoded overrides from `schemaOverrides.ts` for known quirks, fall back to bundled baseline schemas when offline. `models.ts` contains model definitions with input/output port types and pricing metadata (defaults with `isApproximate` flag for uncertainty). Unit tests with MSW mocking Replicate's API responses.
- **Owner**: Backend
- **Effort**: L
- **Dependencies**: T-012

### T-015: Implement Fal AI adapter
- **Description**: Build `packages/adapters/src/fal/adapter.ts`. Same structure as Replicate adapter. `listModels()` returns MVP models: **Flux schnell** (via Fal), **Kling v2** (video), **AuraSR** (super-resolution). Separate node types per mode where applicable. Dynamic schema fetching with cache and overrides, same pattern as Replicate adapter. Include model definitions and pricing metadata. Unit tests with MSW.
- **Owner**: Backend
- **Effort**: L
- **Dependencies**: T-012

### T-016: Provider API routes
- **Description**: Implement: `GET /api/providers` (list all providers from adapter registry with connection status from DB; **group models by provider** in response), `PUT /api/providers/:providerId` (encrypt and store API key), `DELETE /api/providers/:providerId` (remove key), `POST /api/providers/:providerId/validate` (test key via adapter.validateKey), `GET /api/providers/:providerId/models` (list models via adapter.listModels; show all models including duplicates across providers). Key storage uses `packages/crypto` for encryption. Return provider error responses using **mapped error codes** with sanitized `providerError` block (safe subset of provider detail).
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004, T-005, T-012

### T-017: Provider settings UI
- **Description**: Build `/settings/providers` page using shadcn/ui components. `ProviderCard.tsx` shows: provider icon, name, connection status (configured/not configured), model count, "Configure" button. `ApiKeyForm.tsx`: password input for API key, "Test Connection" button (calls validate endpoint, shows success/failure), "Save" button, "Remove" button with confirmation dialog. Toast notifications for success/failure.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-007, T-016

### T-018: Node palette sidebar
- **Description**: Add a collapsible "Add Node" panel to the canvas sidebar. Fetches available nodes from `GET /api/providers/:id/models` for each configured provider, plus built-in utility nodes. Nodes **grouped by provider** (not by category). Each entry shows: model name, provider icon, mode label (e.g., "txt2img"). **Text filter** input at the top for searching within the palette (no fuzzy search, simple substring match). Drag-from-palette onto canvas creates a new node with default parameters and correct port definitions. Node palette also includes Comment node and utility nodes.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-008, T-016

### T-019: Inspector panel — Config tab
- **Description**: Build `InspectorPanel.tsx` as a right-side sliding panel using shadcn/ui components. Opens when a node is clicked. Config tab renders a dynamic form from the node's schema (fetched from adapter, cached in DB). Field types: text input (for prompts), number input with slider (for numeric params with min/max), dropdown (for enum params), image upload (for image inputs — **immediately uploads to server**, stored as asset reference), toggle (for booleans). Parameter changes update `workflowStore` and trigger auto-save. Validate parameters using `validateForUI()` from shared schemas with **continuous validation** (validate on every change, show inline field errors).
- **Owner**: Frontend
- **Effort**: L
- **Dependencies**: T-008, T-012, T-018

### T-020: Cost estimation API
- **Description**: Implement `POST /api/estimate` endpoint. Accepts a workflow graph + optional input overrides. Walks each node, calls `adapter.estimateCost()` with the node's parameters, aggregates per-node and total costs. Returns `{ nodes: [{ nodeId, modelId, estimatedCost, isApproximate }], total, warnings[] }`. Use **default pricing** with `isApproximate` uncertainty flag where exact pricing is unknown. Support **live refinement**: if a provider returns actual cost after prediction, update the estimate for subsequent nodes. Handles missing pricing data gracefully (marks as approximate with warning).
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-012, T-014, T-015

### T-021: Adapter integration test harness
- **Description**: Create test scripts for Replicate and Fal AI adapters that run against real APIs. Gated behind `RUN_INTEGRATION_TESTS=true`. Tests: validate key, list models, run a cheap prediction (e.g., lowest-resolution image), poll to completion, verify output URL. Add CI job that runs nightly. Part of **critical-path + thin E2E** test strategy.
- **Owner**: Backend
- **Effort**: S
- **Dependencies**: T-014, T-015

---

## Week 3: Execution Engine (Days 15–21)

### T-022: Implement DAG engine (`packages/engine`)
- **Description**: Build `packages/engine/src/dag.ts`: parse workflow graph JSON into internal DAG representation, cycle detection (DFS), validate all edges have compatible port types, validate all required inputs are connected, enforce **one connection per input port**. Output nodes are **optional** — if none exist, leaf nodes (nodes with no outgoing edges) serve as implicit outputs. Build `scheduler.ts`: topological sort using Kahn's algorithm, return nodes grouped by execution tier. Enforce **server-side node limits** (configurable, default 50). Unit tests with various graph topologies (linear, parallel branches, diamond, invalid cycles).
- **Owner**: Backend
- **Effort**: L
- **Dependencies**: T-006

### T-023: Implement run executor
- **Description**: Build `packages/engine/src/executor.ts`: `startRun(workflowId)` takes an **immutable snapshot** of the current workflow graph (allowing the user to continue editing during execution). Creates a `Run` record and `NodeExecution` records for all nodes (status: pending). Calls scheduler to get tier-0 nodes, enqueues them to BullMQ `predictions` queue. Listens for node completion events and enqueues newly-unblocked nodes. Updates `Run` status based on aggregate node statuses. Handles budget cap checking before each enqueue. Uses `(runId, nodeId)` **execution guard** to prevent duplicate processing.
- **Owner**: Backend
- **Effort**: L
- **Dependencies**: T-004, T-022

### T-024: Implement BullMQ worker
- **Description**: Build `packages/worker/src/predictionRunner.ts` and `packages/worker/src/downloadRunner.ts` as **two separate BullMQ workers** consuming from `predictions` and `downloads` queues respectively. **Prediction worker**: decrypt API key, call adapter.runPrediction, poll adapter.getPredictionStatus with **adaptive intervals** (2s initial → 5s → 10–15s ceiling + jitter), mark node as `awaiting_download` when prediction completes, enqueue download job. **Download worker**: fetch output assets using `.partial` temp file → atomic rename to final path at `/data/assets/{runId}/{nodeId}/`, update node_execution record, emit completion event. Handle utility nodes locally (no provider call). Configure concurrency from `MAX_CONCURRENT_NODES`. Worker runs as a **separate Node.js process** in the same container, launched via `entrypoint.sh` alongside the Next.js server. On startup, run **reconciliation**: compare BullMQ active/waiting jobs against SQLite state, cancel orphaned jobs, re-enqueue interrupted work, using `(runId, nodeId)` execution guard to prevent duplicates.
- **Owner**: Backend
- **Effort**: L
- **Dependencies**: T-005, T-012, T-023

### T-025: Docker Compose with Redis
- **Description**: Create `docker-compose.yml` with `app` and `redis` services. Redis uses `redis:7-alpine` with healthcheck. App uses **`node:22-slim`** base image (not Alpine, to support `sharp` native binaries). App depends on Redis. Create `entrypoint.sh` that starts both the Next.js server and the worker process. Create `.env.example` with all environment variables documented (including `ALLOWED_IPS`, `TRUST_PROXY`). Test that `docker compose up` starts both services and the app connects to Redis. Add volume mounts for `/data`.
- **Owner**: DevOps
- **Effort**: M
- **Dependencies**: T-024

### T-026: Run API routes
- **Description**: Implement: `POST /api/workflows/:id/runs` (validate workflow, show **run confirmation dialog** data — always returned, client-side per-workflow skip preference stored in localStorage), `GET /api/workflows/:id/runs` (paginated list), `GET /api/workflows/:id/runs/:runId` (detail with node statuses), `POST /api/workflows/:id/runs/:runId/cancel` (cancel running run), `POST /api/workflows/:id/runs/:runId/resume` (resume failed run). Update denormalized `last_run_*` columns on workflow table after each run completes/fails.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-023

### T-027: SSE streaming endpoint
- **Description**: Implement `GET /api/workflows/:id/runs/:runId/events` as a Server-Sent Events stream. Events: `node:queued`, `node:started`, `node:completed` (with output paths + cost), `node:failed` (with mapped error code + sanitized provider error), `node:thumbnail` (per-node live thumbnail URL during generation), `run:completed`, `run:failed`, `run:cancelled`, `run:budget_exceeded`, `run:paused`. Each event includes a monotonic event ID for reconnection. Store events in memory (per-run, cleared on run completion) for catch-up on reconnect.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-026

### T-028: Frontend SSE integration and canvas run visualization
- **Description**: Build `useSSE.ts` hook: connects to SSE endpoint on run start, parses events, updates run state via **TanStack Query** cache invalidation (TanStack Query for server state, Zustand only for local editor state). On `node:started`: canvas node shows spinning indicator + blue border. On `node:thumbnail`: show **live thumbnail** on the node card (per-node via SSE). On `node:completed`: green border + output thumbnail (for video nodes, show **provider-sourced thumbnail** if available, otherwise a fallback filmstrip icon). On `node:failed`: red border + error icon with mapped error message. Show `RunConfirmDialog.tsx` before every run (always-show, with per-workflow "don't ask again" checkbox stored in localStorage). Run button changes to "Cancel" during execution. Status bar at top shows: "Running node 3 of 5... $0.12 spent". Auto-reconnect on SSE disconnect. Video outputs use native **HTML5 `<video>`** element for preview (no custom player). Implement **continuous validation**: validate the graph before run and show inline errors on invalid nodes.
- **Owner**: Frontend
- **Effort**: L
- **Dependencies**: T-008, T-027

### T-029: End-to-end single-node execution test
- **Description**: Integration test: create a workflow with one mock-provider node via API, start a run, verify SSE events are received in correct order (queued → started → completed), verify output asset exists on disk (two-phase: prediction then download), verify run record shows completed status and cost. Test with real Docker Compose stack (app + Redis). Part of **critical-path + thin E2E** test strategy.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-025, T-028

### T-030: Multi-node and parallel execution test
- **Description**: Integration test: (1) Create a 3-node linear workflow (A → B → C), run it, verify sequential execution order. (2) Create a diamond workflow (A → B, A → C, B → D, C → D), verify B and C run in parallel, D waits for both. Use mock adapter with configurable latency to verify timing. Test with real BullMQ queue (both `predictions` and `downloads` queues).
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-029

### T-031: Retry and timeout logic
- **Description**: Implement retry handling in prediction worker: on transient errors (429, 500, 502, 503, 504, network timeout), retry up to `retryCount` times with exponential backoff (5s, 15s, 45s) **plus jitter** to avoid thundering herd. **Respect `Retry-After` header** from provider responses — if present, use it as the delay floor. On 400 errors, fail immediately. Implement timeout: if polling exceeds `timeoutMs`, call `adapter.cancelPrediction()` and mark node as failed. Update `node_executions.attempt` counter. Use **same parameters** on retry (no mutation). Unit tests with mock adapter configured to fail transiently.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-024

### T-032: Partial failure handling
- **Description**: When a node in a parallel branch fails and has exhausted retries: (1) Mark it `failed`. (2) Mark all downstream nodes in that branch as `cancelled`. (3) Allow other independent branches to continue. (4) When all branches complete, mark run as `partial_failure` if at least one branch succeeded, or `failed` if all failed. SSE events reflect per-branch status. Unit tests with diamond topology and selective failures.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-031

### T-033: Resume from failure
- **Description**: Implement `packages/engine/src/resume.ts`: (1) Validate run is in `failed` or `partial_failure` state. (2) Re-validate workflow graph from the **immutable snapshot** stored with the run. (3) Verify output assets for completed nodes exist. (4) Reset `failed` nodes to `pending`. (5) Re-run scheduler from pending nodes, reusing completed node outputs. API: `POST /api/workflows/:id/runs/:runId/resume`. Frontend: "Resume" button on failed runs. Integration test: fail node 2 of 3, resume, verify node 1 output reused.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-032

### T-034: Budget cap enforcement
- **Description**: Before enqueuing each node, executor checks: `run.total_cost + estimatedNextNodeCost > budgetCap?`. Cost estimates use defaults with uncertainty flags. If yes and `budget_mode = 'hard_stop'`: cancel remaining nodes, mark run `budget_exceeded`. If `budget_mode = 'pause_and_prompt'`: pause run, emit SSE `run:paused` event. Frontend shows confirmation dialog: "Budget cap of $X reached. $Y spent so far. Continue?". User confirms → resume. User declines → cancel. Unit tests for both modes.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-023, T-028

---

## Week 4: Polish, Templates, & Deployment (Days 22–30)

### T-035: Run history list view
- **Description**: Build `/workflows/[id]/history` page using shadcn/ui components. `RunList.tsx` shows paginated table: Run # (auto-increment display), Status badge (completed=green, failed=red, partial_failure=orange, cancelled=gray), Started At (relative time), Duration, Total Cost (formatted USD), Output Thumbnail (first output node's image; for video, show provider-sourced thumbnail or fallback icon). Click row expands to RunDetail inline. Pagination controls (20 per page). Fetches from `GET /api/workflows/:id/runs`.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-026

### T-036: Run detail / inspector Run tab
- **Description**: Build `RunInspector.tsx` for the inspector panel's Run tab using shadcn/ui components. When viewing a completed/failed run: shows per-node breakdown — node label, status, execution time, cost, input summary, output thumbnail (click to enlarge image / play video via native HTML5 `<video>`). Expandable sections for **debug payloads** — stored on disk (file reference in DB), displayed with **redaction** of sensitive fields. Links output thumbnails to full-resolution asset view.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-019, T-035

### T-037: Run comparison view — **SCOPE BUFFER**
- **Description**: Build `RunCompare.tsx`. User selects two runs from history → opens side-by-side view. Left column: Run A parameters and outputs. Right column: Run B parameters and outputs. Parameter differences highlighted (yellow background on changed values). Output images displayed side-by-side at equal size. Accessible from history page via multi-select + "Compare" button. **Note**: This task is designated as scope buffer — cut first if timeline pressure requires it.
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-035

### T-038: Utility nodes — resize, crop, format conversion
- **Description**: Implement local utility nodes that execute without provider API calls. (1) **Resize**: accepts image input + target width/height, outputs resized image using sharp library. (2) **Crop**: accepts image + crop region (x, y, width, height), outputs cropped image. (3) **Format conversion**: accepts image + target format (PNG, JPEG, WebP), outputs converted image. Register as node types with correct port definitions. Worker detects utility nodes and runs them locally. Auto-convert suggestion: when a type mismatch is detected between connected nodes, **suggest** the appropriate utility node and let the user insert it (never auto-insert silently).
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-024

### T-039: Utility nodes — compositing and prompt template
- **Description**: (1) **Basic compositing**: accepts two image inputs + blend mode (overlay, side-by-side, top-bottom), outputs combined image using sharp. (2) **Prompt template**: accepts text template with `{{variable}}` placeholders + variable inputs (text ports), outputs resolved text. No image processing. Register both as node types. Unit tests for each.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-038

### T-040: Create 5 built-in templates
- **Description**: Author 5 template JSON files in `/templates/`: (1) text-to-image.json — single Flux node; (2) image-to-image-style-transfer.json — upload → Flux img2img (separate node type); (3) image-to-video.json — Flux → Kling v2; (4) multi-model-comparison.json — parallel Flux 1.1 Pro + SDXL; (5) video-upscale-pipeline.json — Kling v2 → AuraSR. Each includes metadata (name, description, category, requiredProviders, previewImage placeholder). Validate all against workflow schema.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-006, T-014, T-015

### T-041: Template API routes
- **Description**: Implement: `GET /api/templates` (list built-in + user templates, filter by `?type=builtin|user`), `GET /api/templates/:id` (detail), `POST /api/templates` (save workflow as user template — copies graph, strips API keys), `DELETE /api/templates/:id` (user templates only). On first startup, seed built-in templates from `/templates/*.json` into DB. Template records are immutable after seeding.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004, T-040

### T-042: Template gallery UI
- **Description**: Build template gallery on the "New Workflow" page using shadcn/ui components. `TemplateGallery.tsx` shows grid of `TemplateCard.tsx` components: preview image, name, description, required providers (with status icons: green check if configured, yellow warning if not). Click a template → provider compatibility check. If all providers configured, create workflow copy and navigate to canvas. If provider missing, show substitution suggestion dialog (see T-043). "My Templates" tab shows user-saved templates. Contextual empty state for "My Templates" tab when none exist (e.g., "Save a workflow as a template to see it here").
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-007, T-041

### T-043: Template provider compatibility check
- **Description**: When a template references a provider the user hasn't configured: (1) Detect which nodes use unconfigured providers. (2) Suggest equivalent models from configured providers (mapping maintained in `modelEquivalents.ts` in `packages/shared`). (3) Show dialog: "This template uses Replicate (not configured). Substitute with Fal AI equivalents?" with model-by-model comparison (name, capability notes, price difference). (4) User confirms → swap model references. User declines → navigate to provider settings. Never auto-swap silently.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-042

### T-044: Workflow export/import
- **Description**: Export: `GET /api/workflows/:id/export` returns workflow JSON as downloadable file (Content-Disposition: attachment). Strips all provider API keys and run history. Frontend: "Export" button in workflow editor toolbar. Import: `POST /api/import` accepts JSON file upload, validates against workflow schema. **Always import** the workflow even if it references unknown models/providers — show an `ImportResolutionPanel.tsx` that lists unresolvable nodes and lets the user remap them to available models or delete them. Creates new workflow with imported graph. Frontend: "Import" button on workflow list page with file picker. Validation errors shown in toast. Support **group copy/paste** within canvas: copy selected nodes, preserve internal edges between copied nodes.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-009

### T-045: Cost dashboard / usage page — **SCOPE BUFFER**
- **Description**: Build `/usage` page using shadcn/ui components. `CostDashboard.tsx` with three views: (1) Spend by provider — bar chart showing total spend per provider for selected time period. (2) Spend by workflow — table of workflows ranked by total spend. (3) Spend over time — line chart of daily/weekly/monthly spend. Time period selector (7d, 30d, 90d, all). Data from `GET /api/usage?period=...`. Use Recharts for charts. All data computed from run history — no external analytics. **Note**: This task is designated as scope buffer — cut first if timeline pressure requires it (after T-037 comparison view is cut).
- **Owner**: Frontend
- **Effort**: M
- **Dependencies**: T-007, T-026

### T-046: Usage API endpoint — **SCOPE BUFFER**
- **Description**: Implement `GET /api/usage` with query params: `period` (day, week, month, all), `provider` (optional filter). Aggregates cost data from `runs` and `node_executions` tables. Returns: `{ byProvider: [{id, name, total}], byWorkflow: [{id, name, total, runCount}], overTime: [{date, total}] }`. SQL queries use indexed columns for performance. **Note**: This task is designated as scope buffer — cut alongside T-045.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004

### T-047: Access password, session auth, and IP allowlist
- **Description**: First-run: if no password hash in `settings` table, show setup page requiring password creation (min 8 chars). Hash with bcrypt (cost 12), store in settings. Login page: password input → POST `/api/auth/login` → validates against stored hash → sets HTTP-only, Secure, SameSite=Strict cookie with signed JWT (HS256, 7-day expiry). Middleware on all `/api/*` routes (except `/api/auth/*`) checks cookie. 401 redirects to login page. Rate limit: 5 login attempts per minute. Implement optional **`ALLOWED_IPS`** environment variable: if set, middleware rejects requests from IPs not in the allowlist (comma-separated CIDRs). Respect `TRUST_PROXY` env var for correct client IP behind reverse proxy. Add **moderate CSP headers** (Content-Security-Policy) to all responses.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004, T-005

### T-048: Login page UI
- **Description**: Build `/login` page and `/setup` page (first-run password creation) using shadcn/ui components. Simple centered card with password input and submit button. Error messages for invalid password and rate limit. Redirect to `/workflows` on success (no separate landing page — `/` redirects to `/workflows`). Setup page has password + confirm password fields. Client-side redirect to login if not authenticated (check via lightweight `/api/auth/check` endpoint).
- **Owner**: Frontend
- **Effort**: S
- **Dependencies**: T-047

### T-049: License validation system
- **Description**: Implement **Ed25519 offline license validation** per TDD §11. On startup: check `/data/config/license.json`. License file contains a signed JWT with fields: `tier`, `seats`, `expiresAt`, `machineHash`. Verify signature using the **public key bundled in the app** (asymmetric — no license server needed for MVP). Machine hash = SHA-256(hostname + MAC + DATA_DIR). If signature invalid or expired: enter **read-only mode** (block new runs, show banner). Log all validation attempts to audit log. Create `scripts/issue-license.ts` — CLI script in the repo that uses the **private key** (kept by vendor, never shipped) to generate and sign license tokens for customers.
- **Owner**: Backend
- **Effort**: M
- **Dependencies**: T-004, T-005

### T-050: Asset serving API route
- **Description**: Implement `GET /api/assets/:runId/:nodeId/:filename` — serves generated assets from disk. Validates runId exists in DB before serving. Sets correct Content-Type based on file extension. Supports HTTP Range requests for video playback (partial content / 206 responses). Returns 404 for missing assets. No directory traversal (validate path components contain no `..` or `/`). Build `StorageUsage.tsx` component for the settings page — shows total disk usage of `/data/assets/` with a **manual purge** button to delete assets for old runs. No automatic cleanup.
- **Owner**: Backend
- **Effort**: S
- **Dependencies**: T-004

### T-051: Audit logging
- **Description**: Implement audit logging using **Pino** structured JSON logger with **redaction** of sensitive fields (API keys, passwords) and **correlation IDs** per request. Log these events to `audit_logs` table: API key added/removed/validated, workflow created/deleted, run started/completed/failed/cancelled, settings changed, login success/failure. Each entry: `{ action, details (JSON), correlationId, created_at }`. No PII or API keys in log entries. Internal helper: `auditLog(action: string, details: object)` callable from any API route. Store **debug payloads** (raw provider request/response) on disk at `/data/debug/{runId}/{nodeId}.json`, store file reference in DB, apply redaction before writing.
- **Owner**: Backend
- **Effort**: S
- **Dependencies**: T-004

### T-052: Dockerfile and production build
- **Description**: Create multi-stage Dockerfile: (1) deps stage — install pnpm dependencies; (2) builder stage — run Turbo build; (3) runner stage — **`node:22-slim`** (not Alpine — required for sharp native binaries), non-root user `aistudio`, copy standalone output + static + public + templates. Create `entrypoint.sh` that starts both the Next.js server and the worker process. Output image should be < 200 MB. Verify `docker build` succeeds and `docker run` starts the application. Configure Next.js standalone output in `next.config.ts`.
- **Owner**: DevOps
- **Effort**: M
- **Dependencies**: T-025

### T-053: Multi-arch Docker build CI
- **Description**: Set up GitHub Actions workflow triggered on tag push (`v*`). Steps: checkout, set up Docker Buildx with QEMU, build multi-platform image (linux/amd64, linux/arm64), push to Docker Hub and GitHub Container Registry. Tag with version number + `latest`. Verify arm64 image runs correctly (CI can test amd64; arm64 verified via QEMU emulation build success).
- **Owner**: DevOps
- **Effort**: M
- **Dependencies**: T-052

### T-054: CI pipeline for PRs
- **Description**: GitHub Actions workflow on PR: (1) pnpm install, (2) TypeScript compilation (`turbo build`), (3) ESLint (`turbo lint`), (4) Unit tests (`turbo test`) — **critical-path + thin E2E** test strategy, (5) `npm audit` for vulnerability check. Cache pnpm store and Turbo cache between runs. Fail PR if any step fails. Status checks required for merge.
- **Owner**: DevOps
- **Effort**: S
- **Dependencies**: T-003

### T-055: Deployment documentation
- **Description**: Write `docs/deployment.md`: step-by-step guide for Docker Compose deployment, environment variable reference (including `ALLOWED_IPS`, `TRUST_PROXY`), first-run setup (password, API keys), backup procedures (SQLite copy + pre-migration auto-backup, asset directory), update process (pull + restart), troubleshooting common issues. Write `docs/reverse-proxy.md`: sample configs for Nginx, Caddy, and Traefair with HTTPS termination. Write `docs/adapter-development.md`: guide for building custom adapters against the `ProviderAdapter` interface. Include `scripts/restore-backup.ts` utility for restoring a pre-migration backup.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: T-052

### T-056: Final smoke test
- **Description**: End-to-end manual test on a clean machine: (1) Clone repo, `docker compose up` (verify `entrypoint.sh` starts both server and worker). (2) Set access password. (3) Configure mock provider (or real provider if key available). (4) Create workflow from template (verify template substitution dialog). (5) Modify parameters in inspector (verify continuous validation). (6) Run workflow — verify run confirmation dialog, observe progress via SSE with live thumbnails. (7) View run history. (8) Export workflow as JSON. (9) Import workflow (verify import resolution panel). (10) Test soft-delete → trash → permanent delete. (11) Test resume from failure (kill Redis mid-run, restart, verify startup reconciliation, resume). (12) Verify storage dashboard shows usage. Document any issues found.
- **Owner**: Fullstack
- **Effort**: M
- **Dependencies**: All previous tasks

---

## Summary

| Week | Tasks | S | M | L |
|------|-------|---|---|---|
| 1 | T-001 through T-011 | 3 | 6 | 2 |
| 2 | T-012 through T-021 | 2 | 6 | 2 |
| 3 | T-022 through T-034 | 0 | 9 | 4 |
| 4 | T-035 through T-056 | 4 | 16 | 2 |
| **Total** | **56 tasks** | **9** | **37** | **10** |

**Effort key**: S = < 4 hours, M = 4–8 hours (1 day), L = 8–16 hours (1–2 days)

**Scope buffer tasks** (cut in order if timeline pressure): T-037 (Run comparison), T-045/T-046 (Cost dashboard + API)
