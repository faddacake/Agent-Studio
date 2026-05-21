# Obsidian Memory Node — Design Spec

**Date:** 2026-05-19  
**Phase:** Agentic Upgrade — Phase 2  
**Status:** Approved, ready for implementation  
**Branch:** `blissful-mahavira-5e55f2`

---

## Overview

The Obsidian Memory Node gives ReAct agents persistent, human-readable, file-based long-term memory. Notes are stored as standard Markdown files with YAML frontmatter inside a configurable vault directory — fully compatible with Obsidian and any Markdown editor.

A single `obsidian-memory` canvas node registers four focused tool aliases (`memory-write`, `memory-append`, `memory-search`, `memory-read`) that the ReAct agent can call by name. This keeps the canvas clean (one node) while giving the LLM unambiguous, single-purpose tools.

---

## Architecture

### Files changed

| Layer | File | Change |
|---|---|---|
| Infra | `docker-compose.yml` | Add `./memory:/app/memory` bind-mount to app and worker services |
| Shared | `packages/shared/src/nodeTypes.ts` | Add `ObsidianMemory = "obsidian-memory"` |
| Shared | `packages/shared/src/nodeDefinition.ts` | Add `NodeCategory.Memory = "memory"` (order 0, sits after Agent at top of palette) |
| Shared | `packages/shared/src/nodeDefinitions/capabilities.ts` | Add `obsidianMemoryNode` definition |
| Shared | `packages/shared/src/nodeDefinitions/index.ts` | Export `obsidianMemoryNode` |
| Engine | `packages/engine/src/capabilities/obsidianMemory.ts` | New: full executor with 4 operations |
| Engine | `packages/engine/src/capabilities/index.ts` | Register `obsidian-memory` + 4 tool aliases |
| Web | `apps/web/src/components/canvas/ObsidianMemoryNode.tsx` | New: specialized canvas node (emerald accent, operation badge) |
| Web | `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Add `"obsidian-memory"` to `nodeTypes` and `SPECIALIZED_NODE_TYPES` |
| Web | `apps/web/src/components/canvas/NodePalette.tsx` | Add `NodeCategory.Memory` to `CATEGORY_META` |

---

## Vault structure

```
{vaultPath}/                    ←  /app/memory  (bind-mount default)
  _memory_index.json            ←  JSON sidecar index
  notes/                        ←  default folder for new notes
    llm-agent-benchmarks.md
    research-on-react-agents.md
  daily/                        ←  optional; users can write here explicitly
    2026-05-19.md
```

### `vaultPath` resolution order

1. Node param `vaultPath` (if non-empty string)
2. Environment variable `MEMORY_VAULT_PATH`
3. `/app/memory` — the bind-mounted host default
4. `/data/memory` — pure-Docker fallback (created on first write if needed)

---

## Data model

### Note file format

```markdown
---
id: "n_1716134400000"
title: "LLM agent benchmarks"
tags: ["research", "agents"]
folder: "notes"
created: "2026-05-19T12:00:00Z"
modified: "2026-05-19T12:00:00Z"
source: "node-abc123"
sourceUrl: "https://example.com/paper"
tokens: 312
---

Note body in standard Markdown.

