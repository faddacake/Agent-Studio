# Template Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "Canvas is empty" hint with a welcoming, actionable empty state that surfaces 3–4 featured template cards directly on the canvas — no modal required to get started.

**Architecture:** Add a `featuredTemplates` field to `TemplatePackManifest` and a `getFeaturedTemplates(limit)` method to `TemplatePackLoader`. Extract pack initialization into a shared `initTemplatePacks.ts` module. Build a `WorkflowEmptyState` component that renders the featured cards inline, then wire it into the existing `nodes.length === 0` branch in `WorkflowCanvas`.

**Tech Stack:** TypeScript, Zod, React (hooks), Tailwind CSS, Vitest/node:test (same test runner as existing `templatePack.test.ts`)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/shared/src/templatePack.ts` | Add `featuredTemplates` to Zod schema; add `getFeaturedTemplates(limit)` method |
| Modify | `packages/shared/src/templatePack.test.ts` | Tests for `getFeaturedTemplates` |
| Modify | `templates/packs/video-creation-starters.json` | Mark `quick-social-reel`, `product-promo` as featured |
| Modify | `templates/packs/image-gen-starter.json` | Mark `prompt-to-image` as featured |
| Create | `apps/web/src/lib/initTemplatePacks.ts` | Single home for pack imports + `ensurePacksLoaded` guard |
| Modify | `apps/web/src/components/canvas/TemplatePicker.tsx` | Remove local pack init; import from `initTemplatePacks` |
| Create | `apps/web/src/components/canvas/WorkflowEmptyState.tsx` | Centered empty-state panel with featured cards |
| Modify | `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Replace existing empty-state div with `<WorkflowEmptyState>` |

---

## Task 1: Add `featuredTemplates` to the shared schema and loader

**Files:**
- Modify: `packages/shared/src/templatePack.ts`
- Test: `packages/shared/src/templatePack.test.ts`

### Step 1.1 — Write the failing tests

Add a new `describe("getFeaturedTemplates", ...)` block at the bottom of `packages/shared/src/templatePack.test.ts`, before the closing brace of the file (append after line 169):

```typescript
describe("getFeaturedTemplates", () => {
  it("returns featured templates in declaration order across packs", () => {
    const loader = new TemplatePackLoader();
    const pack = parseTemplatePack({
      manifest: {
        id: "pack-a",
        name: "Pack A",
        version: "1.0.0",
        source: "builtin",
        templates: ["alpha", "beta", "gamma"],
        featuredTemplates: ["beta", "alpha"],
      },
      templates: {
        alpha: { version: 1, nodes: [], edges: [] },
        beta: { version: 1, nodes: [], edges: [] },
        gamma: { version: 1, nodes: [], edges: [] },
      },
    });
    loader.register(pack);

    const featured = loader.getFeaturedTemplates(10);
    assert.equal(featured.length, 2);
    assert.equal(featured[0].id, "beta");
    assert.equal(featured[1].id, "alpha");
  });

  it("respects the limit parameter", () => {
    const loader = new TemplatePackLoader();
    const pack = parseTemplatePack({
      manifest: {
        id: "pack-b",
        name: "Pack B",
        version: "1.0.0",
        source: "builtin",
        templates: ["a", "b", "c"],
        featuredTemplates: ["a", "b", "c"],
      },
      templates: {
        a: { version: 1, nodes: [], edges: [] },
        b: { version: 1, nodes: [], edges: [] },
        c: { version: 1, nodes: [], edges: [] },
      },
    });
    loader.register(pack);

    const limited = loader.getFeaturedTemplates(2);
    assert.equal(limited.length, 2);
    assert.equal(limited[0].id, "a");
    assert.equal(limited[1].id, "b");
  });

  it("returns empty array when no packs declare featuredTemplates", () => {
    const loader = new TemplatePackLoader();
    const pack = parseTemplatePack(loadRawPack()); // social-content-pipeline has no featuredTemplates
    loader.register(pack);

    const featured = loader.getFeaturedTemplates(10);
    assert.equal(featured.length, 0);
  });

  it("silently skips featuredTemplates IDs absent from the templates map", () => {
    const loader = new TemplatePackLoader();
    const pack = parseTemplatePack({
      manifest: {
        id: "pack-c",
        name: "Pack C",
        version: "1.0.0",
        source: "builtin",
        templates: ["real"],
        featuredTemplates: ["real", "ghost"],
      },
      templates: {
        real: { version: 1, nodes: [], edges: [] },
      },
    });
    loader.register(pack);

    const featured = loader.getFeaturedTemplates(10);
    assert.equal(featured.length, 1);
    assert.equal(featured[0].id, "real");
  });

  it("populates preview from manifest.previews", () => {
    const loader = new TemplatePackLoader();
    const pack = parseTemplatePack({
      manifest: {
        id: "pack-d",
        name: "Pack D",
        version: "1.0.0",
        source: "builtin",
        templates: ["x"],
        previews: { x: "A great template" },
        featuredTemplates: ["x"],
      },
      templates: {
        x: { version: 1, nodes: [], edges: [] },
      },
    });
    loader.register(pack);

    const featured = loader.getFeaturedTemplates(10);
    assert.equal(featured[0].preview, "A great template");
  });
});
```

