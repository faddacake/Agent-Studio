# Itera Studio — Persistent System Context

*This file is the canonical reference for session continuity. Update it when architecture, capability, or workflow decisions change. Read it at the start of any session that involves product direction, capability planning, or architecture decisions.*

---

## Project Overview

Itera Studio is a self-hostable, local-first visual workflow builder for AI content generation. Users compose nodes on a canvas, wire them together, and run the DAG to produce images and videos. It is not a SaaS product — it runs entirely on the user's machine against third-party AI APIs (fal.ai, Replicate) that the user supplies keys for.

**Monorepo:** Turborepo + pnpm
**Apps:** `apps/web` — Next.js 15 app router, the only user-facing surface
**Packages:** `shared` (types, registry, node definitions), `db` (Drizzle + SQLite), `engine` (execution, adapters), `crypto`, `adapters`, `worker`

---

## Current Capabilities (V1)

### Image Generation
- **FLUX 1.1 Pro** (`fal-ai/flux-pro/v1.1`) — production quality, fal.ai
- **FLUX Schnell** (`fal-ai/flux/schnell`) — draft quality, fast, fal.ai
- **Stable Diffusion XL** (`stability-ai/sdxl`) — Replicate

### Video Generation
- **Kling 1.6** (`fal-ai/kling-video/v1.6/standard/text-to-video`) — fal.ai

### Capability Nodes
- **Best of N** — generate N image candidates, score, select top K (image only)
- **CLIP Scoring** — score images by prompt similarity (image only)
- **Ranking** — rank scored candidates
- **Social Format** — format outputs for social export
- **Export Bundle** — package outputs as downloadable zip

### Utility Nodes
- **Prompt Template** — parameterised text input
- **Image Input** — load a local image into the workflow
- **Resize**, **Crop**, **Format Convert**, **Compositing** — image-only transforms
- **Output** — terminal sink node

### What Is Not Yet Supported
- Voice generation (models catalogued but not wired to execution)
- Video transformation nodes (no resize/trim/convert for video)
- Video scoring / Best-of-N video
- Canvas Video Input node (no way to pipe a video artifact back into a workflow)

---

## Video Editor (V1)

The Video Editor is a lightweight, scene-based project editor that lets users assemble AI-generated artifacts into a presentable sequence. It is separate from the workflow canvas and has its own persistence model.

### Persistence

- **Table:** `editor_projects` (SQLite, migration `0007_editor_projects`)
- **Fields:** `id`, `name`, `aspect_ratio`, `scenes` (JSON), `audio_track` (JSON, nullable), `created_at`, `updated_at`
- **Types:** `apps/web/src/lib/editorProjectTypes.ts` — `EditorProject`, `Scene`, `TextOverlay`, `AudioTrack`, `AspectRatio`
- **Data access:** `apps/web/src/server/api/editorProjects.ts` — `createEditorProject`, `getEditorProject`, `updateEditorProject`, `listEditorProjects`, `deleteEditorProject`
- **HTTP API:** `GET/POST /api/editor-projects`, `GET/PATCH/DELETE /api/editor-projects/[id]`

### Scene Model

Each `Scene` carries:
- `id`, `type` (`"image"` | `"video"`), `src` (artifact path), `duration` (seconds)
- Optional `textOverlay` (`text`, `position`, `style`)
- Optional `transition` (`"cut"` | `"fade"`)

### UI Shell

