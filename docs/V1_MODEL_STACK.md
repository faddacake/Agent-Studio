# V1 Model Stack — Itera Studio

Date: 2026-03-17

---

## 1. Current Integration State

### Providers with working execution paths

| Provider | Status | Notes |
|----------|--------|-------|
| **fal.ai** | **Functional** | `FalGeneratorAdapter` in `packages/engine/src/capabilities/generator.ts` calls fal.run via plain `fetch`. API key resolved from DB → env fallback. Used by provider executor in `runs/route.ts`. |
| **Mock** | **Functional** | `MockGeneratorAdapter` — deterministic solid-color PNGs. Used in tests and as fallback when no API key is configured. |
| Replicate | Stub | `ReplicateAdapter` in `apps/web/src/lib/providers/replicate.adapter.ts` exists but returns `null`. Not wired into the engine generator factory. |
| Google | Stub | `GoogleAdapter` exists but returns `null`. Engine factory has no Google branch. |

### Model catalog status (`apps/web/src/config/models.ts`)

| Model | Category | Provider | `supported` | Reality |
|-------|----------|----------|-------------|---------|
| FLUX 1.1 Pro | image | fal | `true` | **Works** — routes to `FalGeneratorAdapter` with `fal-ai/flux-pro/v1.1` |
| FLUX Schnell | *(not in catalog)* | fal | — | **Works** — used as engine default (`fal-ai/flux/schnell`) |
| Stable Diffusion XL | image | replicate | `true` | **Broken** — Replicate adapter is a stub |
| All video models | video | various | `false` | Not integrated |
| All voice models | voice | various | `false` | Not integrated |

**Gap:** `models.ts` marks SDXL as `supported: true` but its execution path (Replicate) is unimplemented. This is the most critical inconsistency to fix before launch.

---

## 2. V1 Model Categories

V1 scope (per PRD): **image generation** and **video generation**. Text/LLM and voice are explicitly out of scope.

### 2a. Image Generation — Core

The primary product value. Users need at least two distinct images models to enable meaningful A/B comparison (a core PRD use case).

### 2b. Video Generation — Secondary

Called out in the PRD as a primary use case ("Image-to-Video Pipeline"). Required for V1 completeness, but a simpler single-model starting point is acceptable.

### 2c. Utility Nodes — Already complete

Resize, crop, format-convert, compositing, prompt-template — implemented in `packages/engine/src/local/`. No additional work required.

### 2d. Capability Nodes — Already complete

CLIP scoring, ranking, social format, export bundle — implemented in `packages/engine/src/capabilities/`. No additional work required.

---

## 3. V1 Launch Stack

### Image Generation

| Model | Provider | Priority | Why |
|-------|----------|----------|-----|
| **FLUX Schnell** | fal.ai | **Must-have** | Already functional. Ultra-fast (4 steps), low cost (~$0.003/image), ideal for rapid iteration and draft-quality runs. Default model in the engine. |
| **FLUX 1.1 Pro** | fal.ai | **Must-have** | Already functional (`fal-ai/flux-pro/v1.1`). Production-quality output. Natural upgrade from Schnell. Same adapter, zero additional integration work. |
| **SDXL** | Replicate | **Must-have** | Enables multi-provider A/B testing (core PRD use case). Marked `supported: true` in catalog — must either be implemented or the flag must be corrected. Low cost (~$0.02), well-known quality baseline. |
| FLUX Dev | fal.ai | Nice-to-have | Middle tier between Schnell and Pro. Same adapter as the others; trivial to add. Adds meaningful quality/cost graduation. |
| FLUX Realism | fal.ai | Nice-to-have | Photorealistic specialization. Same fal adapter. |

**Excluded from V1**: DALL·E 3, Adobe Firefly, Gemini Imagen, Midjourney, Recraft, Grok Image — all require new provider adapters with no current implementation, and most have API access constraints. Post-V1 candidates.

### Video Generation

| Model | Provider | Priority | Why |
|-------|----------|----------|-----|
| **Kling 1.6** | fal.ai | **Must-have** | Available on fal.ai (`fal-ai/kling-video/v1.6/standard/text-to-video`). Reuses the existing fal adapter pattern. Explicitly named in the PRD. Affordable and fast. |
| Runway Gen-3 Alpha | fal.ai | Nice-to-have | Available on fal (`fal-ai/runway-gen3/turbo/text-to-video`). Broader cinematic quality range. Same adapter. |

**Excluded from V1**: Google Veo 3, OpenAI Sora, Luma Dream Machine, Pika, HeyGen, Synthesia, InVideo, Veed.io — require new provider integrations or have closed/complex API access.

---

## 4. Selection Criteria

| Criterion | Application |
|-----------|-------------|
| **Quality** | Each category needs at least one production-quality model (FLUX 1.1 Pro, Kling 1.6) and one fast draft model (FLUX Schnell). |
| **Speed** | Draft models (Schnell, Kling standard) must return results in under 15s to support iterative workflows. |
| **Cost** | Prefer models under $0.05/generation at standard settings. No model over $0.12 in V1. |
| **Integration reuse** | All V1 models route through the existing `FalGeneratorAdapter`. One new adapter needed (Replicate for SDXL). No new infrastructure. |
| **Coverage** | Two image models minimum (draft + production). One video model minimum. Zero redundant models in the same tier unless they offer distinct quality profiles. |