Supports [[Wiki-style links]] and normal formatting.
```

**Fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable ID: `"n_{Date.now()}"` at creation, never changes |
| `title` | string | Human-readable title, also determines the filename slug |
| `tags` | string[] | Optional tags for filtering |
| `folder` | string | Subfolder inside vault (default: `"notes"`) |
| `created` | ISO 8601 | Set once on creation |
| `modified` | ISO 8601 | Updated on every write or append |
| `source` | string | `nodeId` of the node that created the note |
| `sourceUrl` | string? | Optional URL for web-sourced notes |
| `tokens` | number? | Approximate token count (chars / 4) for context management |

### Filename convention

Title is slugified: lowercased, spaces → hyphens, special chars stripped.  
`"LLM Agent Benchmarks"` → `notes/llm-agent-benchmarks.md`

On collision with `overwrite: false`, the operation returns a recoverable error string. On collision with `overwrite: true`, the file is replaced and the index entry is updated in place.

### JSON sidecar index (`_memory_index.json`)

```jsonc
{
  "version": 1,
  "entries": [
    {
      "id": "n_1716134400000",
      "title": "LLM agent benchmarks",
      "tags": ["research", "agents"],
      "folder": "notes",
      "path": "notes/llm-agent-benchmarks.md",   // relative to vaultPath
      "created": "2026-05-19T12:00:00Z",
      "modified": "2026-05-19T12:00:00Z",
      "sourceUrl": "https://example.com/paper",
      "tokens": 312,
      "excerpt": "First 500 characters of the note body…",
      "mtime": 1716134400000                      // fs mtime for stale detection
    }
  ]
}
```

**Stale detection:** Before every search, each entry's stored `mtime` is compared to the file's current `fs.stat().mtimeMs`. Stale entries are rebuilt individually. If a file is missing from the index (new file added directly in Obsidian), it is discovered on the next write cycle, not proactively — keeping search predictable without background watchers.

---

## Operations

### `memory-write` — Create or overwrite a note

**Tool alias:** `memory-write`  
**Registered via:** `nodeExecutor.registerCapability("memory-write", …)`

**Inputs (Action Input keys → routed by port ID):**

| Key | Source | Required | Description |
|---|---|---|---|
| `content_in` | input port | ✅ | Markdown body |
| `title` | param | ✅ | Note title |
| `folder` | param | — | Subfolder (default: `"notes"`) |
| `tags` | param | — | JSON array of tag strings |
| `overwrite` | param | — | Boolean, default `false` |
| `sourceUrl` | param | — | Origin URL |

**Execution steps:**
1. Validate `content_in` is non-empty (throw if not).
2. Slugify `title` → `{folder}/{slug}.md`.
3. Check for existing file. If exists and `overwrite: false` → return recoverable error string.
4. Compute `id` (preserve existing if overwriting), `tokens = Math.ceil(content.length / 4)`.
5. Compose frontmatter + content string.
6. `fs.mkdir(path, { recursive: true })` then `fs.writeFile`.
7. Upsert index entry (add or replace by `id`).
8. Return `content_out` (confirmation string) + `result_out` (JSON: `{ noteId, path, wordCount, tokens }`).

---

### `memory-append` — Add content to an existing note

**Tool alias:** `memory-append`

**Inputs:**

| Key | Source | Required | Description |
|---|---|---|---|
| `content_in` | input port | ✅ | Markdown block to append |
| `title` | param | — | Note title to locate (preferred) |
| `noteId` | param | — | Exact note ID (fallback) |
| `heading` | param | — | Optional heading to insert before appended content (e.g. `"## New Research"`) |

**Execution steps:**
1. Resolve note: search index by `title` match, then `noteId` match. If not found → recoverable error.
2. Read existing file from disk.
3. Parse frontmatter; update `modified` to now; recalculate `tokens`.
4. Build append block: if `heading` provided, prepend `\n\n{heading}\n\n`; append `\n\n---\n\n{content}`.
5. Rewrite file with updated frontmatter + original body + append block.
6. Update index entry (`modified`, `excerpt`, `tokens`, `mtime`).
7. Return `content_out` (confirmation) + `result_out` (JSON: `{ noteId, path, totalWordCount, tokens }`).

---

### `memory-search` — Full-text and tag search

**Tool alias:** `memory-search`

**Inputs:**

| Key | Source | Required | Description |
|---|---|---|---|
| `query_in` | input port | — | Search keywords or phrase (optional: takes priority over `query` param) |
| `tags` | param | — | JSON array — only return notes that have ALL these tags |
| `limit` | param | — | Max results (default 5, max 20) |

**Query precedence:** The executor resolves `inputs.query_in ?? params.query`. Either must be non-empty or the operation throws. This mirrors the `goal_in` / `goal` pattern on the ReAct Agent node.

**Scoring algorithm (per index entry):**

```
score = 0
for each query word (lowercased, split on whitespace):
  if word appears in title  → score += 10
  if word is in tags array  → score += 5
  if word appears in excerpt → score += 1 (per occurrence, capped at 5)

relevance = Math.min(100, Math.round((score / maxPossibleScore) * 100))
```

`maxPossibleScore` = `queryWords.length * 20` (all words match title + tags) — keeps relevance on a 0–100 scale.

**Execution steps:**
1. Load and stale-check index.
2. Apply tag filter (AND semantics — note must have all requested tags).
3. Score every remaining entry.
4. Sort descending by score; take top `limit`.
5. Return:
   - `result_out`: JSON array of `{ id, title, path, tags, excerpt, relevance, created, modified }`
   - `content_out`: Formatted text summary ready for LLM consumption:

```
Found 2 notes matching "agent benchmarks":

1. LLM agent benchmarks  [relevance: 95]
   Tags: research, agents
   …up to 500 chars of excerpt…

2. ReAct agent performance data  [relevance: 42]
   Tags: research
   …up to 500 chars of excerpt…
```

**Empty result:** `"No notes found for query: '{query}'. The vault may be empty or try broader search terms."` — never silent.

---

### `memory-read` — Read a single note in full

**Tool alias:** `memory-read`

**Inputs:**

| Key | Source | Required | Description |
|---|---|---|---|
| `query_in` | input port | — | Note title (most convenient from agent) |
| `path` | param | — | Relative path from index (most reliable) |
| `noteId` | param | — | Exact note ID |

**Resolution priority:** `path` → `noteId` → title match in `query_in`.

**Execution steps:**
1. Resolve note (recoverable error if not found).
2. Read file; strip frontmatter block.
3. Return:
   - `content_out` (Text port): raw Markdown body
   - `result_out` (Json port): `{ id, title, tags, folder, created, modified, wordCount, tokens, sourceUrl }`

---

## Tool registration summary

| Canvas node type | Tool alias | `operation` value dispatched |
|---|---|---|
| `obsidian-memory` | `obsidian-memory` | Uses `params.operation` param directly |
| `obsidian-memory` | `memory-write` | Injects `operation: "write"` |
| `obsidian-memory` | `memory-append` | Injects `operation: "append"` |
| `obsidian-memory` | `memory-search` | Injects `operation: "search"` |
| `obsidian-memory` | `memory-read` | Injects `operation: "read"` |

Each alias is a thin wrapper:

```typescript
nodeExecutor.registerCapability("memory-write", (ctx, def) =>
  executeObsidianMemory({ ...ctx, params: { ...ctx.params, operation: "write" } }, def)
);
```

---

## Node definition (canvas)

```
type:     "obsidian-memory"
category: NodeCategory.Memory
label:    "Obsidian Memory"
icon:     "brain"
runtimeKind: Capability