- Route: `/editor` — dashboard; linked from the main app sidebar as "Video Projects" (after Workflows); lists existing projects in a responsive card grid; each card shows a 96 px tall first-scene thumbnail at the top (image scenes render via `/api/artifacts?path=…` with `objectFit: cover`; video scenes and empty/broken states show a muted icon placeholder — no layout jump between cards), name (click to rename inline — commits on blur/Enter, reverts on Escape, PATCHes `/api/editor-projects/[id]`, updates local list state on success, shows "rename failed" on error), a "×" delete button (top-right of name row, low opacity at rest, red on hover — requires `window.confirm`, calls `DELETE /api/editor-projects/[id]`, removes card from local list on success, shows "delete failed" in timestamp slot on error, disabled while in-flight), aspect ratio badge, scene count, and relative updated time; inline "New Project" form (name input + aspect ratio select + create button) calls `POST /api/editor-projects` then navigates to the new project; empty state encourages first creation
- Route: `/editor/[id]` — outside the `(app)` route group (no sidebar, full-screen surface)
- Page: `apps/web/src/app/editor/[id]/page.tsx` — client component, loads project via `/api/editor-projects/[id]`
- **`EditorShell`** — owns all mutable state: `scenes[]`, `projectName`, `aspectRatio`, `selectedId`, `saveState`, `isDirty`, `isPlaying`, `playIndex`, `isLooping`, `playEpoch`; computes `selectedScene` (with `scenes[0]` fallback) and `activeScene` (`isPlaying ? scenes[playIndex] : selectedScene`); playback: `handlePlayPause` starts from selected scene's index and bumps `playEpoch`, timer advancement increments `playEpoch` on each scene advance and loop restart so PreviewPlayer knows to reset its elapsed clock; `isLooping` read via `isLoopingRef` in the timeout so toggling mid-scene doesn't restart the countdown; exposes scene mutation callbacks and `handleAspectRatioChange`; `handleSave` PATCHes all state; `Cmd/Ctrl+S` listener skips inputs and in-flight saves
- **`EditorToolbar`** — breadcrumb `← Workflows`, inline name edit, aspect ratio `<select>` (16:9 / 9:16 / 1:1, calls `onAspectRatioChange`), a `✓ Saved` confirmation span (opacity 0 at rest, fades to 1 instantly on `saveState === "saved"`, fades out over 600 ms when leaving that state; always in DOM to prevent layout shift; `aria-live="polite"`), Save button with dirty indicator (label and color reflect all four `saveState` values)
- **`SceneList`** — scrollable scene cards (thumbnail, type badge, duration edit, up/down/remove); header shows "N scene(s) · Xs" derived live from `scenes` array (count + summed duration, formatted as compact decimal seconds); receives `isPlaying` + `playIndex` from EditorShell; card at `playIndex` shows a `inset 3px 0 0 var(--color-accent)` left-stripe `boxShadow` while `isPlaying` (clears instantly on pause/stop, independent of selection highlight); supports native HTML5 drag-to-reorder — each card is `draggable`, drag state (`draggingIdx`/`hoverIdx`) is local to `SceneList`, reordered array is passed to `EditorShell` via `onReorder` callback which calls `setScenes` + `setIsDirty`; dragging card renders at 0.5 opacity, drop-target card uses accent border; img/video children have `draggable={false}` + `pointerEvents: none` to suppress browser media drag; "Add Scene" opens `ArtifactPickerModal`; scenes with a non-empty `textOverlay` show a "T" badge (top-right of thumbnail); scenes with `transition === "fade"` show a "Fade" badge (bottom-left of thumbnail)
- **`PreviewPlayer`** — column flex container; top area: aspect-ratio-locked preview (`<video controls>` or `<img>`) with text overlay, scene info row, and empty state; bottom controls area: 3 px accent progress bar (full-width, derived from `progress = elapsedMs / totalMs`), then a button row with Play/Pause, Loop toggle, and right-aligned `Xs / Ys` time display; progress tracking via local `sceneElapsedMs` state driven by a RAF loop (`[isPlaying]` effect) accumulating `now - lastTick` deltas, reset to 0 via a `[playEpoch]` effect when EditorShell signals a new scene epoch; `elapsedMs = priorMs + min(sceneElapsedMs, currentSceneDurationMs)`, `totalMs = sum of all scene durations`; only PreviewPlayer re-renders at ~60 fps during playback
- **`SceneInspector`** — right panel (220 px); header "Scene"; **Duration** numeric input (min 1 s, step 0.1, committed on blur/Enter); **Transition** cut/fade toggle (cut is implicit default — selecting cut removes the field); divider; **Text Overlay** section: textarea (committed on blur), position toggle (top/center/bottom), style toggle (subtitle/title/minimal), "Clear overlay" button; shown only when a scene is selected; no autosave

### Workflow → Editor Handoff

The run detail page (`/workflows/[id]/history/[runId]`) has a "Send to Video Editor" action in the run actions bar (shown for completed/partial runs when artifacts exist). An inline `<select>` (16:9 / 9:16 / 1:1, default 16:9) sits immediately to the left of the button so users can set the aspect ratio before sending. The handler reads the effective artifact selection (`selectedPaths === null` → all; `selectedPaths` Set → filtered), maps each to a `Scene` (image: 5 s default, video: 10 s default), and POSTs to `POST /api/editor-projects` with `name: "Run <id[:8]>"` and the chosen `aspectRatio`. On success it navigates to `/editor/[id]`. The button is hidden when no artifacts exist, and disabled (not hidden) when nothing is selected.

### Design Constraints

- Artifact paths are stored as-is; the existing artifact system serves all media
- No artifact data is duplicated in the editor schema
- No advanced editing features (no trim, no effects, no multi-track)
- No relational expansion — single table + JSON columns
- No autosave — explicit Save button only

---

## Architecture Principles

### Node Platform
Every operation is a `NodeDefinition` in the shared package node registry. UI code queries the registry — it never hardcodes model-specific branches. Adding a new model requires only: (1) a catalog entry in `models.ts`, (2) registration in `nodeRegistryInit.ts`. No UI changes required.

- **`NodeDefinition`** — the central type: ports, params, runtime kind, UI hints
- **`nodeRegistry`** — singleton in `packages/shared`; all consumers query it
- **Four `NodeRuntimeKind` values:** `provider`, `local`, `virtual`, `capability`
- **Model bridge** (`modelBridge.ts`) — converts `ModelOption` catalog entries → `NodeDefinition` objects
- **Built-in definitions** live in `packages/shared/src/nodeDefinitions/` (io, utility, provider, capabilities)

