# AI Studio — Build Status

**Current phase:** V1 complete — production-ready release candidate

---

## Completed Milestones

### Foundation
- [x] Turborepo + pnpm monorepo (`apps/web`, `packages/{shared,db,engine,worker,adapters,crypto}`)
- [x] Drizzle SQLite schema with migrations (`/data` volume persistence)
- [x] BullMQ + Redis two-phase job pipeline (prediction → download)
- [x] SSE run events (`/api/workflows/:id/runs/:runId/events`)
- [x] Health check endpoint (`/api/health`)

### Node Platform
- [x] `NodeDefinition` / `NodeRegistry` — schema-driven node type system
- [x] `CandidateItem` / `CandidateCollection` contract for multi-candidate flows
- [x] `buildExecutionGraph()` + `RunCoordinator` — graph-driven execution
- [x] Local executors: Sharp image transforms, clip scoring, ranking, social formatter, export bundle
- [x] Provider executors: Fal.ai and Replicate via `GeneratorAdapter`
- [x] Best-of-N generation with configurable N, scoring, and selection

### Workflow Canvas
- [x] React Flow canvas with drag-and-drop, minimap, and port-typed connections
- [x] Node palette with search and category filtering
- [x] Template picker, save-as-template, template gallery
- [x] Slash-command quick-insert (`/`)
- [x] Undo/redo (history stack in Zustand store)
- [x] Inline workflow rename
- [x] Workflow fragments — save/browse/insert reusable subgraphs
- [x] Revision checkpoints — named save points per workflow
- [x] Workflow import/export (JSON)
- [x] Workflow duplication and trash

### Inspector & Model Picker
- [x] Schema-driven inspector panel (`NodeDefinition.params` → UI)
- [x] Per-provider model picker aligned to `config/models.ts`
- [x] Estimated cost hint per model
- [x] Provider key status warning in picker (amber badge when key missing)
- [x] `defaultParams` applied automatically on model/provider change

### Execution & Debugger
- [x] Live run status dots on canvas nodes (SSE-driven)
- [x] Run debugger panel (nodes tab + outputs tab)
- [x] Execution-path edge styling (active blue, completed green)
- [x] Per-workflow budget cap with pre-run cost estimate + warning modal
- [x] Budget settings panel with run cost history sparkline
- [x] Auto-Run mode (debounced re-run on param edit, 800 ms)
- [x] Workflow health strip (running, queued, pending, stale, failed chips)
- [x] Run history page + output inspection
- [x] Replay mode (restore graph to any past run's state)

### Video Editor
- [x] Editor shell at `/editor/[id]` with scene list, inspector, preview player
- [x] `EditorProject` persistence model and CRUD API
- [x] Scene-level duration and voiceover text fields
- [x] Voiceover synthesis via fal-ai/kokoro (`POST /api/editor-projects/[id]/voiceover`)
- [x] Export pipeline: `ExportJob` table, BullMQ export worker, real ffmpeg renderer
- [x] Export status panel with polling, live state labels, keyboard shortcuts (`⌘E`, `Esc`)
- [x] Accessibility: ARIA live region announces every export state transition

### Scheduling
- [x] `/api/workflows/:id/schedule` — GET / POST / DELETE
- [x] Schedule panel in canvas toolbar: presets + custom cron + pause/resume/delete
- [x] Active-schedule indicator on Schedule button (violet dot)
- [x] Cron runner in worker process (minute-boundary aligned, fire-and-forget dispatch)
- [x] `SCHEDULER_BUDGET_CAP` env var respected on each triggered run

### Provider Management
- [x] AES-256 encrypted API key storage in SQLite (`@aistudio/crypto`)
- [x] Add/edit/delete providers at `/settings/providers`
- [x] Inline key validation (`POST /api/providers/:id/validate`)
- [x] Multi-provider support: Fal.ai, Replicate (extensible)

### Docker & Deployment
- [x] Multi-stage Dockerfile (deps → builder → runner, ~slim Node 22)
- [x] ffmpeg in runner image for video export
- [x] All workspace package dist files copied to runner stage
- [x] `entrypoint.sh` starts Next.js + worker; `wait -n` exits container on first process failure
- [x] `docker-compose.yml` with `app`, `worker`, and `redis` services + healthchecks
- [x] `API_BASE_URL` wired in compose worker service for scheduler

---

## Known Gaps (V1.1 targets)

- [ ] Playwright E2E test suite (CI runs typecheck + unit tests only today)
- [ ] Scheduled workflows audit page (list all workflows with active schedules)
- [ ] Real CLIP API integration (scoring is stubbed behind `ENABLE_SCORING=false`)
- [ ] Scene transition effects in video editor
- [ ] Video generation node (Kling, Runway, etc.)
- [ ] Worker health endpoint / queue depth monitoring
- [ ] Per-run artifact browser (currently accessible via run history outputs tab)

---

## System Health

- TypeScript: clean (one pre-existing test stub error in `artifactServing.integration.test.ts`)
- Unit tests: passing (`packages/engine`, `packages/worker`, `apps/web` — hooks + components)
- Docker build: all three stages verified; ffmpeg and all workspace dists present in runner
