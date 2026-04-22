# AI Studio

A self-hosted visual workflow automation platform for building, running, and scheduling multi-step AI image and video pipelines. Drag-and-drop React Flow canvas, real-time execution, BullMQ workers, and a built-in video editor — all in one Docker container.

## Quick start

```bash
cp .env.example .env
# Add at least one provider API key (see "Providers" below)
docker compose up --build
```

Open **http://localhost:3001**.

---

## Features

### Workflow Canvas
- Drag-and-drop node editor built on React Flow
- Node palette with search, preset chains, and slash-command (`/`) quick-insert
- Undo/redo, inline workflow rename, save/load graph state
- Per-workflow run history, revision checkpoints, and named fragments (reusable subgraphs)
- Workflow import/export as JSON

### Execution Engine
- Runs execute as a graph — each node dispatches a BullMQ job, results flow downstream
- Live SSE updates: per-node status dots animate during runs
- Auto-Run mode: debounced re-run on parameter edits
- Per-workflow budget cap with pre-run cost estimate and warning modal
- Run debugger panel: live node states, per-node output inspection, execution replay

### Nodes (V1)
| Node | Description |
|------|-------------|
| Image Input | Load an image from disk, URL, or artifact store |
| Image Generate | Generate images via Fal.ai or Replicate (Best-of-N support) |
| Image Transform | Sharp-based local transforms (resize, crop, format convert) |
| Clip Scoring | Score candidates against a text prompt using CLIP |
| Ranking | Sort and select from a candidate collection |
| Social Format | Resize and format images for social media specs |
| Export Bundle | Package run artifacts as a downloadable ZIP |

### Video Editor
- Scene-based video timeline at `/editor/[id]`
- Scene Inspector: set per-scene image, duration, voiceover text
- Voiceover synthesis via fal-ai/kokoro TTS (POST /api/editor-projects/[id]/voiceover)
- Export to MP4 via ffmpeg — full render pipeline with polling and live status

### Scheduling
- Per-workflow cron schedules stored in the settings table
- Schedule panel in the canvas toolbar: preset frequencies or custom 5-field cron expression
- Pause/resume/delete without losing the expression
- Worker process polls schedules every minute and triggers runs via the API

### Provider Management
- Encrypted API key storage (AES-256, master key in DATA_DIR)
- Add/edit/delete providers at Settings → Providers
- Inline key validation before saving
- Provider key status shown in the model picker inspector

---

## Providers

Add at least one image generation provider to run workflows. Go to **Settings → Providers** after starting the app, or set keys directly in `.env`:

| Provider | Environment variable |
|----------|---------------------|
| Fal.ai | `FAL_API_KEY` |
| Replicate | `REPLICATE_API_KEY` |

---

## Documentation

- [Local Development](docs/LOCAL_DEV.md) — Docker workflow, env vars, host dev setup, troubleshooting
- [Architecture](docs/ARCHITECTURE.md) — monorepo layout, runtime components, tech stack
- [Deployment](docs/DEPLOYMENT.md) — production deployment with Railway or self-hosted VPS

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS 4, React Flow |
| Backend | Next.js API routes, BullMQ job workers |
| Database | SQLite via Drizzle ORM |
| Queue | Redis + BullMQ |
| Video encoding | ffmpeg (bundled in Docker image) |
| Monorepo | Turborepo + pnpm workspaces |

### Package layout

```
apps/web          Next.js app (UI + API routes)
packages/shared   Node definitions, candidate contract, shared types
packages/engine   Execution graph builder, RunCoordinator
packages/db       Drizzle schema, migrations, SQLite helpers
packages/worker   BullMQ workers + cron scheduler
packages/adapters Provider adapter interfaces
packages/crypto   AES-256 key encryption helpers
```

---

## Running without Docker

```bash
pnpm install

# Start Redis
docker compose up redis -d

export REDIS_URL=redis://localhost:6379
export DATA_DIR=./data

pnpm dev          # starts web (port 3000) + worker in parallel via turbo
```