---

## 5. Integration Requirements

### fal.ai (existing — functional)

The `FalGeneratorAdapter` in `packages/engine/src/capabilities/generator.ts` currently:
- Defaults to `fal-ai/flux/schnell`
- Accepts `modelId` override via `GeneratorAdapterOptions.modelId`
- Maps prompt + dimensions to fal.run POST body
- Downloads the generated image buffer

**Required changes:**
1. Ensure `models.ts` entries for FLUX Schnell (`fal-ai/flux/schnell`) and FLUX 1.1 Pro (`fal-ai/flux-pro/v1.1`) are both marked `supported: true` and have matching `adapterModelId` values.
2. Add FLUX Dev (`fal-ai/flux/dev`) and Kling 1.6 (`fal-ai/kling-video/v1.6/standard/text-to-video`) entries to `models.ts`.
3. Extend `FalGeneratorAdapter` to handle video generation: video models return a URL rather than an image buffer, so the generator interface needs a `GeneratedVideo` output type (or a discriminated union) and the provider executor needs a video-write path alongside `writeArtifact`.

**Effort:** Low for additional image models (catalog entries only). Medium for video (new output type in generator + provider executor).

### Replicate (new — stub only)

The `ReplicateAdapter` in `apps/web/src/lib/providers/replicate.adapter.ts` is a stub. The real implementation needs to:
- POST to `https://api.replicate.com/v1/predictions` with model version + input
- Poll `GET /v1/predictions/{id}` until `status === "succeeded"` or `"failed"` (or use sync `/run` endpoint for supported models)
- Download the output image URL to a Buffer
- Register as a `GeneratorAdapter` in `createGenerator()` in `generator.ts`

**Required changes:**
1. Implement `ReplicateGeneratorAdapter` in `generator.ts` (parallel to `FalGeneratorAdapter`).
2. Add `provider === "replicate"` branch in `createGenerator()` factory, reading `REPLICATE_API_TOKEN`.
3. Update `resolveProviderKey.ts` to handle `"replicate"` provider ID (alongside `"fal"`).
4. Update `models.ts` SDXL entry to use the correct Replicate model version ID as `adapterModelId`.

**Effort:** Medium. Replicate's API is clean and well-documented. Polling or sync-mode requires careful timeout/abort handling.

---

## 6. Implementation Sequence

### Step 1 — Fix the SDXL `supported` inconsistency (blocker)

Either implement the Replicate adapter or flip `supported: false` on SDXL until it's ready. The current state (marked supported, actually broken) is the only pre-launch blocker in the model layer.

### Step 2 — Add FLUX Schnell to the model catalog

Add `fal-ai/flux/schnell` as an explicit catalog entry with `supported: true`. Currently the engine defaults to it but it has no catalog representation, so the Inspector and node palette don't offer it as a selectable model.

### Step 3 — Implement Replicate adapter

Implement `ReplicateGeneratorAdapter` in `generator.ts`, wire into `createGenerator()`, and update SDXL catalog entry. This unlocks A/B testing across providers — a core PRD use case.

### Step 4 — Add fal video support

Extend `FalGeneratorAdapter` (or add `FalVideoGeneratorAdapter`) to handle video-output models. Add Kling 1.6 to the catalog. Update the provider executor to write video artifacts. This delivers the "Image-to-Video Pipeline" use case from the PRD.

### Step 5 — Add FLUX Dev and Runway Gen-3 (nice-to-have)

Both reuse existing adapters. Pure catalog additions after Step 4 is complete.

---

## 7. "V1 Complete" Definition

The V1 model layer is complete when all of the following are true:

1. **FLUX Schnell** is selectable in the node palette, executes end-to-end via fal.ai, and produces a real image artifact stored in the run's output directory.
2. **FLUX 1.1 Pro** executes end-to-end and produces a production-quality image artifact.
3. **SDXL via Replicate** executes end-to-end — OR is explicitly marked `supported: false` in the catalog (no silent breakage).
4. **Kling 1.6** (or equivalent video model) executes end-to-end and produces a video artifact that the frontend can play.
5. A workflow with two parallel image-generation nodes (e.g., FLUX vs. SDXL) runs successfully, both outputs are visible in the results panel, and cost tracking reflects both nodes.
6. All `supported: true` models in `models.ts` have passing integration tests or a manually verified end-to-end run documented in the test plan.
7. A user with only a fal.ai API key can complete the "Image-to-Video Pipeline" use case from the PRD without encountering a broken node.

---

## 8. What Is NOT in V1 (Intentional Exclusions)

- **Text/LLM generation**: Explicitly out of scope per PRD.
- **Voice/TTS**: All voice models remain `supported: false`. No adapter work planned.
- **DALL·E 3 / OpenAI images**: Requires a separate OpenAI adapter. Post-V1.
- **Adobe Firefly**: Closed API, enterprise only. Post-V1.
- **Midjourney**: No official API. Post-V1.
- **Google Veo / Gemini Imagen**: Google adapter stub only; API access is restricted. Post-V1.
- **Sora**: Access-gated. Post-V1.
