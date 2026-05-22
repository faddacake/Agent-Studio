# Technical Design Document

**Product**: Itera Studio
**Based on**: PRD v1 (approved)
**Scope**: MVP (single-user, Docker, Replicate + Fal AI)
**Architecture Interview**: v1 complete (60 decisions resolved)

---

## 1. System Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Client)                     │
│  ┌──────────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  React Flow   │  │ Inspector │  │  Run History UI   │  │
│  │  Canvas       │  │  Panels   │  │  + Cost Dashboard │  │
│  │  (shadcn/ui)  │  │           │  │                   │  │
│  └──────┬───────┘  └────┬─────┘  └────────┬──────────┘  │
│         └───────────────┼─────────────────┘              │
│                         │ HTTP (TanStack Query) + SSE    │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────┐
│          Docker Container: app (two Node.js processes)    │
│                         │                                 │
│  ┌──────────────────────┴──────────────────────────┐     │
│  │  Process 1: Next.js (standalone mode)            │     │
│  │  ┌──────────────────────────────────────────┐   │     │
│  │  │          API Route Layer (/api/*)          │   │     │
│  │  │  workflows | runs | providers | sse       │   │     │
│  │  └──────┬──────────┬──────────────┬─────────┘   │     │
│  │         │          │              │              │     │
│  │  ┌──────┴───┐ ┌────┴─────┐ ┌─────┴──────────┐  │     │
│  │  │ Workflow  │ │ Provider │ │  Orchestration  │  │     │
│  │  │ Service   │ │ Registry │ │  Engine (DAG)   │  │     │
│  │  └──────┬───┘ └────┬─────┘ └─────┬──────────┘  │     │
│  │         │          │              │              │     │
│  │  ┌──────┴──────────┴──────────────┴──────────┐  │     │
│  │  │       Data Access Layer (Drizzle ORM)      │  │     │
│  │  └───────────────────────────────────────────┘  │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Process 2: BullMQ Worker (separate event loop)  │     │
│  │  ┌─────────────────┐  ┌───────────────────┐     │     │
│  │  │ Prediction Worker│  │ Download Worker    │     │     │
│  │  │ (predictions q)  │  │ (downloads queue)  │     │     │
│  │  └────────┬─────────┘  └────────┬──────────┘     │     │
│  │           │ HTTPS               │ HTTPS           │     │
│  └───────────┼─────────────────────┼─────────────────┘     │
│              ▼                     ▼                       │
│         Provider APIs         Provider CDNs               │
│        (Replicate, Fal)    (download outputs)             │
│                                                           │
│  ┌───────────────────────────────────────────┐           │
│  │  SQLite (volume: /data/db/agentstudio.db)    │           │
│  │  WAL mode + auto-checkpoint               │           │
│  └───────────────────────────────────────────┘           │
│  ┌───────────────────────────────────────────┐           │
│  │  Asset Storage (volume: /data/assets/)    │           │
│  └───────────────────────────────────────────┘           │
└──────────────────────────┬───────────────────────────────┘
                           │ Enqueue / Dequeue
┌──────────────────────────┼───────────────────────────────┐
│              Redis (Container: redis)                     │
│     ┌────────────────────┼────────────────────┐          │
│     │  Queue: predictions │  Queue: downloads  │          │
│     └────────────────────┴────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

### Major Components and Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Next.js Frontend** | React Flow canvas (controlled mode), workflow editing UI, run monitoring, settings pages. Dark theme only. shadcn/ui components. TanStack Query for data fetching. |
| **API Route Layer** | REST endpoints for workflow CRUD, run management, provider config, SSE streaming. Runs in Next.js standalone mode (not serverless). |
| **Workflow Service** | Workflow validation (continuous client-side + authoritative server-side), JSON schema enforcement, template management, optimistic concurrency via `workflow_version`. |
| **Provider Registry** | Loads adapters at startup, routes API calls to correct adapter, manages key decryption |
| **Orchestration Engine** | Parses workflow DAG, determines execution order, dispatches jobs, tracks run state, enforces budget caps, handles startup reconciliation of stale jobs |
| **BullMQ Worker (Process 2)** | Runs as a **separate Node.js process** in the same container (managed by entrypoint script). Processes two queues: `predictions` (provider API calls) and `downloads` (asset retrieval). Isolates worker event loop from Next.js API responsiveness. |
| **Data Access Layer** | Drizzle ORM over SQLite (WAL mode) — all DB reads/writes go through this layer |
| **Redis** | BullMQ queue backend only — no application caching. Two queues: `predictions` and `downloads`. |
| **SQLite** | Workflows, run history, provider configs, settings, audit logs. WAL mode with auto-checkpoint + safety checkpoint on shutdown. |
| **Asset Storage** | Local filesystem for generated images/videos, organized by run ID. All inter-node data passes as file references (disk-first). |

### Data Flow: Typical Workflow Run

1. User clicks **Run** in the frontend.
2. Frontend shows a **run confirmation dialog** with per-node cost estimates, total estimated cost, and budget cap status. User clicks "Start Run" (dialog can be disabled per-workflow via a "don't show again" toggle).
3. Frontend sends `POST /api/workflows/:id/runs` with `{ budgetCap?, budgetMode? }`.
4. API route validates the workflow (server-side, authoritative), takes an immutable **graph snapshot**, and calls the Orchestration Engine. The canvas remains fully editable — a persistent banner indicates "Run in progress using a previous version."
5. Engine creates a `Run` record (status: `running`) and `NodeExecution` records (status: `pending`) in SQLite.
6. Engine enqueues the first tier of ready nodes (no unmet dependencies) as BullMQ jobs on the `predictions` queue.
7. Prediction Worker picks up a job:
   a. Checks the `(runId, nodeId)` execution guard to prevent duplicate execution.
   b. Decrypts the provider API key from the database.
   c. Calls the appropriate adapter's `runPrediction()`.
   d. Polls `getPredictionStatus()` using **adaptive intervals**: 2s for the first 30s, 5s up to 2 minutes, then 10–15s with jitter. Respects `Retry-After` headers on 429 responses.
   e. On prediction completion, marks node status as `awaiting_download` and enqueues a `downloadAsset` job on the `downloads` queue (one per output).
   f. Emits a progress event to the SSE channel.
8. Download Worker picks up the download job:
   a. Streams the output file to `/data/assets/runs/{runId}/nodes/{nodeId}/output.partial`.
   b. On completion, performs atomic rename to final filename, verifies checksum/length if available.
   c. Generates a small thumbnail preview (sharp resize for images; uses provider-supplied thumbnail URL for videos, or a styled placeholder icon if unavailable).
   d. Writes debug payloads (`request.json`, `response.json`) to disk with secrets redacted.
   e. Updates `NodeExecution` record to `completed` with output metadata and file paths.
   f. Emits SSE event `node:completed` with thumbnail URL and cost.
9. Orchestration Engine (listening for completion events) checks if downstream nodes are now unblocked and enqueues them. Before enqueuing, checks cumulative cost against budget cap.
10. Steps 7–9 repeat until all nodes complete or a failure/budget event halts execution.
11. Engine updates `Run` record to terminal status (`completed`, `failed`, `partial_failure`, `budget_exceeded`). Updates denormalized `last_run_status`, `last_run_at`, `last_run_id` on the workflow record.
12. Frontend receives final SSE event. Live per-node thumbnails are already visible on the canvas via incremental SSE updates during the run.

---

## 2. Repository & Monorepo Structure

### Directory Layout

```
ai-studio/
├── docker-compose.yml
├── Dockerfile
├── entrypoint.sh                 # Manages two processes: Next.js + worker
├── .env.example
├── package.json                  # Root workspace config
├── turbo.json                    # Turborepo pipeline config (lint, typecheck, build, test, dev)
├── tsconfig.base.json            # Shared TS config
│
├── apps/
│   └── web/                      # Next.js application
│       ├── package.json
│       ├── next.config.ts        # standalone output mode
│       ├── tsconfig.json
│       ├── src/
│       │   ├── app/              # Next.js App Router pages
│       │   │   ├── layout.tsx    # Dark theme, shadcn/ui provider
│       │   │   ├── page.tsx      # Redirects to /workflows
│       │   │   ├── login/
│       │   │   │   └── page.tsx              # Login page
│       │   │   ├── setup/
│       │   │   │   └── page.tsx              # First-run password setup
│       │   │   ├── workflows/
│       │   │   │   ├── page.tsx              # Workflow list (landing page)
│       │   │   │   ├── trash/
│       │   │   │   │   └── page.tsx          # Trash view
│       │   │   │   └── [id]/
│       │   │   │       ├── page.tsx          # Workflow editor (canvas, ≥1024px)
│       │   │   │       └── history/
│       │   │   │           └── page.tsx      # Run history for workflow
│       │   │   ├── settings/
│       │   │   │   ├── page.tsx              # General settings (app preferences)
│       │   │   │   └── providers/
│       │   │   │       └── page.tsx          # Provider API key management
│       │   │   └── usage/
│       │   │       └── page.tsx              # Cost dashboard + storage usage
│       │   │
│       │   ├── api/              # Next.js API routes (backend)
│       │   │   ├── auth/
│       │   │   │   ├── login/route.ts        # POST (login)
│       │   │   │   ├── setup/route.ts        # POST (first-run password)
│       │   │   │   └── check/route.ts        # GET (session check)
│       │   │   ├── workflows/
│       │   │   │   ├── route.ts              # GET (list), POST (create)
│       │   │   │   └── [id]/
│       │   │   │       ├── route.ts          # GET, PUT (with workflow_version), DELETE
│       │   │   │       ├── export/route.ts   # GET (download JSON)
│       │   │   │       └── runs/
│       │   │   │           ├── route.ts      # GET (list), POST (start run)
│       │   │   │           └── [runId]/
│       │   │   │               ├── route.ts  # GET (run detail)
│       │   │   │               ├── resume/route.ts   # POST
│       │   │   │               ├── cancel/route.ts   # POST
│       │   │   │               └── events/route.ts   # GET (SSE stream)
│       │   │   ├── providers/
│       │   │   │   ├── route.ts              # GET (list configured)
│       │   │   │   └── [providerId]/
│       │   │   │       ├── route.ts          # PUT (save key), DELETE
│       │   │   │       ├── validate/route.ts # POST (test key)
│       │   │   │       └── models/route.ts   # GET (list models)
│       │   │   ├── templates/
│       │   │   │   ├── route.ts              # GET (list), POST (save as template)
│       │   │   │   └── [id]/route.ts         # GET, DELETE
│       │   │   ├── settings/
│       │   │   │   └── route.ts              # GET, PUT
│       │   │   ├── assets/
│       │   │   │   └── [...path]/route.ts    # GET (serve assets from disk)
│       │   │   ├── import/route.ts           # POST (import workflow JSON)
│       │   │   ├── estimate/route.ts         # POST (cost estimate)
│       │   │   └── usage/route.ts            # GET (usage + storage stats)
│       │   │
│       │   ├── components/       # React components (shadcn/ui based)
│       │   │   ├── canvas/
│       │   │   │   ├── WorkflowCanvas.tsx    # React Flow wrapper (controlled mode)
│       │   │   │   ├── CustomNode.tsx        # Base node component
│       │   │   │   ├── CommentNode.tsx       # Sticky-note comment node
│       │   │   │   ├── NodePort.tsx          # Typed port component (color-coded)
│       │   │   │   ├── ConnectionLine.tsx    # Edge rendering
│       │   │   │   ├── CanvasContextMenu.tsx # Right-click menus
│       │   │   │   ├── NodePalette.tsx       # Sidebar palette with text filter
│       │   │   │   ├── RunConfirmDialog.tsx  # Pre-run cost confirmation
│       │   │   │   └── MiniMap.tsx
│       │   │   ├── inspector/
│       │   │   │   ├── InspectorPanel.tsx    # Side panel wrapper
│       │   │   │   ├── NodeConfig.tsx        # Parameter editing
│       │   │   │   ├── RunInspector.tsx      # Run debug info (payloads via "Show raw")
│       │   │   │   └── OutputPreview.tsx     # Image viewer / HTML5 <video>
│       │   │   ├── history/
│       │   │   │   ├── RunList.tsx
│       │   │   │   └── RunDetail.tsx
│       │   │   ├── providers/
│       │   │   │   ├── ProviderCard.tsx
│       │   │   │   └── ApiKeyForm.tsx
│       │   │   ├── templates/
│       │   │   │   ├── TemplateGallery.tsx
│       │   │   │   └── TemplateCard.tsx
│       │   │   ├── import/
│       │   │   │   └── ImportResolutionPanel.tsx  # Post-import compatibility
│       │   │   ├── usage/
│       │   │   │   ├── CostDashboard.tsx
│       │   │   │   └── StorageUsage.tsx     # Disk usage + manual purge
│       │   │   └── shared/
│       │   │       ├── Layout.tsx            # Responsive (non-canvas pages)
│       │   │       ├── Sidebar.tsx
│       │   │       ├── TopBar.tsx
│       │   │       ├── EmptyState.tsx        # Contextual empty states with CTAs
│       │   │       ├── ConfirmDialog.tsx
│       │   │       └── BudgetCapBanner.tsx
│       │   │
│       │   ├── stores/           # Zustand stores (local/editor state only)
│       │   │   ├── workflowStore.ts          # Nodes, edges, undo/redo stack
│       │   │   ├── runStore.ts               # Active run state, SSE
│       │   │   └── uiStore.ts               # Panels, modals, preferences
│       │   │
│       │   ├── hooks/            # Custom React hooks
│       │   │   ├── useWorkflow.ts
│       │   │   ├── useRunExecution.ts
│       │   │   ├── useSSE.ts
│       │   │   ├── useUndoRedo.ts
│       │   │   ├── useCostEstimate.ts
│       │   │   └── useShortcuts.ts          # Central shortcut registry
│       │   │
│       │   └── lib/              # Shared frontend utilities
│       │       ├── api.ts                    # TanStack Query config + fetch helpers
│       │       ├── shortcuts.ts              # Shortcut registry (action ID → key combo)
│       │       ├── validateForUI.ts          # Zod → field-level UI error mapping
│       │       └── formatters.ts             # Cost, date, file size
│       │
│       └── public/
│           ├── icons/            # Provider icons
│           └── templates/        # Template preview images
│
├── packages/
│   ├── engine/                   # Orchestration engine (pure TS, no Next.js deps)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── dag.ts                        # DAG parser + topological sort
│   │       ├── scheduler.ts                  # Node scheduling logic
│   │       ├── executor.ts                   # Run coordinator
│   │       ├── reconciler.ts                 # Startup job reconciliation
│   │       ├── resume.ts                     # Resume-from-failure logic
│   │       └── types.ts                      # Engine-specific types
│   │
│   ├── worker/                   # BullMQ worker (separate process, same container)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                      # Worker entry point (both queues)
│   │       ├── predictionRunner.ts           # Prediction job processor
│   │       ├── downloadRunner.ts             # Download job processor
│   │       ├── polling.ts                    # Adaptive polling with jitter
│   │       ├── thumbnails.ts                 # Thumbnail generation (sharp/provider)
│   │       └── assetWriter.ts               # Write outputs to disk (.partial → rename)
│   │
│   ├── adapters/                 # Provider adapter package (plugin-ready interface)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                      # Adapter registry + loader
│   │       ├── types.ts                      # ProviderAdapter interface
│   │       ├── httpClient.ts                 # Shared fetch wrapper (timeouts, retries, redaction)
│   │       ├── replicate/
│   │       │   ├── adapter.ts
│   │       │   ├── models.ts                 # Hardcoded baseline schemas + pricing
│   │       │   ├── schemaFetcher.ts          # Dynamic schema fetch + cache
│   │       │   └── replicate.test.ts
│   │       ├── fal/
│   │       │   ├── adapter.ts
│   │       │   ├── models.ts
│   │       │   ├── schemaFetcher.ts
│   │       │   └── fal.test.ts
│   │       └── mock/
│   │           ├── adapter.ts               # Mock adapter for dev/CI
│   │           └── mock.test.ts
│   │
│   ├── db/                       # Database schema + migrations
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts                      # DB connection (WAL mode) + exported client
│   │       ├── schema.ts                     # All table definitions
│   │       ├── backup.ts                     # Pre-migration backup + restore helpers
│   │       └── migrations/                   # Drizzle migration files
│   │
│   ├── crypto/                   # Encryption utilities
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── encrypt.ts                    # AES-256-GCM encrypt/decrypt
│   │       ├── masterKey.ts                  # Key generation + loading
│   │       ├── license.ts                    # Ed25519 license token verification
│   │       └── rotate.ts                     # Key rotation utility
│   │
│   └── shared/                   # Shared types, Zod schemas, constants
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── workflowSchema.ts             # Workflow JSON schema (Zod) — shared client+server
│           ├── portTypes.ts                  # Port type definitions + compatibility matrix
│           ├── nodeTypes.ts                  # Node type registry
│           ├── modelEquivalents.ts           # Cross-provider model equivalence map
│           └── errors.ts                     # Shared error types + codes
│
├── templates/                    # Built-in workflow templates (JSON)
│   ├── text-to-image.json
│   ├── image-to-image-style-transfer.json
│   ├── image-to-video.json
│   ├── multi-model-comparison.json
│   └── video-upscale-pipeline.json
│
├── scripts/
│   ├── generate-master-key.ts    # CLI utility for key generation
│   ├── rotate-keys.ts           # Key rotation script
│   ├── issue-license.ts         # CLI: sign Ed25519 license tokens
│   ├── seed-templates.ts        # Load templates into DB on first run
│   └── restore-backup.ts        # CLI: list/restore DB backups
│
└── docs/
    ├── deployment.md
    ├── reverse-proxy.md          # Nginx, Caddy, Traefik configs
    └── adapter-development.md    # Guide for writing new adapters
```

### Monorepo Tooling

- **Package manager**: pnpm (workspaces)
- **Build orchestration**: Turborepo — caches builds, runs tasks in dependency order. Pipeline tasks: `lint`, `typecheck`, `build`, `test`, `dev`. Standard `package.json` scripts for portability (migration to Nx possible post-MVP without refactoring).
- **Internal packages** (`packages/*`) are referenced via pnpm workspace protocol (`"@iterastudio/engine": "workspace:*"`)
- All packages compile to ESM with TypeScript project references

### Why This Structure

The PRD specifies a monolithic Next.js app for MVP but requires clean backend/frontend separation for future extraction (PRD §10). Placing the engine, worker, adapters, DB, and crypto in separate `packages/` achieves this: they have zero Next.js imports and can be moved to a standalone Fastify service by changing only the API route layer. The adapter package uses a plugin-ready interface boundary — the engine depends only on the `ProviderAdapter` interface, not on provider-specific code — so third-party adapters can be added post-MVP by dropping a folder into the adapters directory.

---

## 3. Backend Design

### API Routes & Endpoints

All routes are under `/api/`. Request/response bodies are JSON unless noted.

#### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows` | List all workflows. Returns `{ workflows: WorkflowSummary[] }` with denormalized `lastRunStatus`, `lastRunAt`, `lastRunId`. Supports `?search=`, `?sort=name|created|lastRun`, `?filter=hasRuns|noRuns|status`. |
| `POST` | `/api/workflows` | Create a workflow. Body: `{ name, description? }`. Returns `{ workflow }` |
| `GET` | `/api/workflows/:id` | Get full workflow (including nodes/edges JSON). Returns `{ workflow }` |
| `PUT` | `/api/workflows/:id` | Update workflow. Body: partial workflow fields + graph JSON + `workflowVersion` for optimistic concurrency. Returns `{ workflow }`. Rejects stale saves with `409 CONFLICT`. |
| `DELETE` | `/api/workflows/:id` | Soft-delete a workflow (moves to Trash) |
| `POST` | `/api/workflows/:id/restore` | Restore a soft-deleted workflow from Trash |
| `DELETE` | `/api/workflows/:id/permanent` | Permanently delete a workflow + associated runs and assets from disk |
| `GET` | `/api/workflows/:id/export` | Download workflow as JSON file (Content-Disposition: attachment). Strips API keys, run history, and embedded assets. |
| `POST` | `/api/import` | Import a workflow from JSON file upload (multipart/form-data). Always succeeds. Returns `{ workflow, compatibilityIssues[] }` listing missing providers/models. |

#### Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows/:id/runs` | List runs for a workflow. Paginated: `?page=1&limit=20` |
| `POST` | `/api/workflows/:id/runs` | Start a new run. Body: `{ budgetCap?, budgetMode?, inputs? }`. Takes an immutable graph snapshot. Returns `{ run }` |
| `GET` | `/api/workflows/:id/runs/:runId` | Get run detail (node statuses, costs, outputs) |
| `POST` | `/api/workflows/:id/runs/:runId/resume` | Resume a failed run from the first failed node |
| `POST` | `/api/workflows/:id/runs/:runId/cancel` | Cancel a running run |
| `DELETE` | `/api/workflows/:id/runs/:runId` | Delete a run and its associated assets from disk |
| `GET` | `/api/workflows/:id/runs/:runId/events` | SSE stream for run progress events |

#### Providers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/providers` | List all providers with connection status (configured/not configured) |
| `PUT` | `/api/providers/:providerId` | Save or update API key. Body: `{ apiKey }` |
| `DELETE` | `/api/providers/:providerId` | Remove stored API key |
| `POST` | `/api/providers/:providerId/validate` | Test API key validity against provider. Body: `{ apiKey }` |
| `GET` | `/api/providers/:providerId/models` | List available models for a configured provider. Returns cached schemas (refreshed on demand). |
| `POST` | `/api/providers/:providerId/models/refresh` | Force-refresh model schemas from provider API |

#### Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List built-in + user templates. Filter: `?type=builtin|user` |
| `GET` | `/api/templates/:id` | Get template detail |
| `POST` | `/api/templates` | Save current workflow as user template. Body: `{ workflowId, name, description }` |
| `DELETE` | `/api/templates/:id` | Delete a user template (built-in templates cannot be deleted) |

#### Settings & Utility

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get application settings (DB-persisted app preferences) |
| `PUT` | `/api/settings` | Update settings. Body: partial settings object |
| `POST` | `/api/estimate` | Estimate cost for a workflow. Body: `{ workflowGraph, inputs? }`. Returns per-node and total estimates with uncertainty flags for nodes with dynamic inputs. |
| `GET` | `/api/usage` | Usage + storage statistics. Query: `?period=day|week|month&provider?`. Includes disk usage breakdown. |
| `GET` | `/api/assets/[...path]` | Serve generated assets from disk. Validates runId, supports HTTP Range for video. |

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/setup` | First-run password creation. Body: `{ password }` |
| `POST` | `/api/auth/login` | Login. Body: `{ password }`. Returns Set-Cookie. Rate-limited: 5 attempts/min. |
| `GET` | `/api/auth/check` | Session validity check |

### Authentication / Session Model (MVP)

MVP is single-user per PRD §7 ("Single-user Docker deployment"). No user accounts or login:

- On first launch, the user sets a **local access password** stored as a bcrypt hash (cost factor 12) in SQLite.
- Sessions use an HTTP-only, Secure, SameSite=Strict cookie containing a signed JWT (HS256, signed with the master key).
- JWT contains: `{ iss: "aistudio", iat, exp }` — no user ID needed for single-user.
- Token expiry: 7 days, refreshed on each API request.
- All `/api/*` routes except `/api/auth/*` check for a valid session cookie.
- Login endpoint is rate-limited to 5 attempts per minute per IP.
- **Optional IP allowlist**: If the `ALLOWED_IPS` environment variable is set (supports CIDR notation, e.g., `192.168.1.0/24,10.0.0.1`), all requests not matching the allowlist are denied with `403`. Applied at the middleware level before authentication.

This is intentionally minimal. Multi-user auth (PRD §8) replaces this entirely post-MVP.

### Request Validation

Canonical **Zod** schemas live in `packages/shared` and are used by both server and client (single source of truth). Server-side: schemas validate request bodies directly. Client-side: a `validateForUI()` wrapper converts Zod issues into field-level, human-readable messages for form display. Invalid requests return `400` with structured error:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid workflow graph",
  "details": [{ "path": "nodes[2].params.width", "message": "Must be between 64 and 2048" }]
}
```

### Error Response Format

All API errors follow a consistent structure:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "details": {},
  "providerError": {
    "provider": "replicate",
    "message": "Invalid prompt: contains blocked content",
    "fields": ["prompt"]
  }
}
```

Standard error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `PROVIDER_ERROR`, `PROVIDER_RATE_LIMIT`, `PROVIDER_VALIDATION_ERROR`, `PROVIDER_INTERNAL_ERROR`, `BUDGET_EXCEEDED`, `RUN_FAILED`, `UNAUTHORIZED`, `CONFLICT`, `INTERNAL_ERROR`.

Provider-originated errors are mapped to Itera Studio error codes with a sanitized `providerError` block for debugging. The block includes provider name and a safe message, but redacts secrets, headers, and opaque internal IDs. Full raw payloads are stored on disk (see §8) and accessible via an explicit "Show raw payload" action in the inspector.

### Configuration Split

- **Infrastructure settings** (`.env` file, require container restart): `PORT`, `REDIS_URL`, `DATA_DIR`, `MASTER_KEY`, `LICENSE_KEY`, `LOG_LEVEL`, `ALLOWED_IPS`, `TRUST_PROXY`.
- **Application settings** (Settings UI, persisted in DB, runtime-changeable): default budget cap, budget mode, confirmation dialog preferences, `MAX_NODES_PER_WORKFLOW`, `MAX_CONCURRENT_NODES`, trash/retention behavior.

---

## 4. Frontend Architecture

### Page Structure

| Route | Page | Description |
|-------|------|-------------|
| `/` | Redirect | Redirects to `/workflows` |
| `/login` | Login | Password input, rate-limit messaging |
| `/setup` | First-Run Setup | Password creation (first launch only) |
| `/workflows` | Workflow List (Landing) | Flat list with search, sort (name/date/last run), filter (status/has runs). Contextual empty state: "Create your first workflow or start from a template." |
| `/workflows/trash` | Trash | Soft-deleted workflows. Restore or permanently delete. |
| `/workflows/[id]` | **Workflow Editor** | Main canvas + inspector + palette + toolbar. Requires ≥1024px viewport. On smaller screens, shows "Use a larger screen" message. |
| `/workflows/[id]/history` | Run History | Paginated run list. Per-run delete action. |
| `/settings` | General Settings | App preferences (budget defaults, confirmation toggle, node limits). Persisted in DB. |
| `/settings/providers` | Provider Management | Add/remove API keys, test connections, refresh model schemas |
| `/usage` | Cost & Storage Dashboard | Spend breakdowns by provider, workflow, time period. Disk usage + manual purge tool. |

Non-canvas pages (settings, providers, history, usage, login) are responsive and work on tablet/mobile. The workflow editor is desktop-only (≥1024px).

### State Management

**TanStack Query** handles all server state (workflow lists, runs, provider configs, templates, usage data). Zustand handles **local editor state only** — no duplication of server data.

**`workflowStore`** (Zustand) — the core editing store:
```typescript
interface WorkflowState {
  workflowId: string | null;
  workflowVersion: number;        // Optimistic concurrency token
  nodes: CanvasNode[];            // React Flow nodes with Itera Studio metadata
  edges: CanvasEdge[];            // React Flow edges with port type info
  isDirty: boolean;
  pendingSave: boolean;
  undoStack: Patch[][];           // Immer patches for undo
  redoStack: Patch[][];

  // Actions
  addNode(type: string, position: XYPosition): void;
  removeNodes(ids: string[]): void;
  addEdge(connection: Connection): void;
  removeEdge(id: string): void;
  updateNodeParams(nodeId: string, params: Record<string, unknown>): void;
  updateNodePositions(updates: {id: string, position: XYPosition}[]): void; // Batched from drag
  copySelection(): void;         // Group copy with internal edges
  pasteSelection(offset: XYPosition): void;
  undo(): void;
  redo(): void;
  flushSave(): Promise<void>;    // Immediate save (on navigation/tab close)
  saveWorkflow(): Promise<void>; // Debounced auto-save (1s)
  loadWorkflow(id: string): Promise<void>;
}
```

Undo/redo uses **Immer patches**: every mutation produces a forward+inverse patch pair. Structural edits push immediately; parameter changes are coalesced within a 500ms window (PRD §9). Node position changes commit to undo history on `onNodeDragStop` (not during drag).

**`runStore`** (Zustand) — active run monitoring:
```typescript
interface RunState {
  activeRunId: string | null;
  nodeStatuses: Record<string, NodeExecutionStatus>;
  nodeThumbnails: Record<string, string>;  // Live thumbnails from SSE
  estimatedCost: CostEstimate | null;
  sseConnection: EventSource | null;

  startRun(workflowId: string, budgetCap?: number): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  connectSSE(runId: string): void;
  disconnectSSE(): void;
}
```

**`uiStore`** (Zustand) — UI-only state (not persisted):
```typescript
interface UIState {
  inspectorOpen: boolean;
  inspectorNodeId: string | null;
  sidebarCollapsed: boolean;
  activeModal: string | null;
  toasts: Toast[];
}
```

Server state (provider list, models, templates, run history, usage) is managed entirely through TanStack Query. SSE events invalidate or directly update the relevant TanStack Query cache entries for live run status and thumbnails.

### Canvas / Editor Implementation

**React Flow** is the canvas library (PRD §10), running in **controlled mode** with Zustand as the single source of truth. Configuration:

- `nodeTypes` registry maps Itera Studio node types to custom React components. Each model mode is a separate node type (e.g., `"flux-text-to-image"` and `"flux-image-to-image"` are distinct types with different port schemas). No conditional parameter logic.
- Additionally: `"comment"` node type for non-executable sticky-note annotations (resizable, draggable, color-taggable text boxes).
- Each `CustomNode` component renders: provider icon, model name, parameter summary, status badge (idle/running/awaiting_download/complete/error), and **live output thumbnail** (updated per-node via SSE during runs, using worker-generated preview images).
- Ports use custom `Handle` components styled by type: `image` (blue), `video` (purple), `text` (green), `number` (orange), `json` (gray). **Each input port accepts exactly one connection** — the canvas rejects a second edge targeting the same port. Nodes requiring multiple same-type inputs declare separate named ports (e.g., `image_a`, `image_b`) or explicit array ports.
- `onConnect` handler validates port type compatibility. If types are compatible but not identical (e.g., image with mismatched resolution), a **toast/popover suggests inserting a conversion node** (e.g., "Insert Resize Node?"). If accepted, an explicit resize node is auto-inserted with sensible defaults derived from the downstream model's requirements, marked as auto-generated but fully editable. No hidden runtime conversions.
- Canvas features: snap-to-grid (16px), minimap, zoom controls, **right-click context menus** (canvas: "Add Node" at cursor; node: Copy/Duplicate/Delete/Disconnect All; edge: Delete).
- Keyboard shortcuts via a **central shortcut registry** mapping action IDs (`node.delete`, `history.undo`, `clipboard.copy`, `clipboard.paste`, `canvas.pan`) to key combos. MVP ships with fixed defaults; the registry enables post-MVP customization.
- **Copy/paste**: Group copy with internal connections preserved. Selected nodes are duplicated with new UUIDs, offset by +20px/+20px. Internal edges between copied nodes preserved; external edges dropped. Parameters deep-cloned.
- **Drag performance**: During node drag, position updates are throttled/batched. Final positions commit to Zustand on `onNodeDragStop`, avoiding excessive re-renders. Undo records the complete position change, not intermediate frames.
- **Continuous validation**: Graph is validated on every edit (debounced). Missing required inputs show red outlines. Disconnected nodes show warning badges. Cycles are immediately prevented with a toast. Authoritative server-side validation runs on "Run" and blocks execution if errors remain.
- **Auto-save**: Debounced (1 second). On in-app navigation, pending changes flush immediately (awaited before route change). On tab close, uses `navigator.sendBeacon` for best-effort save. Lightweight browser `beforeunload` prompt only if the flush cannot be started. Save indicator in TopBar: saved/saving/error.
- **Node limits**: Warning at 50% of `MAX_NODES_PER_WORKFLOW` (default 100, configurable). Canvas prevents adding beyond the hard limit. Server also validates on save/run.

**Node Palette**: Sidebar panel with a **text filter** at the top. Nodes **grouped by provider** (e.g., "Replicate", "Fal AI", "Utility") — no deduplication. Each entry shows model name with provider in label (e.g., "Flux 1.1 Pro (Replicate)"). Drag-from-palette creates a node at the drop position with default parameters and correct port definitions.

**Node Parameter Editing**: Clicking a node opens the InspectorPanel on the right. The panel renders a dynamic form driven by the model's `NodeSchema` (fetched from the adapter, cached in DB). Field types: text input, number slider, dropdown, image upload (immediate upload to server, asset reference stored in params), toggle.

**Image uploads**: On drop/selection, images are immediately uploaded to `/data/assets/uploads/{workflowId}/` and the node stores a server-relative asset reference (`assetId` + path) with metadata (SHA-256 hash, MIME type, width/height, file size). Workflow export never embeds images. On import, unresolved asset references are flagged for re-upload.

### Inspector Panels

The inspector panel has three tabs:

1. **Config** — Edit node parameters. Driven by `NodeSchema` from the adapter. Shows model name, provider, and all configurable params.
2. **Run** — Visible during/after a run. Shows: input values sent, output preview (image viewer / native HTML5 `<video>` with playback speed selector and loop toggle), execution time, cost incurred. Debug payloads (raw request/response) accessible via an explicit "Show raw payload" action that loads JSON from disk files.
3. **Errors** — Visible when node status is `failed`. Shows mapped error message, sanitized provider error detail, retry count, and a "Retry This Node" button.

### History Views

- **RunList**: Table with columns: Run # (auto-increment), Status (badge), Started At, Duration, Total Cost, Output Thumbnail (first output/leaf node). Click a row to expand RunDetail inline. "Delete Run" action per row (removes record + assets). Pagination controls (20 per page).
- **RunDetail**: Full node-by-node breakdown. Each node shows status, timing, cost, and output thumbnail. "Show raw payload" link loads debug JSON from disk.

### Theming

MVP ships with a **single dark theme** using Tailwind design tokens via semantic CSS variables (`--bg-primary`, `--panel-bg`, `--accent`, etc.). This aligns with creative tool conventions and halves visual QA. Variables are structured so a light theme can be added post-MVP without refactoring.

### Onboarding

No multi-step wizard. Each page has **contextual empty states** with clear CTAs:
- Workflow list: "Create your first workflow or start from a template" with buttons.
- Provider page: "Connect a provider to get started" with setup steps.
- Templates used as the primary on-ramp for new users.

### Video Preview

Native HTML5 `<video>` element with standard controls (play/pause, seek, volume, fullscreen). Simple enhancements via HTML attributes: playback speed selector, loop toggle. Supports MP4/WebM. No external player library. Frame-by-frame tooling deferred post-MVP.

---

## 5. Workflow & DAG Engine

### Workflow JSON Schema

Workflows are stored as JSON in the `graph` column of the `workflows` table. The `workflows` table includes a `workflow_version` integer for optimistic concurrency — the backend rejects `PUT` requests with a stale version. Validated at save time and run time using a Zod schema from `packages/shared`.

```typescript
// packages/shared/src/workflowSchema.ts

const PortSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["image", "video", "text", "number", "json"]),
  direction: z.enum(["input", "output"]),
  isArray: z.boolean().optional(),  // Explicit array ports for multi-input
});

const NodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),                          // "flux-text-to-image", "flux-image-to-image", etc.
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    providerId: z.string().optional(),       // null for utility/comment nodes
    modelId: z.string().optional(),
    label: z.string(),
    params: z.record(z.unknown()),           // model-specific parameters (asset references, not blobs)
    retryCount: z.number().int().min(0).max(3).default(1),
    timeoutMs: z.number().int().min(10000).max(1800000).default(300000),
    isAutoGenerated: z.boolean().optional(), // true for auto-inserted conversion nodes
  }),
  inputs: z.array(PortSchema),
  outputs: z.array(PortSchema),
});

const EdgeSchema = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),                 // source node ID
  sourceHandle: z.string(),                  // source port ID
  target: z.string().uuid(),                 // target node ID
  targetHandle: z.string(),                  // target port ID
});

const WorkflowGraphSchema = z.object({
  version: z.literal(1),
  nodes: z.array(NodeSchema).max(100),       // Hard limit enforced (configurable via MAX_NODES_PER_WORKFLOW)
  edges: z.array(EdgeSchema),
});
```

### DAG Parsing

```typescript
// packages/engine/src/dag.ts

interface DAGNode {
  nodeId: string;
  dependencies: string[];   // node IDs this node depends on
  dependents: string[];      // node IDs that depend on this node
}

function parseDAG(graph: WorkflowGraph): Map<string, DAGNode> {
  // 1. Build adjacency list from edges
  // 2. Validate: no cycles (DFS-based cycle detection)
  // 3. Validate: all edge port types are compatible
  // 4. Validate: each input port has at most one incoming edge
  // 5. Validate: all required input ports are connected or have default values
  // 6. Validate: at least one executable leaf node exists (implicit or explicit Output)
  // 7. Skip comment nodes (non-executable)
  // 8. Return node map with dependency info
}

function topologicalSort(dag: Map<string, DAGNode>): string[][] {
  // Returns nodes grouped by execution tier (Kahn's algorithm)
  // Tier 0: nodes with no dependencies (can run immediately)
  // Tier 1: nodes whose dependencies are all in tier 0
  // etc.
  // Within a tier, nodes execute in parallel.
}
```

### Output Nodes

Output/Preview nodes are **optional**. If present, they designate "primary" results used for run history thumbnails and exports. If absent, all **leaf nodes** (nodes with no downstream connections) are treated as the run's results. The UI offers a one-click "Add Output Node" action to promote a leaf node to an explicit Output node.

### Scheduling Logic

The scheduler operates tier-by-tier:

1. Call `topologicalSort()` to get execution tiers.
2. Enqueue all tier-0 nodes as BullMQ jobs on the `predictions` queue.
3. When a node completes (all downloads finished), check: are all dependencies of any tier-N node now complete? If yes, enqueue that node.
4. This naturally handles parallel branches: independent branches run concurrently because they appear in the same or overlapping tiers.

The scheduler does **not** pre-enqueue all tiers. It enqueues nodes lazily as dependencies resolve. This is important for:
- Budget cap enforcement (check cumulative cost before enqueuing the next node)
- Resume from failure (only re-enqueue from the failed point)
- Live cost refinement (update remaining estimates with actual upstream metadata)

### Parallel Execution Model

- `predictions` queue concurrency is set to `MAX_CONCURRENT_NODES` (env var, default: 5). `downloads` queue concurrency is higher (default: 10, I/O-bound).
- Each node execution is a separate BullMQ job with a unique job ID: `run:{runId}:node:{nodeId}`.
- An **execution guard** ensures each `(runId, nodeId)` pair can only run once unless explicitly resumed.
- Independent branches within a single run execute as concurrent jobs.
- Cross-run parallelism: multiple workflow runs can execute simultaneously, limited by worker concurrency.
- All inter-node data passes as **file references** (disk paths + metadata). Downstream nodes read outputs from disk. No in-memory data passing.

### Cost Estimation

For nodes whose inputs depend on upstream outputs not yet known (e.g., image dimensions affect pricing), the estimator uses the model's default parameter values and marks the node as `uncertain` with a message. The UI shows per-node uncertainty badges and presents the total as a range (±) derived from known min/max bounds. During execution, estimates are refined with actual upstream metadata and the run status bar shows "actual-to-date + remaining estimated" cost.

### Resume Logic

```typescript
// packages/engine/src/resume.ts

async function resumeRun(runId: string): Promise<void> {
  // 1. Load the Run and all NodeExecution records
  // 2. Validate: run status must be "failed" or "partial_failure"
  // 3. Re-validate the workflow graph (may have been edited since last run)
  // 4. For each completed node: verify output assets still exist on disk
  // 5. Mark all "failed" node executions as "pending"
  // 6. Re-run the scheduler starting from the first pending node
  // 7. Completed nodes are skipped (their outputs are reused as inputs to downstream nodes)
}
```

### Edit During Run

The canvas remains fully editable while a run is in progress. The run executes against an **immutable graph snapshot** taken at run start. A persistent banner states: "Run in progress using a previous version. Current edits apply to the next run." The exact `workflow_version` hash used for each run is stored in the run record for reproducibility.

---

## 6. Provider Adapter Framework

### Adapter Lifecycle

1. **Registration** — On application startup, the adapter registry dynamically imports each adapter from `packages/adapters/src/`. The engine depends only on the `ProviderAdapter` interface — not on provider-specific code. This plugin-ready boundary enables post-MVP third-party adapters via a directory-based loading convention.
2. **Initialization** — Each adapter's constructor receives no arguments. Adapters are stateless — API keys are passed per-call, not stored on the adapter instance.
3. **Key Validation** — When a user saves an API key, the registry calls `adapter.validateKey(apiKey)`. The adapter makes a lightweight API call (e.g., list models) to verify the key.
4. **Model Discovery** — `adapter.listModels()` returns all models the adapter supports. Schemas are **fetched dynamically from the provider API at discovery time** (e.g., Replicate's model version schema endpoint), then **cached in the local DB** with a configurable TTL (default: 7 days). Hardcoded overrides are applied on top for: port type mapping (image/video/text/json), UI hints (labels, defaults, ranges, enums), and pricing metadata. A "Refresh Schema" action in the UI triggers a re-fetch. If the provider API is unreachable, the adapter falls back to **bundled baseline schemas** for the 3 MVP models per provider, ensuring the app works offline. Each model mode is a **separate node type** (e.g., "Flux Text-to-Image" vs "Flux Image-to-Image") with distinct port schemas — no conditional parameter logic.
5. **Execution** — During a run, the worker calls `adapter.runPrediction(params)` with the decrypted API key, model ID, and parameters. The adapter translates to the provider's API format and returns a prediction ID.
6. **Polling** — The worker calls `adapter.getPredictionStatus(predictionId)` using **adaptive polling**: 2s for the first 30s, 5s up to 2 minutes, then 10–15s with jitter to avoid thundering herds. Respects `Retry-After` headers on 429 responses. The interface includes optional `supportsWebhooks` and `registerWebhook()` methods for post-MVP webhook support.
7. **Shutdown** — No explicit shutdown. Adapters hold no connections or state.

### HTTP Client

All adapters use a **shared HTTP wrapper** built on Node.js 22 native `fetch`/`undici` that standardizes: configurable timeouts, retries with backoff + jitter, cancellation via `AbortController`, request/response logging with secret redaction, and consistent error mapping. Provider SDKs (e.g., `replicate` npm package) are used selectively only where they materially simplify complex flows (file uploads, schema discovery), and SDK calls are wrapped to emit the same standardized errors and logging.

### Registration System

```typescript
// packages/adapters/src/index.ts

class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  async loadAll(): Promise<void> {
    const replicateAdapter = await import("./replicate/adapter");
    const falAdapter = await import("./fal/adapter");
    const mockAdapter = await import("./mock/adapter");

    this.register(new replicateAdapter.ReplicateAdapter());
    this.register(new falAdapter.FalAdapter());
    if (process.env.NODE_ENV !== "production") {
      this.register(new mockAdapter.MockAdapter());
    }
  }

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Duplicate adapter ID: ${adapter.id}`);
    }
    // Runtime validation of adapter shape via Zod
    validateAdapterShape(adapter);
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter { /* ... */ }
  listAll(): ProviderAdapter[] { /* ... */ }
}