- [ ] **Step 1.2 — Run tests to confirm they fail**

```bash
cd /path/to/Itera_Studio && pnpm --filter @iterastudio/shared test
```

Expected: `TypeError: loader.getFeaturedTemplates is not a function` (or similar — the method doesn't exist yet).

- [ ] **Step 1.3 — Add `featuredTemplates` to `TemplatePackManifestSchema` in `packages/shared/src/templatePack.ts`**

In `templatePack.ts`, after line 35 (the `defaultPrompts` field), add one line:

```typescript
  /** Per-template example prompts injected into the prompt-template node at load time. */
  defaultPrompts: z.record(z.string()).optional(),
  /** Ordered list of template IDs to surface in the featured/empty-state panel. */
  featuredTemplates: z.array(z.string()).optional(),
  requiredProviders: z.array(z.string()).optional(),
```

- [ ] **Step 1.4 — Add `getFeaturedTemplates` method to `TemplatePackLoader`**

In `templatePack.ts`, add the following method after `getAllTemplates` (after line 162, before `checkAvailability`):

```typescript
  /**
   * Get featured templates across all registered packs, in pack-registration
   * order then per-pack declaration order, up to `limit` entries.
   * Templates whose IDs are not in the pack's templates map are silently skipped.
   */
  getFeaturedTemplates(limit = 4): TemplateEntry[] {
    const result: TemplateEntry[] = [];
    for (const pack of this.packs.values()) {
      for (const templateId of pack.manifest.featuredTemplates ?? []) {
        const graph = pack.templates[templateId];
        if (!graph) continue;
        result.push({
          id: templateId,
          packId: pack.manifest.id,
          name: templateId,
          graph,
          preview: pack.manifest.previews?.[templateId],
        });
        if (result.length >= limit) return result;
      }
    }
    return result;
  }
```

- [ ] **Step 1.5 — Run tests to confirm they pass**

```bash
pnpm --filter @iterastudio/shared test
```

Expected: all tests PASS, including the 5 new `getFeaturedTemplates` tests.

- [ ] **Step 1.6 — Commit**

```bash
git add packages/shared/src/templatePack.ts packages/shared/src/templatePack.test.ts
git commit -m "feat(shared): add featuredTemplates to manifest schema and getFeaturedTemplates to loader"
```

---

## Task 2: Mark featured templates in the pack JSON files

**Files:**
- Modify: `templates/packs/video-creation-starters.json`
- Modify: `templates/packs/image-gen-starter.json`

The registration order in Task 3 will be `[videoCreationStarters, imageGenStarter, socialContentPipeline]`, so `getFeaturedTemplates(4)` will yield: `quick-social-reel → product-promo → prompt-to-image` (3 featured; a 4th can be added later by marking `full-pipeline` in social-content-pipeline).

- [ ] **Step 2.1 — Add `featuredTemplates` to `video-creation-starters.json`**

Open `templates/packs/video-creation-starters.json`. In the `manifest` object, add after the existing `tags` array:

```json
"featuredTemplates": ["quick-social-reel", "product-promo"],
```

The manifest block should look like:

```json
"manifest": {
  "id": "video-creation-starters",
  "name": "Video Creation Starters",
  "version": "1.0.0",
  "author": "Itera Studio",
  "description": "Three ready-to-run starting points for the core multimodal loop: generate images, animate them, and export.",
  "category": "video-creation",
  "tags": ["video", "image", "starter", "social", "reel", "story"],
  "featuredTemplates": ["quick-social-reel", "product-promo"],
  "templates": ["quick-social-reel", "product-promo", "story-highlight"],
  ...
}
```

- [ ] **Step 2.2 — Add `featuredTemplates` to `image-gen-starter.json`**

Open `templates/packs/image-gen-starter.json`. In the `manifest` object, add after `tags`:

```json
"featuredTemplates": ["prompt-to-image"],
```

- [ ] **Step 2.3 — Run tests to verify JSON is still valid**

```bash
pnpm --filter @iterastudio/shared test
```

Expected: all tests PASS. The `parseTemplatePack` tests load `social-content-pipeline.json`; your edits are to the other two files but this confirms the test runner still works.

- [ ] **Step 2.4 — Commit**

```bash
git add templates/packs/video-creation-starters.json templates/packs/image-gen-starter.json
git commit -m "feat(templates): mark quick-social-reel, product-promo, prompt-to-image as featured"
```

---

## Task 3: Extract pack initialization into `initTemplatePacks.ts`

**Files:**
- Create: `apps/web/src/lib/initTemplatePacks.ts`
- Modify: `apps/web/src/components/canvas/TemplatePicker.tsx`

This moves the module-level guard and static imports from `TemplatePicker.tsx` into a single shared module so both `TemplatePicker` and the new `WorkflowEmptyState` share one initialization boundary.

- [ ] **Step 3.1 — Create `apps/web/src/lib/initTemplatePacks.ts`**

```typescript
/**
 * Single initialization point for built-in template packs.
 *
 * Both TemplatePicker and WorkflowEmptyState call ensurePacksLoaded().
 * The guard prevents double-registration regardless of call order.
 * Registration order determines getFeaturedTemplates() output order —
 * videoCreationStarters is first so quick-social-reel appears first.
 */

import { registerBuiltInPacks } from "@iterastudio/shared";
import { rehydratePersistedPacks } from "./templatePackStorage";

import videoCreationStarters from "../../../templates/packs/video-creation-starters.json";
import imageGenStarter from "../../../templates/packs/image-gen-starter.json";
import socialContentPipeline from "../../../templates/packs/social-content-pipeline.json";

let packsRegistered = false;

export function ensurePacksLoaded(): void {
  if (packsRegistered) return;
  packsRegistered = true;
  registerBuiltInPacks([videoCreationStarters, imageGenStarter, socialContentPipeline]);
  rehydratePersistedPacks();
}
```

- [ ] **Step 3.2 — Update `TemplatePicker.tsx` to import from `initTemplatePacks`**

In `apps/web/src/components/canvas/TemplatePicker.tsx`:

**Remove** these lines (approximately lines 36–46):

```typescript
import socialContentPipeline from "../../../../../templates/packs/social-content-pipeline.json";
import imageGenStarter from "../../../../../templates/packs/image-gen-starter.json";
import videoCreationStarters from "../../../../../templates/packs/video-creation-starters.json";

let packsRegistered = false;
function ensurePacksLoaded() {
  if (packsRegistered) return;
  packsRegistered = true;
  registerBuiltInPacks([imageGenStarter, socialContentPipeline, videoCreationStarters]);
  rehydratePersistedPacks();
}
```

**Add** this import near the top of the file (alongside the other `@/lib` imports):

```typescript
import { ensurePacksLoaded } from "@/lib/initTemplatePacks";
```

Also remove `registerBuiltInPacks` from the `@iterastudio/shared` import if it's no longer used elsewhere in the file (and remove `rehydratePersistedPacks` from the `@/lib/templatePackStorage` import for the same reason — check if `persistPack` is still needed, which it is, so keep that import but remove `rehydratePersistedPacks`).

The `useEffect` that calls `ensurePacksLoaded()` at line ~101 stays unchanged:

```typescript
useEffect(() => {
  ensurePacksLoaded();
}, []);
```

- [ ] **Step 3.3 — Typecheck**

```bash
pnpm --filter @iterastudio/web typecheck
```

Expected: no errors. Fix any import errors (e.g., `registerBuiltInPacks` still imported but no longer used).

- [ ] **Step 3.4 — Commit**

```bash
git add apps/web/src/lib/initTemplatePacks.ts apps/web/src/components/canvas/TemplatePicker.tsx
git commit -m "refactor: extract pack initialization into initTemplatePacks.ts"
```

---

## Task 4: Build `WorkflowEmptyState` component

**Files:**
- Create: `apps/web/src/components/canvas/WorkflowEmptyState.tsx`

- [ ] **Step 4.1 — Create the component**

```typescript
"use client";

import { useState, useEffect } from "react";
import { templatePackLoader, type TemplateEntry } from "@iterastudio/shared";
import type { WorkflowGraph } from "@iterastudio/shared";
import { ensurePacksLoaded } from "@/lib/initTemplatePacks";

export interface WorkflowEmptyStateProps {
  onSelectTemplate: (graph: WorkflowGraph, name: string) => void;
  onOpenGallery: () => void;
  onStartBlank: () => void;
}

export function WorkflowEmptyState({
  onSelectTemplate,
  onOpenGallery,
  onStartBlank,
}: WorkflowEmptyStateProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensurePacksLoaded();
    setReady(true);
  }, []);

  const featured: TemplateEntry[] = ready
    ? templatePackLoader.getFeaturedTemplates(4)
    : [];

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-neutral-700 bg-neutral-900/95 shadow-2xl backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Start from a template</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Pick a template below or build from scratch
            </p>
          </div>
          <button
            type="button"
            onClick={onStartBlank}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
          >
            Start Blank
          </button>
        </div>

        {/* Featured template cards */}
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {featured.map((entry) => (
            <FeaturedCard
              key={`${entry.packId}/${entry.id}`}
              entry={entry}
              onSelect={onSelectTemplate}
            />
          ))}
          {!ready && (
            <p className="col-span-2 py-4 text-center text-xs text-neutral-600">
              Loading templates…
            </p>
          )}
          {ready && featured.length === 0 && (
            <p className="col-span-2 py-4 text-center text-xs text-neutral-600">
              No featured templates found.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-center border-t border-neutral-800 px-6 py-3">
          <button
            type="button"
            onClick={onOpenGallery}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
          >
            <GridIcon />
            Browse all templates
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Featured card ──

function FeaturedCard({
  entry,
  onSelect,
}: {
  entry: TemplateEntry;
  onSelect: (graph: WorkflowGraph, name: string) => void;
}) {
  const displayName = formatTemplateName(entry.id);
  const nodeCount = entry.graph.nodes.length;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-800/40 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
      {/* Name + node count */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-200">{displayName}</span>
        <span className="shrink-0 text-[10px] text-neutral-600">
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Description */}
      {entry.preview ? (
        <p className="flex-1 text-xs leading-relaxed text-neutral-500">{entry.preview}</p>
      ) : (
        <p className="flex-1 text-xs text-neutral-600">No description.</p>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={() => onSelect(entry.graph, displayName)}
        className="mt-1 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 active:bg-blue-700"
      >
        Use Template
      </button>
    </div>
  );
}

// ── Helpers ──

function formatTemplateName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function GridIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="1" width="4" height="4" rx="0.5" />
      <rect x="7" y="1" width="4" height="4" rx="0.5" />
      <rect x="1" y="7" width="4" height="4" rx="0.5" />
      <rect x="7" y="7" width="4" height="4" rx="0.5" />
    </svg>
  );
}
```

- [ ] **Step 4.2 — Typecheck**

```bash
pnpm --filter @iterastudio/web typecheck
```

Expected: no errors.

- [ ] **Step 4.3 — Commit**

```bash
git add apps/web/src/components/canvas/WorkflowEmptyState.tsx
git commit -m "feat: add WorkflowEmptyState with featured template cards"
```

---

## Task 5: Wire `WorkflowEmptyState` into `WorkflowCanvas`

**Files:**
- Modify: `apps/web/src/components/canvas/WorkflowCanvas.tsx`

- [ ] **Step 5.1 — Add the import**

Near the top of `WorkflowCanvas.tsx`, alongside the other canvas component imports, add:

```typescript
import { WorkflowEmptyState } from "./WorkflowEmptyState";
```

- [ ] **Step 5.2 — Add the `emptyStateDismissed` state**

Inside `CanvasInner` (after the existing `useState` declarations, around line 155), add:

```typescript
const [emptyStateDismissed, setEmptyStateDismissed] = useState(false);
```

- [ ] **Step 5.3 — Replace the existing empty-state div**

Find the existing block at lines 1151–1171:

```tsx
{/* Empty-state hint — visible only when the canvas has no nodes */}
{nodes.length === 0 && (
  <div
    className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    aria-hidden="true"
  >
    <div className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-8 py-6 text-center backdrop-blur-sm">
      <p className="text-sm font-semibold text-neutral-300">Canvas is empty</p>
      <p className="text-xs leading-relaxed text-neutral-500">
        Add a node from the panel on the left, or start with a{" "}
        <button
          type="button"
          onClick={toggleTemplatePicker}
          className="pointer-events-auto font-medium text-neutral-300 underline underline-offset-2 hover:text-white"
        >
          Template
        </button>
        .
      </p>
    </div>
  </div>
)}
```

Replace it entirely with:

```tsx
{/* Empty state — visible only when canvas has no nodes and not dismissed */}
{nodes.length === 0 && !emptyStateDismissed && (
  <WorkflowEmptyState
    onSelectTemplate={handleTemplateSelect}
    onOpenGallery={toggleTemplatePicker}
    onStartBlank={() => setEmptyStateDismissed(true)}
  />
)}
```

- [ ] **Step 5.4 — Typecheck**

```bash
pnpm --filter @iterastudio/web typecheck
```

Expected: no errors.

- [ ] **Step 5.5 — Start the dev server and verify manually**

```bash
pnpm dev
```

Open a new workflow (empty canvas). Verify:
1. The featured template panel appears centered on the canvas — Quick Social Reel card is first.
2. Each card shows the template name, description, and a "Use Template" button.
3. Clicking "Use Template" loads the workflow graph and the panel disappears.
4. Clicking "Browse all templates" opens the existing Template Gallery modal.
5. Clicking "Start Blank" dismisses the panel; the canvas is blank and interactive.
6. Adding a node manually also dismisses the panel (because `nodes.length > 0`).
7. Open an existing workflow with nodes — the empty state does not appear.

- [ ] **Step 5.6 — Commit**

```bash
git add apps/web/src/components/canvas/WorkflowCanvas.tsx
git commit -m "feat: replace empty-state hint with WorkflowEmptyState featured panel"
```

---

## Self-Review

**Spec coverage:**
- ✅ `nodes.length === 0` triggers the panel — implemented in Task 5
- ✅ 3–4 featured cards, Quick Social Reel first — Tasks 2 + 3 ensure registration order (`videoCreationStarters` first → `quick-social-reel` appears first in `getFeaturedTemplates`)
- ✅ Explicit "Use Template" button per card — Task 4, `FeaturedCard` component
- ✅ "Browse all templates" opens existing modal — Task 5, `onOpenGallery={toggleTemplatePicker}`
- ✅ "Start Blank" escape hatch — Task 5, `setEmptyStateDismissed(true)`
- ✅ Panel disappears on node add or template load — `nodes.length === 0` condition is reactive to Zustand store
- ✅ Robust loading: packs initialized in `WorkflowEmptyState.useEffect` via shared `ensurePacksLoaded` — Task 3 + 4

**Placeholder scan:** No TBDs, no "similar to above", all code blocks are complete.

**Type consistency:**
- `TemplateEntry` used throughout — defined in `templatePack.ts`, exported from `@iterastudio/shared`
- `WorkflowEmptyStateProps.onSelectTemplate` matches `handleTemplateSelect`'s signature `(graph: WorkflowGraph, name: string) => void`
- `getFeaturedTemplates(limit?: number): TemplateEntry[]` — return type is the same `TemplateEntry` interface used by `getAllTemplates`
