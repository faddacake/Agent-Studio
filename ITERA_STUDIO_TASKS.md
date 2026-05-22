# Itera Studio Task Queue

**Status:** V1 complete — all core features shipped.  
The items below are V1.1 and post-V1 work. Pick up from the top.

---

## V1.1 — Stability & Polish

1. **E2E test suite (Playwright)** — cover the happy path: create workflow → add generate node → run → inspect output. CI currently runs typecheck + unit tests only.
2. **Scheduled workflows audit page** — a settings-level list of all workflows with active cron schedules so users can audit without opening each canvas. Wire to `GET /api/schedules` (new endpoint: query `workflow_schedule:*` from settings table).
3. **Worker health endpoint** — expose `/api/health/worker` (or extend `/api/health`) with queue depths from BullMQ (`predictions`, `downloads`, `export-jobs`) so ops can confirm the worker is processing.
4. **Real CLIP scoring** — `ENABLE_SCORING=false` today; wire `ClipScoringExecutor` to a real CLIP endpoint when `CLIP_API_URL` + `CLIP_API_KEY` are set.
5. **Per-run artifact browser** — a dedicated `/workflows/:id/runs/:runId/artifacts` page showing all outputs with thumbnails and download links, replacing the current outputs tab in the debugger.

---

## V1.1 — Video Editor

6. **Scene transition effects** — add a transition field to the scene data model; pass it through `buildFfmpegArgs` as a filter between scenes (`xfade` filter).
7. **Preview playback** — implement `PreviewPlayer` as a real HTML5 video element that plays the current scene's source asset with per-scene duration.
8. **Video generation node** — add a `video-generate` node type backed by Kling or Runway; integrate with existing generator adapter pattern and candidate contract.

---

## V1.1 — Infrastructure

9. **Reverse-proxy guide** — document Nginx/Caddy config for HTTPS + `TRUST_PROXY=true` in `docs/DEPLOYMENT.md`.
10. **Backup/restore** — `POST /api/admin/backup` exports `/data/db` + `/data/assets` as a tar.gz; document restore procedure.
11. **Rate limiting** — apply per-IP rate limiting to `/api/workflows/:id/runs` (POST) and `/api/providers` to prevent runaway spend from misconfigured auto-runs.

---

## V2 Backlog

- Multi-user support (auth, per-user workflows)
- Cloud storage backend for artifacts (S3/R2 instead of `/data/assets`)
- Real-time collaborative canvas (Y.js or Liveblocks)
- Webhook triggers for runs (instead of cron-only scheduling)
- Plugin / custom node SDK for community-built nodes
- Mobile-responsive canvas view