export const adapterRegistry = new AdapterRegistry();
```

### MVP Model List

- **Replicate**: Flux 1.1 Pro (image), SDXL (image), Minimax Video (video)
- **Fal AI**: Flux [schnell] (image), Kling v2 (video), AuraSR (super-resolution)

These 6 models cover all 5 built-in templates.

### Interface Enforcement

The `ProviderAdapter` interface (PRD §11) is defined in `packages/adapters/src/types.ts`. TypeScript enforces compile-time compliance. Runtime enforcement uses a `validateAdapterShape()` function called during registration that checks all required methods exist and return correct shapes (using Zod to validate return types from `listModels()` and `getModelSchema()`).

Each adapter declares a `schemaVersion: number`. The engine checks `adapter.schemaVersion` against `SUPPORTED_SCHEMA_VERSIONS` before execution. Mismatches throw a clear error.

### Pricing Metadata Handling

Per PRD §11 ("Hybrid: adapter defaults + user-editable overrides"):

1. Each adapter's `models.ts` exports pricing metadata per model as hardcoded baselines.
2. On `estimateCost()`, the adapter checks the database for user overrides first (`pricing_overrides` table). If none exist, it uses the baseline.
3. If neither exists, the estimate is returned with `{ isApproximate: true, warning: "No pricing data available for this model" }`.
4. Cost estimation never throws — it always returns a result (possibly with warnings).

### Testing Strategy

- **Unit tests**: Each adapter has unit tests using `msw` (Mock Service Worker) to validate request construction and response parsing.
- **Integration tests**: Gated behind `RUN_INTEGRATION_TESTS=true` env var. Call real provider APIs with a test key. Run nightly in CI.
- **Mock adapter**: Simulates a provider with configurable latency and failure modes. Used in all engine and worker tests.
- **Critical-path coverage**: Mandatory tests for adapter schema translation, request/response mapping, and cost estimation. ~60% backend coverage target, no strict CI gate.

---

## 7. Job Queue & Workers

### BullMQ Setup

Two separate queues with independent concurrency:

```typescript
// packages/worker/src/index.ts