### Execution
- `packages/engine` owns all execution logic
- `GeneratorAdapter` (image) and `VideoGeneratorAdapter` (video) are separate interfaces — kept parallel to avoid polluting the image-focused Best-of-N pipeline
- Provider executor in `apps/web/src/app/api/workflows/[id]/runs/route.ts` routes image vs video via `isFalVideoModelId()` prefix check
- `writeArtifact()` writes buffers to disk and returns `ArtifactRef` (kind: `local-file`, path, mimeType, filename, sizeBytes, optional width/height)
- Artifacts are served at `/api/artifacts?path=<absolute-path>` with correct Content-Type

### Candidate Contract
Multi-candidate data flow (Best-of-N → CLIP → Ranking) uses `CandidateCollection` / `CandidateSelection` from `packages/shared/src/candidateTypes.ts`. Helpers in `candidateHelpers.ts`. This is image-only today.

### Output Normalization
`apps/web/src/lib/runOutputs.ts` normalises raw node output maps into `NodeLatestOutput`. Types: `"image" | "video" | "text" | "json" | "unknown"`. Image and video refs are extracted via `extractImageRefs` / `extractVideoRefs` from `artifactRefs.ts`.

### Provider Key Resolution
`apps/web/src/lib/providers/resolveProviderKey.ts` — reads `providerConfigs` DB row, decrypts the API key. Injected into execution context as `__apiKey`. Precedence: DB config → env var (`FAL_API_KEY` / `REPLICATE_API_TOKEN`) → MockGeneratorAdapter.

---

## UX Principles

1. **Truth over cleverness** — the UI must never imply a capability that does not exist. Label, preview, and metadata must match the actual output type (image vs video, not a generic "media").

2. **Capability-driven, not model-specific** — UI branches on port types, node categories, and `NodeDefinition` metadata. Never on model IDs or provider names.

3. **Minimal and non-noisy** — no explanatory banners unless strictly required to prevent a misleading state. Prefer better labels and conditional field visibility over extra chrome.

4. **Symmetric modality treatment** — image and video outputs must be rendered, labelled, previewed, and handled equivalently across every surface: run outputs panel, inspector, history page, lineage, timeline.

5. **Session-only UI state** — no new local-storage or DB fields for UI-only concerns unless there is a clear user need.

---

## V1 Model Strategy

| Model | Category | Provider | Status |
|-------|----------|----------|--------|
| FLUX 1.1 Pro | image | fal.ai | ✅ supported |
| FLUX Schnell | image | fal.ai | ✅ supported |
| SDXL | image | Replicate | ✅ supported |
| Kling 1.6 | video | fal.ai | ✅ supported |
| All others | image/video/voice | various | catalogued, `supported: false` |

The three supported image models give users a draft-vs-production and provider comparison on first load. Kling 1.6 is the single supported video model. Voice models are catalogued but have no execution path.

**Unsupported models** are in `models.ts` with `supported: false`. They do not appear in node palettes or default model pickers. They exist to make the catalog extensible without schema changes.

---

## Development Workflow

### Key Build Commands
```
pnpm --filter /shared run build   # build shared package
pnpm --filter /engine run build   # build engine package
pnpm --filter /web typecheck      # typecheck web app
pnpm --filter /engine run test    # run engine integration tests
```

### Pre-existing Known Issues
- TS errors in `packages/engine/src/*.integration.test.ts` (PortType string literals) — pre-existing, not a regression from recent work. Non-test engine code typechecks clean.
- Two incompatible `ProviderAdapter` interfaces exist (web thin vs `packages/adapters` rich) — not yet reconciled.

### Session Discipline
- Always typecheck after changes: `pnpm --filter /web typecheck`
- Prefer editing existing files over creating new ones
- Do not add model-specific UI branches — derive from registry/capability metadata
- Keep `docs/SESSION_CONTEXT.md` updated at the end of each session

---

## What to Avoid

- **Model-specific UI branches** — do not check `modelId === "kling-1.6"` in UI code
- **Duplicating extraction logic** — use `extractImageRefs` / `extractVideoRefs` from `artifactRefs.ts`; do not re-implement inline
- **Image-only assumptions in shared surfaces** — any component that handles `ArtifactRef` or `NodeLatestOutput` must handle both `image/` and `video/` mime types
- **New banner/callout components** — prefer truthful labels over explanatory UI
- **Speculative features in this file** — only document what currently works

---

## V1 Completion Definition

V1 is complete when a user can:

1. Open the app with no configuration and understand what it does
2. Add a provider API key (fal.ai or Replicate) in Settings
3. Run a Prompt → Image workflow and see the generated image inline
4. Run a Prompt → Video workflow (Kling 1.6) and see the generated video inline
5. View run history with all artifacts (image and video) rendered correctly
6. Export a ZIP bundle of run artifacts
7. Use the canvas node palette to compose custom workflows from all supported node types

All seven of these work today.
