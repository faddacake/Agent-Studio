# Template Empty State — Design Spec

**Date:** 2026-04-27  
**Status:** Implemented

---

## Problem

The blank canvas had no actionable guidance. Users saw only an opaque hint: "Canvas is empty — add a node or use a Template." The template link was a small underlined word; the built-in packs were completely hidden behind a modal that required deliberate discovery. First-time users had no sense of what was possible or how to begin.

---

## Goal

Make the empty canvas welcoming and immediately actionable. Featured templates should be front-and-center the moment a user opens a blank workflow — no modal required.

---

## Approach

**Centered featured-template panel** (Approach 2 of 3 considered).

When `nodes.length === 0` and the user has not explicitly dismissed the panel, render a modal-style card centered over the canvas (not full-screen, not a sidebar) with:

- 3–4 curated featured template cards, Quick Social Reel first
- An explicit "Use Template" button on each card
- A "Browse all templates" button that opens the existing `TemplatePicker` modal
- A "Start Blank" escape hatch that permanently dismisses the panel for the session

Once any node lands on the canvas (template loaded or manual add), the condition `nodes.length === 0` becomes false and the panel disappears automatically.

---

## Architecture

### Schema change — `featuredTemplates`

`TemplatePackManifest` gains an optional `featuredTemplates?: string[]` field — an ordered list of template IDs within that pack to surface in the featured panel. The field is validated by the existing Zod schema at parse time.

```typescript
featuredTemplates: z.array(z.string()).optional()
```

### Loader method — `getFeaturedTemplates(limit)`

`TemplatePackLoader` gains a `getFeaturedTemplates(limit = 4): TemplateEntry[]` method. It iterates registered packs in insertion order, then iterates each pack's `featuredTemplates` array in declaration order, collecting up to `limit` entries. Template IDs missing from the pack's templates map are silently skipped.

Registration order determines display order. `videoCreationStarters` is registered first, so `quick-social-reel` is always card #1.

### Pack initialization — `initTemplatePacks.ts`

Previously, `TemplatePicker.tsx` owned a module-level guard (`let packsRegistered`) and all three static JSON imports. Extracted to `apps/web/src/lib/initTemplatePacks.ts` so both `TemplatePicker` and the new `WorkflowEmptyState` share one initialization boundary. Calling `ensurePacksLoaded()` from either component is idempotent.

### `WorkflowEmptyState` component

`apps/web/src/components/canvas/WorkflowEmptyState.tsx`

- Calls `ensurePacksLoaded()` on mount, then sets `ready = true` to trigger a render
- Reads `templatePackLoader.getFeaturedTemplates(4)` once ready
- Renders a `max-w-2xl` centered panel with a 2-column card grid on `sm:` breakpoint
- Each `FeaturedCard` shows: template name, node count, description, "Use Template" button
- Footer has a "Browse all templates" button (`onOpenGallery`)
- Header has a "Start Blank" text link (`onStartBlank`)
- Positioned `absolute inset-0 z-10` over the React Flow surface — the canvas and toolbar remain mounted beneath it

### Canvas wiring — `WorkflowCanvas.tsx`

Replaces the previous `pointer-events-none` empty-state div (lines 1151–1171) with:

```tsx
{nodes.length === 0 && !emptyStateDismissed && (
  <WorkflowEmptyState
    onSelectTemplate={handleTemplateSelect}
    onOpenGallery={toggleTemplatePicker}
    onStartBlank={() => setEmptyStateDismissed(true)}
  />
)}
```

`emptyStateDismissed` is a `useState(false)` local to `CanvasInner`. It persists for the life of the component instance (i.e., the duration of a canvas session). It does not need to be persisted to localStorage or the database: if a workflow has nodes, the condition `nodes.length === 0` is already false; if a workflow is empty, showing the panel again on next visit is desirable.

---

## Data Flow

```
ensurePacksLoaded()
  → registerBuiltInPacks([videoCreationStarters, imageGenStarter, socialContentPipeline])
  → rehydratePersistedPacks()

templatePackLoader.getFeaturedTemplates(4)
  → reads pack insertion order (video first)
  → reads each pack's manifest.featuredTemplates[]
  → returns [quick-social-reel, product-promo, prompt-to-image]

WorkflowEmptyState
  → renders FeaturedCard × 3
  → user clicks "Use Template"
  → onSelectTemplate(entry.graph, displayName)
  → handleTemplateSelect in WorkflowCanvas
  → applyTemplate → loadWorkflow → nodes.length > 0 → panel gone
```

---

## Featured Templates (v1)

| Order | Template ID | Pack |
|-------|-------------|------|
| 1 | `quick-social-reel` | video-creation-starters |
| 2 | `product-promo` | video-creation-starters |
| 3 | `prompt-to-image` | image-gen-starter |

---

## What Was Not Changed

- `TemplatePicker` modal — unchanged except removal of its local pack-init code
- `SaveAsTemplateDialog` — unchanged
- Post-run "Send to Video Editor" FAB — completely separate code path, unaffected
- localStorage persistence (`templatePackStorage.ts`) — unchanged
- DB user-template loading — unchanged
- `emptyStateDismissed` is **not** persisted — intentional; empty workflows always show the panel on fresh load

---

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/templatePack.ts` | Added `featuredTemplates` to Zod schema; added `getFeaturedTemplates(limit)` method |
| `packages/shared/src/templatePack.test.ts` | 5 new tests for `getFeaturedTemplates` |
| `templates/packs/video-creation-starters.json` | Added `featuredTemplates: ["quick-social-reel", "product-promo"]` |
| `templates/packs/image-gen-starter.json` | Added `featuredTemplates: ["prompt-to-image"]` |
| `apps/web/src/lib/initTemplatePacks.ts` | New — single pack-init module |
| `apps/web/src/components/canvas/TemplatePicker.tsx` | Removed local pack init; imports `ensurePacksLoaded` from `initTemplatePacks` |
| `apps/web/src/components/canvas/WorkflowEmptyState.tsx` | New — featured-template panel component |
| `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Replaced empty-state hint div with `<WorkflowEmptyState>` |