inputs:
  query_in    Text   optional  "Search query or note title"
  content_in  Text   optional  "Content to write or append"

outputs:
  content_out  Text  "Human-readable operation result (shown in Debugger)"
  result_out   Json  "Structured operation result"

parameterSchema:
  Group "Vault":
    vaultPath   string  placeholder:"Default: ./memory — bind-mounted to host"
                        description: "Absolute path inside container. Leave blank to use /app/memory."

  Group "Operation":
    operation   enum    [write, append, search, read]  default: search

  Group "Note":
    title       string
    folder      string  default: "notes"
    tags        json    default: []
    overwrite   boolean default: false

  Group "Search":
    query       string  placeholder: "Search keywords or phrase"
    limit       number  min:1 max:20 default:5

  Group "Append":
    heading     string  placeholder: "## New Research"

  Group "Source":
    sourceUrl   string
```

---

## Error handling

| Scenario | Behavior |
|---|---|
| `vaultPath` directory missing on first write | Auto-create with `fs.mkdir({ recursive: true })` |
| `vaultPath` not readable | Throw: `"Cannot access vault at '{path}': {os reason}"` |
| `memory-append` note not found | Return recoverable string to agent |
| `memory-read` note not found | Return recoverable string to agent |
| Title slug collision, `overwrite: false` | Return recoverable string to agent |
| `content_in` empty on write | Throw (node fails immediately) |
| `_memory_index.json` corrupted / unparseable | Rebuild from full disk scan; emit warning in `metadata` |
| Disk full / permission denied on write | Throw (node fails, run coordinator marks failed) |
| `query_in` empty on search | Throw: `"query is required for memory-search"` |

**Rule:** Bad user input → recoverable string so the agent can self-correct. System/infra failures → thrown Error so the run stops cleanly.

---

## Frontend node (`ObsidianMemoryNode.tsx`)

- **Accent colour:** Emerald / teal (`border-emerald-500`, `bg-emerald-950`)
- **Header:** Brain icon + "Obsidian Memory"; vault path shown in small subdued text below the label
- **Body:** Operation badge (`WRITE` / `APPEND` / `SEARCH` / `READ`) in colour-coded chip; last note title or result count from `debugSnapshot`
- **Ports:** Standard left inputs (`query_in`, `content_in`) / right outputs (`content_out`, `result_out`)
- **Inspector:** Fully schema-driven — no custom inspector code. `vaultPath` is first and most prominent field.
- **React Flow type:** `"obsidian-memory"` — added to `SPECIALIZED_NODE_TYPES` set and `nodeTypes` map

---

## NodePalette

```typescript
[NodeCategory.Memory]: { label: "Memory", order: 0 }
```

Sits at the top of the palette alongside `Agent` (order -1), before `Generation` (order 1).

---

## docker-compose.yml change

```yaml
# Add to both app and worker services under volumes:
- ./memory:/app/memory
```

The `./memory` directory is created automatically by Docker Compose if it doesn't exist.

---

## Manual E2E test guide

**Setup:**
1. Add an `obsidian-memory` node to the canvas
2. Set `vaultPath` to `/app/memory` (or leave blank)
3. Wire a text literal → `content_in`

**Write test:**
- Set `operation: write`, `title: "Test Note"`, content: `"Hello from Agent Studio"`
- Run → check `./memory/notes/test-note.md` exists on host
- Verify `_memory_index.json` contains the entry

**Search test:**
- Set `operation: search`, `query_in: "Hello"`
- Run → `content_out` should contain "Test Note" with relevance > 0

**Append test:**
- Set `operation: append`, `title: "Test Note"`, content: `"Second paragraph"`
- Run → open `./memory/notes/test-note.md`, confirm appended content

**Read test:**
- Set `operation: read`, `query_in: "Test Note"`
- Run → `content_out` has full body, `result_out` has metadata JSON

**ReAct agent integration:**
- Add a ReAct Agent node; set `tools: ["memory-write", "memory-search"]`
- Goal: `"Write a note about ReAct agents, then search for it and summarize what you stored"`
- Run → Debugger shows agent calling `memory-write` then `memory-search`

---

## Phase 3 upgrade path

- Swap the JSON index for SQLite FTS5 (`_memory.db`) — isolated change to `obsidianMemory.ts`, zero impact on node definition or frontend
- Add embedding-based semantic search via the existing LLM adapter layer (`memory-search` gains an optional `semanticApiKey` param)
- `memory-list` tool alias to enumerate all notes (useful for agents doing inventory)
- Daily note creation helper (auto-title = today's date)