import { Worker, Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

// Queue for provider API predictions
export const predictionsQueue = new Queue("predictions", {
  connection: { url: REDIS_URL },
  defaultJobOptions: {
    attempts: 1,          // Retries handled at engine level, not BullMQ level
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Queue for downloading output assets
export const downloadsQueue = new Queue("downloads", {
  connection: { url: REDIS_URL },
  defaultJobOptions: {
    attempts: 3,          // Downloads are safe to retry at BullMQ level
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Prediction worker — bounded by API rate considerations
const predictionWorker = new Worker("predictions", processPredictionJob, {
  connection: { url: REDIS_URL },
  concurrency: parseInt(process.env.MAX_CONCURRENT_NODES || "5"),
  limiter: { max: 10, duration: 1000 },
  stalledInterval: 0,   // Disable auto-retry of stalled jobs (prevents duplicate provider calls)
});

// Download worker — higher concurrency (I/O-bound)
const downloadWorker = new Worker("downloads", processDownloadJob, {
  connection: { url: REDIS_URL },
  concurrency: 10,
});
```

### Worker Process Model

The BullMQ worker runs as a **separate Node.js process** in the same Docker container, managed by an `entrypoint.sh` script:

```bash
#!/bin/sh
# Start Next.js (Process 1)
node apps/web/server.js &
NEXTJS_PID=$!

# Start BullMQ worker (Process 2)
node packages/worker/dist/index.js &
WORKER_PID=$!

# Wait for either to exit
wait -n $NEXTJS_PID $WORKER_PID
```

This isolates the worker's event loop from Next.js, preventing long-running downloads or sharp-based utility node processing from starving API route responsiveness. Docker Compose remains two services (app + redis).

### Two-Phase Job Model

Prediction execution and asset download are separate BullMQ jobs:

**Phase 1 — Prediction** (`processPredictionJob`):
```typescript
async function processPredictionJob(job: Job<PredictionJobData>): Promise<void> {
  const { runId, nodeId, providerId, modelId, params, apiKeyEncrypted } = job.data;

  // 1. Check execution guard: (runId, nodeId) must not have already run
  // 2. Update node status → "running"
  // 3. Decrypt API key
  // 4. If utility node: execute locally (sharp resize/crop/etc.), write output, mark complete, return
  // 5. Call adapter.runPrediction()
  // 6. Poll with adaptive intervals (2s → 5s → 10-15s + jitter)
  //    Respect Retry-After headers on 429
  // 7. On completion: mark node as "awaiting_download"
  // 8. Enqueue downloadAsset job(s) on downloads queue (one per output URL)
  // 9. Release prediction worker slot
}
```

**Phase 2 — Download** (`processDownloadJob`):
```typescript
async function processDownloadJob(job: Job<DownloadJobData>): Promise<void> {
  const { runId, nodeId, outputUrl, outputIndex } = job.data;

  // 1. Stream file to /data/assets/runs/{runId}/nodes/{nodeId}/output_{index}.partial
  // 2. Verify checksum/content-length if available
  // 3. Atomic rename: .partial → final filename
  // 4. Generate thumbnail:
  //    - Images: sharp resize to preview JPEG/WebP
  //    - Videos: use provider-supplied thumbnail URL if available, else styled placeholder icon
  // 5. Write debug payloads (request.json, response.json) with secrets redacted
  // 6. Update NodeExecution → "completed" with output paths, cost, metadata
  // 7. Emit SSE node:completed with thumbnail URL and cost
  // 8. Signal engine to check for newly unblocked downstream nodes
}
```

### Startup Reconciliation

On application startup, the engine performs a reconciliation pass:

1. Scan BullMQ for active/waiting/delayed jobs across both queues.
2. Cross-reference each job's `runId` and `nodeId` with SQLite run state.
3. For runs marked `completed`/`cancelled`/`failed`: cancel and remove associated jobs.
4. For runs marked `running`: re-enqueue only the next valid pending node jobs idempotently.
5. Mark orphaned jobs as failed with reason `orphaned_after_restart`.
6. The `(runId, nodeId)` execution guard prevents duplicate provider calls.

BullMQ's automatic stalled-job retry is **disabled** to prevent duplicate provider charges.

### Concurrency Model

- `predictions` queue: concurrency = `MAX_CONCURRENT_NODES` (default: 5). Rate limiter: 10 jobs/sec.
- `downloads` queue: concurrency = 10 (I/O-bound, not API-rate-limited).
- A flood of downloads does not block prediction slots (separate queues).
- For MVP, both workers run in a single process inside the app container. Post-MVP, workers can be scaled horizontally as separate containers.

### Failure Handling

1. **Transient errors** (HTTP 429, 500, 502, 503, 504, network timeout): the engine retries the node up to `retryCount` times (configured per node, default 1, max 3). Retries are **deterministic**: same parameters, same inputs. Delay uses exponential backoff (5s, 15s, 45s) with jitter. Respects `Retry-After` headers (waits at least that duration).
2. **Validation errors** (HTTP 400): no retry. Node is marked `failed` immediately.
3. **Timeout**: if adaptive polling exceeds the node's configured timeout, the prediction is cancelled via `adapter.cancelPrediction()` and the node is marked `failed`.
4. **Download failures**: BullMQ handles download retries (3 attempts with exponential backoff). Download writes to `.partial` file, so incomplete downloads don't corrupt state.
5. **Partial failure** (PRD §12): if one parallel branch fails, independent branches continue. The run is marked `partial_failure`.
6. **Budget exceeded**: before enqueuing each node, the engine checks cumulative actual cost against the budget cap. If exceeded:
   - **Hard-stop mode** (default): remaining nodes are cancelled, run marked `budget_exceeded`.
   - **Pause-and-prompt mode**: run is paused, SSE event sent to frontend, user must confirm to continue.

### Cancellation

```typescript
async function cancelRun(runId: string): Promise<void> {
  // 1. Mark run status → "cancelling"
  // 2. Get all "running" node executions for this run
  // 3. For each running node:
  //    a. Call adapter.cancelPrediction() for the in-flight prediction
  //    b. Remove any queued (but not started) BullMQ jobs on both queues
  //    c. Mark node execution → "cancelled"
  // 4. Mark all "pending" / "awaiting_download" node executions → "cancelled"
  // 5. Mark run status → "cancelled"
  // 6. Emit SSE event: { type: "run:cancelled" }
}
```

---

## 8. Storage & Persistence

### Database Schema

```sql
-- Core tables

CREATE TABLE workflows (
  id               TEXT PRIMARY KEY,          -- UUID
  name             TEXT NOT NULL,
  description      TEXT DEFAULT '',
  graph            TEXT NOT NULL,             -- JSON: WorkflowGraph
  workflow_version INTEGER NOT NULL DEFAULT 1, -- Optimistic concurrency token
  is_template      BOOLEAN DEFAULT FALSE,
  template_source  TEXT,                      -- 'builtin' | 'user' | NULL
  last_run_id      TEXT,                      -- Denormalized: last run UUID
  last_run_status  TEXT,                      -- Denormalized: last run terminal status
  last_run_at      TEXT,                      -- Denormalized: last run completion time
  created_at       TEXT NOT NULL,             -- ISO 8601
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT                       -- Soft delete (Trash)
);

CREATE TABLE runs (
  id             TEXT PRIMARY KEY,            -- UUID
  workflow_id    TEXT NOT NULL REFERENCES workflows(id),
  status         TEXT NOT NULL,               -- pending | running | completed | failed | partial_failure | cancelled | budget_exceeded
  graph_snapshot TEXT NOT NULL,               -- JSON: frozen copy of workflow graph at run time
  graph_version  INTEGER NOT NULL,            -- workflow_version at time of snapshot
  budget_cap     REAL,                        -- USD, NULL = no cap
  budget_mode    TEXT DEFAULT 'hard_stop',    -- hard_stop | pause_and_prompt
  total_cost     REAL DEFAULT 0,
  started_at     TEXT,
  completed_at   TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE node_executions (
  id             TEXT PRIMARY KEY,            -- UUID
  run_id         TEXT NOT NULL REFERENCES runs(id),
  node_id        TEXT NOT NULL,               -- Node ID from workflow graph
  status         TEXT NOT NULL,               -- pending | queued | running | awaiting_download | completed | failed | cancelled
  attempt        INTEGER DEFAULT 1,
  cost           REAL,
  started_at     TEXT,
  completed_at   TEXT,
  inputs         TEXT,                        -- JSON: resolved input file paths
  outputs        TEXT,                        -- JSON: output asset paths
  error          TEXT,                        -- Error message if failed
  provider_id    TEXT,                        -- Provider used for this execution
  model_id       TEXT,                        -- Model used
  debug_dir      TEXT,                        -- Relative path to request.json/response.json on disk
  created_at     TEXT NOT NULL
);

CREATE TABLE provider_configs (
  id                TEXT PRIMARY KEY,          -- Provider ID (e.g., "replicate")
  api_key_encrypted TEXT NOT NULL,             -- AES-256-GCM encrypted
  iv                TEXT NOT NULL,             -- Initialization vector (hex)
  auth_tag          TEXT NOT NULL,             -- GCM auth tag (hex)
  validated_at      TEXT,                      -- Last successful validation
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE model_schema_cache (
  id          TEXT PRIMARY KEY,               -- UUID
  provider_id TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  schema      TEXT NOT NULL,                  -- JSON: cached model schema from provider API
  fetched_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,                  -- TTL-based expiry (default: 7 days)
  UNIQUE(provider_id, model_id)
);

CREATE TABLE pricing_overrides (
  id          TEXT PRIMARY KEY,               -- UUID
  provider_id TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  pricing     TEXT NOT NULL,                  -- JSON: pricing metadata
  updated_at  TEXT NOT NULL,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                         -- JSON-encoded value
);

CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,                -- UUID
  action     TEXT NOT NULL,                   -- e.g., "api_key.added", "run.started"
  details    TEXT,                            -- JSON: action-specific metadata
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,                   -- bcrypt hash of session token
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Indexes

CREATE INDEX idx_runs_workflow_id ON runs(workflow_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_node_executions_run_id ON node_executions(run_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_workflows_deleted_at ON workflows(deleted_at);
CREATE INDEX idx_model_schema_cache_lookup ON model_schema_cache(provider_id, model_id);
```

Drizzle ORM schema in `packages/db/src/schema.ts` mirrors this SQL. Migrations are generated by Drizzle Kit and run automatically on startup **after a pre-migration backup** (see below).

### SQLite Configuration

- **WAL mode** enabled on DB connection for concurrent read performance.
- **Auto-checkpoint** (SQLite default) handles routine WAL management.
- **Safety checkpoint** (`PRAGMA wal_checkpoint(TRUNCATE)`) runs on graceful shutdown, after run completion, and on a 10–15 minute timer to prevent WAL growth in long-running deployments.

### Pre-Migration Backup

On startup, before applying any pending migrations:
1. Copy `agentstudio.db` to `agentstudio.db.bak.YYYYMMDD-HHMMSS`.
2. Retain only the 3 most recent backups; delete older ones.
3. Run migrations. If any migration fails, log a clear error and **exit without starting the app** (never run against a partially migrated schema).
4. A CLI helper (`scripts/restore-backup.ts`) lists available backups and restores a selected one.

### Asset Storage Layout

```
/data/
├── db/
│   ├── agentstudio.db                           # SQLite database (WAL mode)
│   ├── agentstudio.db-wal                       # WAL file
│   ├── agentstudio.db-shm                       # Shared memory
│   └── agentstudio.db.bak.20260210-143022       # Pre-migration backup
├── assets/
│   ├── runs/
│   │   └── {runId}/
│   │       └── nodes/
│   │           └── {nodeId}/
│   │               ├── output_001.png        # Generated images
│   │               ├── output_001.mp4        # Generated videos
│   │               ├── output_001_thumb.webp # Worker-generated thumbnail
│   │               ├── request.json          # Debug: sanitized API request (secrets redacted)
│   │               ├── response.json         # Debug: sanitized API response
│   │               └── metadata.json         # MIME type, dimensions, file size, hash
│   └── uploads/
│       └── {workflowId}/
│           └── {assetId}.png                 # User-uploaded input images
├── templates/
│   └── previews/                             # Template preview images
├── config/
│   ├── master.key                            # Auto-generated master encryption key (0600)
│   └── license.cache                         # Cached license validation state
└── backups/                                  # User-managed backup directory
```

- Assets are served to the frontend via `GET /api/assets/[...path]` which streams files from disk.
- The route validates that the requested runId exists before serving. No directory traversal (path components validated).
- Video files support HTTP Range requests for in-browser playback.
- Debug payloads (`request.json`, `response.json`) have secrets redacted before writing. Full raw provider responses are never stored with API keys or Authorization headers.

### Run History Storage

- **Graph snapshot**: Each run stores a frozen copy of the workflow graph and its `workflow_version` at run start. The canvas remains editable during runs; the snapshot is immutable.
- **Cost tracking**: `node_executions.cost` stores the actual cost reported by the provider (or estimated cost if the provider doesn't report actual). `runs.total_cost` is the sum, updated incrementally.
- **Output references**: `node_executions.outputs` stores relative paths to assets on disk, not binary data.
- **Denormalized workflow fields**: `last_run_id`, `last_run_status`, `last_run_at` on the `workflows` table are updated transactionally when a run reaches a terminal state. These power the workflow list view without joins. If ever inconsistent, a maintenance query can rebuild them.

### Soft Delete & Trash

Soft-deleted workflows (`deleted_at` set) appear in the Trash view. Users can:
- **Restore**: clears `deleted_at`, workflow returns to the main list.
- **Permanently delete**: removes the workflow record, all associated run records, and all assets from disk.

No automatic purge. Cleanup is user-initiated via the Trash view and the storage/purge tool.

### Storage Dashboard & Manual Purge

The `/usage` page includes a storage section showing:
- Total asset disk usage and per-workflow breakdown.
- A manual purge tool: filter by date range and/or keep-last-N runs, with a preview of what will be deleted and a confirmation step.
- Per-run "Delete Run" action removes the run record and all associated assets.

### Backup Strategy

- **SQLite**: Copy `/data/db/agentstudio.db` while the application is running (WAL mode ensures consistent reads). Recommended: `sqlite3 .backup`.
- **Assets**: Copy `/data/assets/` directory.
- **Full backup**: Copy the entire `/data/` mount.
- Documentation provides example cron jobs and rsync commands per PRD §14.

---

## 9. Security Architecture

### Encryption Flow

```
User enters API key in browser
        │
        ▼
POST /api/providers/:id { apiKey: "sk-..." }
        │
        ▼
API route receives plaintext key (over HTTPS)
        │
        ▼
┌───────────────────────────────────┐
│  packages/crypto/src/encrypt.ts   │
│                                   │
│  1. Load master key from memory   │
│  2. Derive encryption key via     │
│     PBKDF2(masterKey, salt,       │
│     100_000 iterations, SHA-256)  │
│  3. Generate random 12-byte IV    │
│  4. Encrypt with AES-256-GCM     │
│  5. Return { ciphertext, iv,      │
│     authTag }                     │
└───────────────┬───────────────────┘
                │
                ▼
Store in provider_configs table:
  api_key_encrypted = ciphertext (base64)
  iv = iv (hex)
  auth_tag = authTag (hex)
```

**Decryption** happens only in the worker process at the moment of API call execution. The decrypted key exists in memory only for the duration of the HTTP call to the provider.

### Key Storage

**Master key lifecycle**:

1. **First launch**: If `/data/config/master.key` does not exist and `MASTER_KEY` env var is not set, generate a 256-bit cryptographically random key using `crypto.randomBytes(32)` and write it to `/data/config/master.key` with permissions `0600`.
2. **Startup**: Load master key from `MASTER_KEY` env var (if set) or from `/data/config/master.key`.
3. **Memory**: Master key is held in a module-level variable. It is never logged, serialized to JSON, or included in error reports.

### Rotation Process

```typescript
// scripts/rotate-keys.ts
async function rotateKeys(oldMasterKey: Buffer, newMasterKey: Buffer): Promise<void> {
  // 1. Load all rows from provider_configs
  // 2. For each row: decrypt with old key, re-encrypt with new key, update row
  // 3. Write new master key to /data/config/master.key
  // 4. Log rotation event to audit_logs
}
```

Rotation is a CLI operation run while the app is stopped (or in maintenance mode).

### IP Allowlist

If the `ALLOWED_IPS` environment variable is set, the application-level middleware denies all requests from IPs not matching the allowlist. Supports CIDR notation (e.g., `192.168.1.0/24,10.0.0.0/8`). Applied before authentication. Recommended in documentation for internet-exposed deployments.

### Content Security Policy

Moderate CSP applied via response headers:

```
default-src 'self';
script-src 'self';
base-uri 'none';
frame-ancestors 'none';
object-src 'none';
form-action 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: https:;
media-src 'self' blob: https:;
connect-src 'self' https:;
```

External `https:` is allowed for `img-src` and `media-src` because provider-supplied thumbnail/poster URLs may reference CDNs. Generated assets are preferably served via the local `/api/assets/*` route. Strict CSP (no `unsafe-inline`, proxy all external media) is documented as a post-MVP hardening step.

### Logging

**Pino** for structured JSON logging across API routes, engine, and worker. Configuration:
- `LOG_LEVEL` env var controls verbosity (debug, info, warn, error).
- **Redaction** enabled: API keys, Authorization headers, and prompt contents (if configured) are never logged.
- **Child loggers** scoped by component (`api`, `engine`, `worker`, `adapter`) with `runId`/`nodeId` fields for end-to-end run correlation.

### Threat Model

| Threat | Attack Vector | Mitigation |
|--------|---------------|------------|
| **API key theft from DB** | Attacker gains read access to SQLite file | Keys encrypted with AES-256-GCM; master key stored separately |
| **API key theft from memory** | Attacker gains process memory access | Keys decrypted only momentarily during API calls; not cached |
| **Master key theft** | Attacker accesses `/data/config/master.key` | File permissions 0600; recommend encrypted filesystem; env var override for secrets managers |
| **Man-in-the-middle** | Attacker intercepts API key in transit | HTTPS enforced for all browser↔backend and backend↔provider communication |
| **Session hijacking** | Attacker steals session cookie | HTTP-only, Secure, SameSite=Strict cookie; JWT with expiry |
| **Brute-force login** | Attacker guesses access password | bcrypt (cost 12); rate limit (5 attempts/min); optional ALLOWED_IPS |
| **Unauthorized network access** | Attacker reaches exposed instance | Optional `ALLOWED_IPS` env var with CIDR support |
| **XSS** | Attacker injects script via user-controllable fields | React's default escaping; CSP (script-src 'self'); no `dangerouslySetInnerHTML` |
| **CSRF** | Attacker triggers state-changing requests | SameSite=Strict cookies; all mutations require POST/PUT/DELETE |
| **Dependency vulnerability** | Compromised npm package | `npm audit` in CI; Dependabot alerts; minimal dependencies |
| **Docker escape** | Attacker breaks out of container | `node:22-slim` base; non-root user in container; no privileged mode |

---

## 10. Deployment & CI/CD

### Docker Build Process

**Dockerfile** (multi-stage build, `node:22-slim` base for reliable native module support):

```dockerfile
# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/*/package.json packages/*/
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules
COPY . .
RUN pnpm turbo build

# Stage 3: Production image
FROM node:22-slim AS runner
WORKDIR /app
RUN groupadd -g 1001 aistudio && useradd -u 1001 -g aistudio aistudio
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
USER aistudio
EXPOSE 3000
ENV NODE_ENV=production
CMD ["./entrypoint.sh"]
```

**docker-compose.yml**:

```yaml
version: "3.8"
services:
  app:
    build: .
    image: aistudio/aistudio:latest
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - aistudio-data:/data
    environment:
      - REDIS_URL=redis://redis:6379
      - DATA_DIR=/data
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - MAX_CONCURRENT_NODES=${MAX_CONCURRENT_NODES:-5}
      - LICENSE_KEY=${LICENSE_KEY}
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

volumes:
  aistudio-data:
  redis-data:
```

### Multi-Arch Setup

Per PRD §14: multi-arch (x86_64 + ARM64) from MVP.

- CI uses `docker buildx` with QEMU emulation to produce multi-platform images.
- Build command: `docker buildx build --platform linux/amd64,linux/arm64 -t aistudio/aistudio:latest --push .`
- `node:22-slim` (Debian/glibc) supports both architectures. Native modules (`sharp`) work reliably on both platforms without musl workarounds.

### Environment Configuration

**Infrastructure settings** (`.env` file, require restart):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Application port |
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL |
| `DATA_DIR` | `/data` | Base directory for DB, assets, config |
| `MASTER_KEY` | *(auto-generated)* | 256-bit hex-encoded master encryption key |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LICENSE_KEY` | *(required)* | Ed25519-signed license token |
| `ALLOWED_IPS` | *(unset = allow all)* | CIDR allowlist (e.g., `192.168.1.0/24,10.0.0.1`) |
| `TRUST_PROXY` | `false` | Trust X-Forwarded-For headers (set `true` behind reverse proxy) |

**Application settings** (Settings UI, persisted in DB): default budget cap, budget mode, confirmation dialog preferences, `MAX_NODES_PER_WORKFLOW`, `MAX_CONCURRENT_NODES`, trash behavior.

### Database Migrations

Migrations run automatically on startup after a pre-migration backup. If a migration fails, the application logs a clear error and exits. The user can restore from backup using the CLI helper (`scripts/restore-backup.ts`). See §8 for details.

### Release Workflow (GitHub Actions)

```
Push tag (v1.0.0)
  │
  ├─► Run tests (unit + lint + typecheck)
  ├─► Build multi-arch Docker image (node:22-slim)
  ├─► Push to Docker Hub + GitHub Container Registry
  ├─► Generate changelog from conventional commits
  └─► Create GitHub Release with changelog
```

- **Branches**: `main` (stable), `develop` (integration), feature branches.
- **PR checks**: TypeScript compilation, ESLint, unit tests, `npm audit`. Turborepo cache between runs.
- **Release**: Tag-triggered. Semantic versioning. Docker image tagged with version + `latest`.

---

## 11. Licensing Enforcement

### Ed25519 Offline License Tokens

MVP uses **offline license validation** with asymmetric cryptography. No remote license server is required.

**License token structure** (signed with Ed25519):
```json
{
  "license_id": "lic_abc123",
  "tier": "personal",
  "issued_at": "2026-01-15T00:00:00Z",
  "update_expiry": "2028-01-15T00:00:00Z",
  "machine_binding": "sha256:a1b2c3...",
  "max_users": 1,
  "features": ["all"],
  "signature": "ed25519:..."
}
```

The Ed25519 **private signing key** never ships with the application. Only the **public verification key** is embedded in the application binary.

### License Validation Flow

```
Application startup
       │
       ▼
Read LICENSE_KEY env var
       │
       ▼
Verify Ed25519 signature using embedded public key
       │
       ├── Signature invalid ──► Show license error page, block app
       │
       └── Signature valid
              │
              ▼
       Check fields:
       ├── update_expiry: controls access to this version's features
       ├── machine_binding: compare against computed machine fingerprint
       ├── tier: determine feature set
       │
       ├── All checks pass ──► Boot normally
       │                       Write validated state to /data/config/license.cache
       │
       ├── Machine mismatch ──► Show error: "License bound to different machine"
       │
       └── Update expired but signature valid ──►
              App continues to work (perpetual license).
              Features locked to the version available at update_expiry.
              Banner: "Update access expired. Renew for new features."
```

### Machine Fingerprint

`machineHash` = SHA-256 of `hostname + primary MAC address + DATA_DIR path` (salted). Stable across restarts. Configurable for container environments where MAC/hostname may change (override via `MACHINE_ID` env var).

### Token Issuance

A CLI script (`scripts/issue-license.ts`) generates and signs license tokens. The Ed25519 private key is provided at runtime via environment variable or loaded from a secure location. The same signing logic can be reused by a future automated issuance system (e.g., payment webhook integration).

### Downgrade Prevention

The app stores the highest valid license state locally (`/data/config/license.cache`). If a lower-tier or older token is provided, the app rejects it to prevent downgrade attacks.

### Failure Modes

| Scenario | Behavior |
|----------|----------|
| Invalid/missing license key | App shows license error page with link to purchase |
| Signature verification fails | App blocked. Fail closed. |
| Machine fingerprint mismatch | Error: "License bound to different machine." User instructed to contact support. |
| Update expiry passed, signature valid | App boots normally. Perpetual use. New features locked. Banner shown. |
| Token tier insufficient (e.g., Personal key with >1 user post-MVP) | App boots with feature restrictions |

### Forward Compatibility

The token format is designed so a future online license server can issue these same Ed25519-signed tokens without breaking the client-side validation logic. Migration to server-based issuance requires only adding an HTTP endpoint that returns signed tokens.

---

## 12. Performance & Scaling

### Bottlenecks

| Component | Bottleneck | MVP Limit | Symptom |
|-----------|-----------|-----------|---------|
| **SQLite** | Single-writer lock (WAL mode) | ~50 writes/sec | Slow run logging under heavy parallel execution |
| **BullMQ/Redis** | Memory (job data) | ~10,000 pending jobs | Redis OOM |
| **Prediction worker** | Concurrency + provider rate limits | 5 concurrent nodes (configurable) | Nodes queued waiting for slot |
| **Download worker** | Disk I/O + bandwidth | 10 concurrent downloads | Download queue backlog |
| **Asset storage** | Disk space | Limited by mounted volume | Disk full |
| **SSE connections** | Open HTTP connections | ~50 concurrent streams | Memory pressure on Next.js |
| **Next.js API routes** | Single-process event loop | ~200 req/sec for simple reads | API latency spikes (mitigated by separate worker process) |

### Limits (MVP Configuration)

| Resource | Soft Limit | Hard Limit | Configurable |
|----------|-----------|------------|--------------|
| Nodes per workflow | 50% of hard limit (warning) | 100 (validation error) | `MAX_NODES_PER_WORKFLOW` env/settings |
| Concurrent prediction jobs | 5 (default) | 20 | `MAX_CONCURRENT_NODES` env/settings |
| Concurrent download jobs | 10 (default) | 20 | Environment variable |
| Max node timeout | 30 minutes | 30 minutes | Per-node config |
| Max asset file size | 500 MB | 2 GB | Configurable |
| Run history retention | Unlimited | Disk space | Manual purge via UI |

### Upgrade Path (Post-MVP)

1. **SQLite → PostgreSQL**: Replace Drizzle SQLite driver with PostgreSQL driver. Schema is the same. Unlocks concurrent writes, better query performance, and connection pooling.
2. **Single worker → multiple workers**: Run worker processes as separate containers. BullMQ natively supports multiple competing consumers on both queues.
3. **Local storage → S3**: Add an S3-compatible storage adapter (MinIO for self-hosted, AWS S3 for cloud). Asset paths become URIs instead of filesystem paths.
4. **Single Next.js process → API + Frontend split**: Extract `packages/engine` + `packages/worker` + API routes into a standalone Fastify service. Frontend becomes a static Next.js export hitting the API.
5. **Redis cluster**: If job queue becomes a bottleneck, replace single Redis with Redis Cluster.

---

## 13. MVP Build Roadmap

### 30-Day Plan

#### Week 1: Foundation (Days 1–7)

**Milestone**: Monorepo scaffolded, DB schema running (WAL mode, auto-backup), basic UI shell (dark theme, shadcn/ui) with controlled React Flow canvas.

| Day | Deliverable |
|-----|-------------|
| 1–2 | Initialize monorepo (pnpm workspaces, Turborepo, tsconfig). Scaffold Next.js app with App Router (standalone output). Set up ESLint, Prettier, Husky. Install shadcn/ui. |
| 3 | Implement `packages/db`: Drizzle schema for all tables (including `workflow_version`, denormalized `last_run_*`, `model_schema_cache`), WAL mode, pre-migration backup system, auto-migrate on startup. |
| 4 | Implement `packages/crypto`: AES-256-GCM encrypt/decrypt, master key generation/loading, PBKDF2 key derivation, Ed25519 license verification. Unit tests. |
| 5 | Build UI shell: Layout (dark theme, semantic CSS vars), Sidebar, TopBar, routing for all pages. `/` redirects to `/workflows`. Contextual empty states. Responsive non-canvas pages. |
| 6 | Integrate React Flow (controlled mode): WorkflowCanvas, CustomNode, CommentNode, NodePort (color-coded), snap-to-grid, minimap, pan/zoom, context menus. Central shortcut registry. Node limit enforcement (client-side). |
| 7 | Workflow CRUD API: `POST/GET/PUT/DELETE /api/workflows` with `workflow_version` optimistic concurrency. Auto-save (1s debounce + flush on navigation). Shared Zod schemas + `validateForUI()`. |

#### Week 2: Adapters & Provider System (Days 8–14)

**Milestone**: Replicate and Fal AI adapters working (6 models, dynamic schema fetch + cache), API keys encrypted and stored, node palette populated with text filter.

| Day | Deliverable |
|-----|-------------|
| 8 | Implement `packages/adapters`: `ProviderAdapter` interface (plugin-ready boundary), `AdapterRegistry`, shared HTTP client wrapper (fetch, retries, redaction), mock adapter. |
| 9 | Replicate adapter: All interface methods. 3 models: Flux 1.1 Pro, SDXL, Minimax Video (separate node types per mode). Dynamic schema fetch + DB cache + hardcoded overrides + bundled baselines. |
| 10 | Fal AI adapter: Same structure. 3 models: Flux schnell, Kling v2, AuraSR. Dynamic schema fetch + cache. |
| 11 | Provider API routes: Save/delete/validate keys, list models (from cache), refresh schemas. Provider settings page with ProviderCard, ApiKeyForm. |
| 12 | Node palette sidebar: Text filter, grouped by provider (no dedup). Drag-to-canvas creates node with correct ports. Continuous graph validation (client-side). |
| 13 | InspectorPanel: Config tab — dynamic form from NodeSchema. Image upload (immediate upload to server, asset reference in params). |
| 14 | Adapter unit tests (MSW) + mock adapter integration tests. Cost estimation for both adapters (with uncertainty flags for dynamic inputs). |

#### Week 3: Execution Engine (Days 15–21)

**Milestone**: Full end-to-end workflow execution with two-phase jobs, adaptive polling, live thumbnails, cost estimation, error handling, and startup reconciliation.

| Day | Deliverable |
|-----|-------------|
| 15 | Implement `packages/engine`: DAG parser, cycle detection, topological sort, tier-based scheduling, one-connection-per-port validation, execution guard. Unit tests. |
| 16 | Implement `packages/worker`: Two-phase job model — prediction runner + download runner. Adaptive polling (2s→5s→10-15s + jitter). Asset write (.partial → rename). Thumbnail generation. Pino logging with correlation IDs. |
| 17 | Docker Compose + `entrypoint.sh` (two processes). Wire engine → BullMQ → worker. Startup reconciliation of stale jobs. Test single-node execution end-to-end. |
| 18 | SSE streaming endpoint. Frontend `useSSE` hook. Live per-node thumbnails on canvas. Run status bar. Auto-reconnect. Run banner ("editing previous version"). |
| 19 | Multi-node execution tests. Verify sequential + parallel + diamond topologies. Verify disk-based output passing between nodes. |
| 20 | Error handling: Retry (exponential backoff + jitter + Retry-After). Timeout. Partial failure. Resume from failure. |
| 21 | Budget caps: Pre-run cost estimation API (with uncertainty flags + live refinement). Run confirmation dialog (always-show + per-workflow skip toggle). Hard-stop and pause-and-prompt modes. |

#### Week 4: Polish, Templates, & Deployment (Days 22–30)

**Milestone**: Shippable MVP with templates, history, utility nodes, auth, licensing, Docker image, and documentation.

| Day | Deliverable |
|-----|-------------|
| 22 | Run history: List runs per workflow. RunDetail with node-by-node breakdown. Output thumbnails. "Delete Run" action. Debug payloads via "Show raw." |
| 23 | Utility nodes: Resize, crop, format conversion (sharp). Basic compositing. Prompt template. Register as node types. |
| 24 | Templates: Create 5 built-in templates. Template gallery UI. "New from template" flow. "Save as template" flow. Provider compatibility check with substitution dialog. |
| 25 | Workflow export/import: Download JSON (strips keys/assets). Import with non-blocking compatibility resolution panel (missing providers, unresolved assets). |
| 26 | Trash view (restore/permanent delete). Workflow list: search, sort, filter. |
| 27 | Auth: Access password setup, login page, session cookie, route protection, ALLOWED_IPS middleware. Ed25519 license validation + `issue-license.ts` CLI. |
| 28 | Dockerfile (`node:22-slim`, multi-stage, entrypoint.sh), docker-compose.yml, .env.example. Test full deployment. Multi-arch build pipeline. |
| 29 | Audit logging. CSP headers. CI pipeline (PR checks). Documentation (deployment, reverse proxy, adapter development). |
| 30 | Playwright smoke tests (3–5 core flows). Final manual smoke test on clean machine. |

### Scope Buffer

If the timeline slips, features are cut in this priority order (all return in the first post-MVP sprint):
1. **First cut**: Run comparison view (side-by-side diff of two runs)
2. **Second cut**: Cost/storage dashboard and purge tool

Utility nodes are **protected** — they are essential to end-to-end pipeline usability.

### Summary Milestones

| Milestone | Target | Criteria |
|-----------|--------|----------|
| **M1: Foundation** | Day 7 | Controlled canvas renders, workflows save/load with optimistic concurrency, DB operational (WAL, backup) |
| **M2: Provider Integration** | Day 14 | Both adapters working (6 models, dynamic schema), keys encrypted, palette with filter populated |
| **M3: Execution** | Day 21 | Full workflow runs end-to-end with two-phase jobs, live thumbnails, cost, error handling |
| **M4: MVP Ship** | Day 30 | Templates, history, utility nodes, export/import, auth, licensing, Docker image, docs |

---

## 14. Development Risks

### Technical Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **React Flow performance with 50+ nodes** | Medium | Medium | Profile early. Controlled mode with drag-batching. Node-level memoization for live thumbnails. Configurable hard limit (default 100). |
| **SSE reliability over long-running runs** | Medium | High | Automatic reconnection with last-event-ID. Store events in memory for catch-up. Falls back gracefully — user can refresh. |
| **Provider API instability / undocumented behavior** | High | Medium | Shared HTTP wrapper with consistent error mapping. Bundled baseline schemas for offline fallback. Integration tests catch regressions. |
| **SQLite write contention during parallel execution** | Low | Medium | WAL mode + safety checkpoints. Batch DB writes where possible. Acceptable for MVP scale. PostgreSQL upgrade path ready. |
| **BullMQ job loss on Redis crash** | Medium | Low | Redis persistence (AOF). Startup reconciliation rebuilds job state from SQLite (source of truth). |
| **Two-phase job coordination complexity** | Medium | Medium | Clear state machine (pending → running → awaiting_download → completed). Execution guard prevents duplicates. Download failures retry independently. |
| **Undo/redo complexity with coalesced parameter edits** | Low | Medium | Immer patches — well-tested pattern. Drag positions commit on dragStop only. Coalescing window is a simple 500ms timer. |
| **Master key management complexity for non-technical users** | Medium | Medium | Auto-generate on first launch — zero config needed. Document backup procedures. Key rotation is a manual CLI script. |
| **Docker image size** | Low | Low | Multi-stage build strips dev dependencies. `node:22-slim` base (~80MB). Target < 250 MB final image. |
| **Dynamic schema fetching from providers** | Medium | Medium | Bundled baseline schemas ensure offline operation. DB cache with configurable TTL. Manual "Refresh" action. Hardcoded overrides for port types/pricing. |

### External Dependencies

| Dependency | Risk | Mitigation |
|------------|------|------------|
| **React Flow** | Maintained OSS project; API could change | Pin major version. Wrap in abstraction layer (`WorkflowCanvas`). Controlled mode keeps state external. |
| **Drizzle ORM** | Newer ORM; less battle-tested than Prisma | Chosen for SQLite support quality and lightweight bundle. Knex as fallback if Drizzle has critical bugs. |
| **BullMQ** | Mature, widely used | Low risk. Redis is the only external dependency it adds. |
| **sharp** | Native module; build issues possible | `node:22-slim` (Debian/glibc) ensures reliable builds on both x86_64 and ARM64. |
| **Replicate API** | Third-party API; rate limits, breaking changes | Shared HTTP wrapper. Bundled baseline schemas. Integration tests. |
| **Fal AI API** | Third-party API; newer/less stable than Replicate | Same mitigations as Replicate. Mock adapter allows development without Fal access. |
| **Next.js** | Major framework; frequent releases | Pin version. App Router is stable as of Next.js 14+. Standalone mode for production. Avoid experimental features. |
| **TanStack Query** | Mature, widely adopted | Low risk. Handles server state caching, reducing custom code. |
| **shadcn/ui** | In-repo components (no npm dep) | Zero runtime dependency risk. Components are fully owned. |
| **Pino** | Standard Node.js logger | Mature, low risk. One small dependency. |

### Test Strategy

- **Critical-path unit/integration tests**: DAG parsing/scheduling/cycle detection, resume/retry state machine, AES-256-GCM encryption round-trips and key rotation, Ed25519 license verification, adapter schema translation and request/response mapping (MSW mocks).
- **3–5 Playwright E2E smoke tests**: Create workflow, add node, connect, run, view results/history.
- **~60% backend/core package coverage**. No strict CI coverage gate for MVP.
- **Mandatory tests**: Any code touching billing/spend control, secrets, licensing, or run-state correctness.

### Mitigation Summary

- **Provider risk**: Mock adapter enables full development and testing without live provider access. Two providers from day one means no single-provider dependency. Bundled baseline schemas work offline.
- **Performance risk**: Profile with realistic workloads by week 3. Separate worker process prevents API latency from execution load. React Flow controlled mode + drag batching keeps canvas responsive.
- **Security risk**: Use Node.js built-in `crypto` module (no third-party crypto). Ed25519 for licensing. AES-256-GCM for secrets. OWASP guidelines. CSP headers. Pino redaction.
- **Scope risk**: Run comparison and cost/storage dashboard are the designated scope buffer. Utility nodes are protected as core.

---

## Appendix A — Architecture Interview Decisions (v1)

| # | Section | Topic | Decision |
|---|---------|-------|----------|
| 1 | §7 | Worker model | Separate process, same container |
| 2 | §5/8 | Asset passing | Disk-first, file references |
| 3 | §3/9 | Auth hardening | Password + optional ALLOWED_IPS (CIDR) |
| 4 | §6 | Schema source | Dynamic fetch + cache + overrides + offline baseline |
| 5 | §4/8 | Image upload | Immediate upload, asset references in graph |
| 6 | §7/10 | Stale jobs | Reconcile on startup with execution guard |
| 7 | §4/9 | Auto-convert | Suggest + user inserts explicit node |
| 8 | §11 | Licensing | Ed25519 signed offline tokens |
| 9 | §2 | Build tool | Turborepo + pnpm |
| 10 | §8/12 | Asset cleanup | Storage dashboard + manual purge |
| 11 | §5/8 | Graph storage | Single JSON column + optimistic concurrency |
| 12 | §6/7 | Polling | Adaptive intervals + jitter |
| 13 | §4 | UI components | shadcn/ui |
| 14 | §5 | Output nodes | Optional, leaf nodes as fallback |
| 15 | §9/10 | Logging | Pino with redaction + correlation IDs |
| 16 | §4 | Copy/paste | Group copy, internal edges preserved |
| 17 | §8 | Debug payloads | On disk, reference in DB, redacted |
| 18 | §13 | Scope buffer | Cut comparison first, then dashboard |
| 19 | §5 | Input merging | One connection per port, explicit multi-input |
| 20 | §10 | Migrations | Auto-migrate with backup, fail-and-exit |
| 21 | §4 | Landing page | Redirect / to /workflows |
| 22 | §6 | Model list | 6 models across 2 providers |
| 23 | §3/4 | Run confirmation | Always-show dialog + per-workflow skip toggle |
| 24 | §4 | Video preview | Native HTML5 `<video>` |
| 25 | §3/10 | API server | Next.js standalone mode |
| 26 | §4 | Canvas extras | Sticky-note Comment nodes |
| 27 | §3/9 | Error surfacing | Mapped codes + sanitized provider detail |
| 28 | §4/5 | Validation UX | Continuous + run-time |
| 29 | §6/7 | Asset download | Two-phase: prediction + download jobs |
| 30 | §10/14 | Test strategy | Critical-path + thin E2E |
| 31 | §4 | Live thumbnails | Per-node via SSE, worker-generated previews |
| 32 | §7/8 | Video thumbnails | Provider-sourced + fallback icon |
| 33 | §3/5 | Dynamic cost | Defaults + uncertainty flags + live refinement |
| 34 | §2/6 | Adapter packaging | Single package, plugin-ready interface |
| 35 | §4 | Model dedup | Group by provider, show all |
| 36 | §5/12 | Node limits | Both client+server, configurable env var |
| 37 | §3/8 | Soft delete | Trash view + explicit permanent delete |
| 38 | §11 | Token issuance | CLI script in repo |
| 39 | §4 | Responsiveness | Non-canvas responsive, canvas desktop-only |
| 40 | §5/7 | Edit during run | Allow edits, run uses immutable snapshot |
| 41 | §4 | Theming | Dark theme only, semantic CSS vars |
| 42 | §4 | Shortcuts | Hardcoded with abstraction layer |
| 43 | §3/4 | Zod sharing | Shared schemas + validateForUI wrapper |
| 44 | §6/7 | HTTP client | Shared fetch wrapper + selective SDK use |
| 45 | §4 | Data fetching | TanStack Query + Zustand |
| 46 | §4 | Onboarding | Contextual empty states + template nudge |
| 47 | §5/7 | Retry behavior | Same params + respect Retry-After + jitter |
| 48 | §3/4 | Import compat | Always import, non-blocking resolution panel |
| 49 | §8/10 | SQLite mode | WAL + auto-checkpoint + safety checkpoint hook |
| 50 | §4 | React Flow mode | Controlled + drag-performance batching |
| 51 | §3/10 | Config split | Env for infra, UI for app settings |
| 52 | §4 | Unsaved changes | Flush save on navigation + sendBeacon fallback |
| 53 | §9/10 | CSP policy | Moderate CSP, no inline scripts, external media |
| 54 | §5/6 | Conditional params | Separate node types per mode |
| 55 | §4 | Context menu | Yes — canvas, node, and edge context menus |
| 56 | §8 | List query | Denormalized last_run columns on workflows |
| 57 | §4 | Node search | Palette text filter only |
| 58 | §10 | Base image | node:22-slim (Debian/glibc) |
| 59 | §4 | Workflow org | Flat list + search/sort/filter |
| 60 | §7 | Queue topology | Separate predictions + downloads queues |
