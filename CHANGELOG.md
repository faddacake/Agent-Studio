# Changelog

## [1.0.0] — 2026-04-21

First stable release of Agent Studio.

### Features
- **Visual Workflow Canvas** — React Flow drag-and-drop editor with node palette, slash-command insert, undo/redo, inline rename, and minimap
- **Execution Engine** — BullMQ + Redis two-phase job pipeline with SSE live updates and per-node status
- **Node Library** — Image Generate (Fal.ai/Replicate, Best-of-N), Image Input, Image Transform (Sharp), Clip Scoring, Ranking, Social Format, Export Bundle
- **Inspector Panel** — Schema-driven parameter editor, model picker with cost estimates and provider key status
- **Budget Controls** — Per-workflow soft cap, pre-run cost estimate, warning modal, run cost history
- **Auto-Run** — Debounced workflow re-run after parameter edits
- **Run Debugger** — Live node execution panel, outputs tab, execution-path edge styling
- **Run History** — Per-workflow history page with replay mode
- **Workflow Library** — Templates, named revision checkpoints, reusable fragments
- **Video Editor** — Scene-based timeline at `/editor/[id]`, per-scene inspector, voiceover (fal-ai/kokoro TTS)
- **Export Pipeline** — Real ffmpeg renderer with polling, live status, and keyboard shortcuts
- **Scheduling** — Per-workflow cron schedules, canvas toolbar panel, minute-boundary cron runner in worker
- **Provider Management** — AES-256 encrypted API key storage, inline validation, multi-provider support
- **Docker Deployment** — Production multi-stage image with ffmpeg, all workspace dist files, fail-fast entrypoint
