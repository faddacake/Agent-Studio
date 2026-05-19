# Obsidian Memory Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, file-based Obsidian-compatible memory node that lets ReAct agents write, append, search, and read Markdown notes via four tool aliases (`memory-write`, `memory-append`, `memory-search`, `memory-read`).

**Architecture:** One `obsidian-memory` canvas node backed by a single executor (`obsidianMemory.ts`) that dispatches to four operation handlers. Notes are Markdown files with YAML frontmatter in a configurable vault directory. A JSON sidecar index (`_memory_index.json`) enables fast keyword + tag search with mtime-based stale detection.

**Tech Stack:** Node.js `fs/promises`, `node:path`, `@aistudio/shared` types, React Flow + Zustand (frontend), Docker bind-mount (`./memory:/app/memory`).

**Spec:** `docs/superpowers/specs/2026-05-19-obsidian-memory-node-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `docker-compose.yml` | Modify | Add `./memory:/app/memory` bind-mount to app + worker |
| `memory/.gitkeep` | Create | Ensure the host directory is tracked in git |
| `packages/shared/src/nodeTypes.ts` | Modify | Add `ObsidianMemory = "obsidian-memory"` |
| `packages/shared/src/nodeDefinition.ts` | Modify | Add `NodeCategory.Memory = "memory"` |
| `packages/shared/src/nodeDefinitions/capabilities.ts` | Modify | Add `obsidianMemoryNode` definition |
| `packages/shared/src/nodeDefinitions/index.ts` | Modify | Export `obsidianMemoryNode` |
| `packages/engine/src/capabilities/obsidianMemory.ts` | Create | Full executor: types, utilities, index management, four operations, main entry |
| `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts` | Create | Unit tests for all pure functions and operations |
| `packages/engine/src/capabilities/index.ts` | Modify | Import + register `executeObsidianMemory` + 4 aliases |
| `packages/engine/src/index.ts` | Modify | Export `executeObsidianMemory` |
| `apps/web/src/components/canvas/ObsidianMemoryNode.tsx` | Create | Specialized React Flow canvas component (emerald theme, op badge) |
| `apps/web/src/components/canvas/WorkflowCanvas.tsx` | Modify | Import `ObsidianMemoryNode`; add to `nodeTypes` |
| `apps/web/src/stores/workflowStore.ts` | Modify | Add `"obsidian-memory"` to `SPECIALIZED_NODE_TYPES` |
| `apps/web/src/components/canvas/NodePalette.tsx` | Modify | Add `[NodeCategory.Memory]` to `CATEGORY_META` |

---

## Task 1: Infrastructure — Add memory bind-mount

**Files:**
- Modify: `docker-compose.yml`
- Create: `memory/.gitkeep`

- [ ] **Step 1.1: Add bind-mount to docker-compose.yml app service**

In `docker-compose.yml`, add one line inside the `app` service `volumes:` block, after the `- .:/app` line:

```yaml
      - ./memory:/app/memory
```

The app service volumes block should look like:
```yaml
    volumes:
      - .:/app
      - ./memory:/app/memory
      - /app/node_modules
      # ... rest of node_modules exclusions unchanged
```

- [ ] **Step 1.2: Add the same bind-mount to the worker service**

In the `worker` service `volumes:` block:
```yaml
    volumes:
      - .:/app
      - ./memory:/app/memory
      - /app/node_modules
      # ... rest unchanged
```

- [ ] **Step 1.3: Create the host-side directory**

```bash
mkdir -p memory
touch memory/.gitkeep
```

- [ ] **Step 1.4: Verify the compose file parses**

```bash
docker compose config --quiet && echo "OK"
```

Expected: `OK` (no YAML parse errors).

- [ ] **Step 1.5: Commit**

```bash
git add docker-compose.yml memory/.gitkeep
git commit -m "feat(infra): add ./memory bind-mount for Obsidian Memory Node vault"
```

---

## Task 2: Shared types — NodeCategory.Memory + NodeType.ObsidianMemory

**Files:**
- Modify: `packages/shared/src/nodeDefinition.ts`
- Modify: `packages/shared/src/nodeTypes.ts`

- [ ] **Step 2.1: Add `Memory` to the `NodeCategory` enum**

In `packages/shared/src/nodeDefinition.ts`, find the `NodeCategory` enum (line 23) and add `Memory` after `Agent`:

```typescript
export enum NodeCategory {
  Agent = "agent",
  Memory = "memory",       // ← add this line
  Generation = "generation",
  Input = "input",
  Output = "output",
  Transform = "transform",
  Utility = "utility",
  Scoring = "scoring",
  Formatting = "formatting",
  Export = "export",
  Annotation = "annotation",
}
```

- [ ] **Step 2.2: Add `ObsidianMemory` to the `NodeType` enum**

In `packages/shared/src/nodeTypes.ts`, add under the `// Agent` comment block:

```typescript
export enum NodeType {
  // Agent
  ReactAgent = "react-agent",

  // Memory
  ObsidianMemory = "obsidian-memory",  // ← add this block

  // Generation
  ImageGeneration = "image-generation",
  VideoGeneration = "video-generation",

  // I/O
  ImageInput = "image-input",
  Output = "output",

  // Transform / Utility
  Resize = "resize",
  Crop = "crop",
  FormatConvert = "format-convert",
  Compositing = "compositing",
  PromptTemplate = "prompt-template",

  // Capabilities
  BestOfN = "best-of-n",
  ClipScoring = "clip-scoring",
  SocialFormat = "social-format",
  ExportBundle = "export-bundle",
  Ranking = "ranking",

  // Annotation
  Comment = "comment",
}
```

- [ ] **Step 2.3: Verify TypeScript compiles**

```bash
pnpm --filter @aistudio/shared typecheck
```

Expected: no errors.

- [ ] **Step 2.4: Commit**

```bash
git add packages/shared/src/nodeDefinition.ts packages/shared/src/nodeTypes.ts
git commit -m "feat(shared): add NodeCategory.Memory and NodeType.ObsidianMemory"
```

---

## Task 3: Shared — `obsidianMemoryNode` definition

**Files:**
- Modify: `packages/shared/src/nodeDefinitions/capabilities.ts`
- Modify: `packages/shared/src/nodeDefinitions/index.ts`

- [ ] **Step 3.1: Add `obsidianMemoryNode` to capabilities.ts**

At the end of `packages/shared/src/nodeDefinitions/capabilities.ts`, before the `capabilityNodes` array, add:

```typescript
/**
 * Obsidian Memory node — file-based persistent knowledge store.
 *
 * Reads and writes Markdown notes (with YAML frontmatter) to a configurable
 * vault directory. A JSON sidecar index (_memory_index.json) enables fast
 * keyword + tag search. Fully compatible with Obsidian and any Markdown editor.
 *
 * Registers as five capabilities:
 *   obsidian-memory  (standalone canvas node)
 *   memory-write     }
 *   memory-append    } Tool aliases for the ReAct Agent
 *   memory-search    }
 *   memory-read      }
 */
export const obsidianMemoryNode: NodeDefinition = {
  type: "obsidian-memory",
  label: "Obsidian Memory",
  category: NodeCategory.Memory,
  description: "Read and write persistent Markdown notes in an Obsidian-compatible vault. Use as a tool with the ReAct Agent for long-term memory.",
  icon: "brain",

  inputs: [
    {
      id: "query_in",
      label: "Query / Title",
      type: PortType.Text,
      required: false,
      description: "Search query (memory-search) or note title (memory-read / memory-append). Takes priority over the query param.",
    },
    {
      id: "content_in",
      label: "Content",
      type: PortType.Text,
      required: false,
      description: "Note body to write or append (memory-write / memory-append).",
    },
  ],
  outputs: [
    {
      id: "content_out",
      label: "Result",
      type: PortType.Text,
      description: "Human-readable operation result — confirmation, search summary, or note body.",
    },
    {
      id: "result_out",
      label: "Structured Result",
      type: PortType.Json,
      description: "Structured JSON: { noteId, path, wordCount, tokens } for write/append; search result array; note metadata for read.",
    },
  ],

  parameterSchema: [
    // ── Vault ──
    {
      key: "vaultPath",
      label: "Vault Path",
      type: "string",
      placeholder: "Default: ./memory — bind-mounted to host",
      description: "Absolute path inside the container. Leave blank to use /app/memory (the default bind-mount). Set MEMORY_VAULT_PATH env var to override globally.",
    },
    // ── Operation ──
    {
      key: "operation",
      label: "Operation",
      type: "enum",
      defaultValue: "search",
      options: [
        { value: "write",  label: "Write Note" },
        { value: "append", label: "Append to Note" },
        { value: "search", label: "Search Notes" },
        { value: "read",   label: "Read Note" },
      ],
      description: "Which memory operation to perform. When used as a ReAct tool alias, this is set automatically.",
    },
    // ── Note ──
    {
      key: "title",
      label: "Note Title",
      type: "string",
      placeholder: "e.g. Research findings on LLM agents",
      description: "Title for write/append/read. Becomes the filename slug. Required for memory-write.",
    },
    {
      key: "folder",
      label: "Folder",
      type: "string",
      defaultValue: "notes",
      description: "Subfolder inside the vault (default: notes). Use / for subfolders e.g. daily/2026.",
    },
    {
      key: "tags",
      label: "Tags",
      type: "json",
      defaultValue: [],
      description: "Array of tag strings for the note, e.g. [\"research\", \"agents\"]. Used for filtering in searches.",
    },
    {
      key: "overwrite",
      label: "Overwrite Existing",
      type: "boolean",
      defaultValue: false,
      description: "If true, replace an existing note with the same title. Default false — returns an error message instead.",
    },
    // ── Search ──
    {
      key: "query",
      label: "Search Query",
      type: "string",
      placeholder: "Search keywords or phrase",
      description: "Keywords to search for. Used when query_in port is not connected.",
    },
    {
      key: "limit",
      label: "Max Results",
      type: "number",
      min: 1,
      max: 20,
      step: 1,
      defaultValue: 5,
      description: "Maximum number of search results to return (default 5).",
    },
    {
      key: "semantic",
      label: "Semantic Search",
      type: "boolean",
      defaultValue: false,
      description: "Reserved for Phase 3 embedding-based search. Has no effect in Phase 2 (keyword search is always used).",
    },
    // ── Append ──
    {
      key: "heading",
      label: "Section Heading",
      type: "string",
      placeholder: "## New Research",
      description: "Optional Markdown heading to insert before the appended content block.",
    },
    // ── Source ──
    {
      key: "sourceUrl",
      label: "Source URL",
      type: "string",
      placeholder: "https://...",
      description: "Optional origin URL stored in frontmatter (useful for web-sourced notes).",
    },
    // ── Append by ID ──
    {
      key: "noteId",
      label: "Note ID",
      type: "string",
      placeholder: "n_1716134400000",
      description: "Exact note ID for memory-append and memory-read when the title is ambiguous.",
    },
    // ── Read by path ──
    {
      key: "path",
      label: "Note Path",
      type: "string",
      placeholder: "notes/my-note.md",
      description: "Relative path from the vault root. Most reliable identifier for memory-read.",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Vault",     fields: ["vaultPath"] },
      { label: "Operation", fields: ["operation"] },
      { label: "Note",      fields: ["title", "folder", "tags", "overwrite"] },
      { label: "Search",    fields: ["query", "limit", "semantic"] },
      { label: "Append",    fields: ["heading"] },
      { label: "Identify",  fields: ["noteId", "path"] },
      { label: "Source",    fields: ["sourceUrl"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["memory", "obsidian", "notes", "agent", "persistent", "markdown"],
  isAvailable: true,
};
```

- [ ] **Step 3.2: Add `obsidianMemoryNode` to the `capabilityNodes` export array**

In the same file, update the array (it currently starts with `reactAgentNode`):

```typescript
export const capabilityNodes: NodeDefinition[] = [
  reactAgentNode,
  obsidianMemoryNode,   // ← add here (second, right after reactAgentNode)
  bestOfNNode,
  clipScoringNode,
  socialFormatNode,
  exportBundleNode,
  rankingNode,
];
```

- [ ] **Step 3.3: Export `obsidianMemoryNode` from the index**

In `packages/shared/src/nodeDefinitions/index.ts`, update the capabilities export line:

```typescript
export {
  reactAgentNode,
  obsidianMemoryNode,   // ← add this
  bestOfNNode,
  clipScoringNode,
  socialFormatNode,
  exportBundleNode,
  rankingNode,
} from "./capabilities.js";
```

- [ ] **Step 3.4: Verify TypeScript**

```bash
pnpm --filter @aistudio/shared typecheck
```

Expected: no errors.

- [ ] **Step 3.5: Commit**

```bash
git add packages/shared/src/nodeDefinitions/capabilities.ts \
        packages/shared/src/nodeDefinitions/index.ts
git commit -m "feat(shared): add obsidianMemoryNode definition with 4-operation schema"
```

---

## Task 4: Engine — Utility functions + test scaffolding

**Files:**
- Create: `packages/engine/src/capabilities/obsidianMemory.ts`
- Create: `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`

- [ ] **Step 4.1: Create the test file with utility tests first (TDD)**

Create `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`:

```typescript
/**
 * Tests for obsidianMemory.ts
 *
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: pnpm --filter @aistudio/engine test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  resolveVaultPath,
  loadIndex,
  saveIndex,
  upsertEntry,
  loadFreshIndex,
  scoreEntry,
  findNote,
} from "../obsidianMemory.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
}

async function cleanTmpVault(vaultPath: string): Promise<void> {
  await fs.rm(vaultPath, { recursive: true, force: true });
}

// ── slugify ───────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    assert.equal(slugify("LLM Agent Benchmarks"), "llm-agent-benchmarks");
  });

  it("strips special characters", () => {
    assert.equal(slugify("Hello, World! (2026)"), "hello-world-2026");
  });

  it("collapses multiple hyphens", () => {
    assert.equal(slugify("foo  bar---baz"), "foo-bar-baz");
  });

  it("returns 'untitled' for empty/whitespace input", () => {
    assert.equal(slugify(""), "untitled");
    assert.equal(slugify("   "), "untitled");
  });

  it("strips leading and trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });
});

// ── parseFrontmatter ─────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("parses a well-formed frontmatter block", () => {
    const raw = `---
id: "n_123"
title: "Test Note"
tags: ["a","b"]
tokens: 42
---

Body content here.`;
    const { frontmatter, body } = parseFrontmatter(raw);
    assert.equal(frontmatter.id, "n_123");
    assert.equal(frontmatter.title, "Test Note");
    assert.deepEqual(frontmatter.tags, ["a", "b"]);
    assert.equal(frontmatter.tokens, 42);
    assert.equal(body, "Body content here.");
  });

  it("returns empty frontmatter and raw string when no YAML block present", () => {
    const raw = "Just plain content.";
    const { frontmatter, body } = parseFrontmatter(raw);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, "Just plain content.");
  });

  it("parses boolean values", () => {
    const raw = `---
published: true
draft: false
---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.equal(frontmatter.published, true);
    assert.equal(frontmatter.draft, false);
  });
});

// ── stringifyFrontmatter ─────────────────────────────────────────────────────

describe("stringifyFrontmatter", () => {
  it("round-trips through parseFrontmatter", () => {
    const fm = {
      id: "n_1",
      title: "My Note",
      tags: ["x", "y"],
      tokens: 10,
    };
    const serialised = stringifyFrontmatter(fm);
    const { frontmatter } = parseFrontmatter(serialised + "\nbody");
    assert.equal(frontmatter.id, "n_1");
    assert.equal(frontmatter.title, "My Note");
    assert.deepEqual(frontmatter.tags, ["x", "y"]);
    assert.equal(frontmatter.tokens, 10);
  });

  it("omits undefined values", () => {
    const serialised = stringifyFrontmatter({ a: "hello", b: undefined });
    assert.ok(!serialised.includes("undefined"));
    assert.ok(serialised.includes("a:"));
    assert.ok(!serialised.includes("b:"));
  });
});

// ── resolveVaultPath ─────────────────────────────────────────────────────────

describe("resolveVaultPath", () => {
  it("uses the vaultPath param when provided", () => {
    assert.equal(resolveVaultPath({ vaultPath: "/custom/path" }), "/custom/path");
  });

  it("returns /app/memory when no param or env is set", () => {
    const orig = process.env.MEMORY_VAULT_PATH;
    delete process.env.MEMORY_VAULT_PATH;
    const result = resolveVaultPath({});
    process.env.MEMORY_VAULT_PATH = orig;
    assert.equal(result, "/app/memory");
  });

  it("prefers param over MEMORY_VAULT_PATH env", () => {
    process.env.MEMORY_VAULT_PATH = "/env/path";
    const result = resolveVaultPath({ vaultPath: "/param/path" });
    delete process.env.MEMORY_VAULT_PATH;
    assert.equal(result, "/param/path");
  });
});

// ── loadIndex / saveIndex / upsertEntry ──────────────────────────────────────

describe("loadIndex", () => {
  it("returns an empty index when the file does not exist", async () => {
    const vault = await makeTmpVault();
    const index = await loadIndex(vault);
    assert.equal(index.version, 1);
    assert.deepEqual(index.entries, []);
    await cleanTmpVault(vault);
  });

  it("returns an empty index when the file is corrupt JSON", async () => {
    const vault = await makeTmpVault();
    await fs.writeFile(path.join(vault, "_memory_index.json"), "not json", "utf8");
    const index = await loadIndex(vault);
    assert.deepEqual(index.entries, []);
    await cleanTmpVault(vault);
  });
});

describe("saveIndex + loadIndex round-trip", () => {
  it("persists and retrieves entries", async () => {
    const vault = await makeTmpVault();
    const index = { version: 1 as const, entries: [] };
    const entry = {
      id: "n_1", title: "Hello", tags: ["x"], folder: "notes",
      path: "notes/hello.md", created: "2026-01-01T00:00:00Z",
      modified: "2026-01-01T00:00:00Z", tokens: 5,
      excerpt: "Hi there", mtime: 1000,
    };
    upsertEntry(index, entry);
    await saveIndex(vault, index);

    const loaded = await loadIndex(vault);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].title, "Hello");
    await cleanTmpVault(vault);
  });
});

describe("upsertEntry", () => {
  it("adds new entries", () => {
    const index = { version: 1 as const, entries: [] };
    const e = { id: "n_1", title: "A", tags: [], folder: "notes", path: "notes/a.md",
      created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z",
      tokens: 1, excerpt: "a", mtime: 0 };
    upsertEntry(index, e);
    assert.equal(index.entries.length, 1);
  });

  it("replaces an entry with the same id", () => {
    const index = { version: 1 as const, entries: [] };
    const e1 = { id: "n_1", title: "A", tags: [], folder: "notes", path: "notes/a.md",
      created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z",
      tokens: 1, excerpt: "a", mtime: 0 };
    const e2 = { ...e1, title: "B" };
    upsertEntry(index, e1);
    upsertEntry(index, e2);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].title, "B");
  });
});

// ── scoreEntry ────────────────────────────────────────────────────────────────

describe("scoreEntry", () => {
  const baseEntry = {
    id: "n_1", title: "LLM agent benchmarks", tags: ["research", "agents"],
    folder: "notes", path: "notes/llm.md",
    created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z",
    tokens: 50, excerpt: "A comprehensive review of LLM agent benchmarks published in 2025.",
    mtime: 0,
  };

  it("returns zero score for empty query words", () => {
    const { score, relevance } = scoreEntry(baseEntry, []);
    assert.equal(score, 0);
    assert.equal(relevance, 0);
  });

  it("scores title match at 10 per word", () => {
    const { score } = scoreEntry(baseEntry, ["benchmarks"]);
    assert.ok(score >= 10); // 10 for title match
  });

  it("scores tag match at 5 per word", () => {
    const { score } = scoreEntry(baseEntry, ["research"]);
    assert.ok(score >= 5); // 5 for tag match
  });

  it("scores excerpt match at 1 per occurrence (capped 5)", () => {
    // "llm" does NOT appear in the title as a standalone match here but appears in excerpt
    const { score } = scoreEntry(baseEntry, ["review"]);
    assert.ok(score >= 1);
  });

  it("relevance is capped at 100", () => {
    const { relevance } = scoreEntry(baseEntry, ["llm", "agent", "benchmarks"]);
    assert.ok(relevance <= 100);
    assert.ok(relevance >= 0);
  });
});

// ── findNote ─────────────────────────────────────────────────────────────────

describe("findNote", () => {
  const entries = [
    { id: "n_1", title: "LLM Agents", tags: [], folder: "notes",
      path: "notes/llm-agents.md", created: "", modified: "", tokens: 0, excerpt: "", mtime: 0 },
    { id: "n_2", title: "React Patterns", tags: [], folder: "notes",
      path: "notes/react-patterns.md", created: "", modified: "", tokens: 0, excerpt: "", mtime: 0 },
  ];
  const index = { version: 1 as const, entries };

  it("finds by path", () => {
    const result = findNote(index, { path: "notes/llm-agents.md" });
    assert.equal(result?.id, "n_1");
  });

  it("finds by noteId", () => {
    const result = findNote(index, { noteId: "n_2" });
    assert.equal(result?.title, "React Patterns");
  });

  it("finds by exact title (case-insensitive)", () => {
    const result = findNote(index, { title: "llm agents" });
    assert.equal(result?.id, "n_1");
  });

  it("finds by partial title match as fallback", () => {
    const result = findNote(index, { title: "react" });
    assert.equal(result?.id, "n_2");
  });

  it("returns undefined for no match", () => {
    assert.equal(findNote(index, { title: "nonexistent" }), undefined);
  });
});
```

- [ ] **Step 4.2: Run the tests — expect FAIL because obsidianMemory.ts doesn't exist yet**

```bash
pnpm --filter @aistudio/engine test 2>&1 | head -30
```

Expected: error like `Cannot find module '../obsidianMemory.js'` — confirms the tests are wired up and failing for the right reason.

- [ ] **Step 4.3: Create `obsidianMemory.ts` with types and utility functions**

Create `packages/engine/src/capabilities/obsidianMemory.ts`:

```typescript
/**
 * Obsidian Memory capability executor.
 *
 * Implements a file-based, Obsidian-compatible knowledge store.
 * Notes are Markdown files with YAML frontmatter. A JSON sidecar
 * index (_memory_index.json) enables fast keyword + tag search.
 *
 * Operations: write | append | search | read
 *
 * Tool aliases registered in capabilities/index.ts:
 *   memory-write, memory-append, memory-search, memory-read
 *
 * Node type: "obsidian-memory"
 */

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@aistudio/shared";

// ── Internal types ─────────────────────────────────────────────────────────────

export interface MemoryIndexEntry {
  id: string;
  title: string;
  tags: string[];
  folder: string;
  /** Path relative to vaultPath */
  path: string;
  created: string;
  modified: string;
  lastUsed?: string;
  sourceUrl?: string;
  tokens: number;
  /** First 500 chars of note body */
  excerpt: string;
  /** fs.stat().mtimeMs for stale detection */
  mtime: number;
}

export interface MemoryIndex {
  version: 1;
  entries: MemoryIndexEntry[];
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/**
 * Convert a title to a URL-safe filename slug.
 * "LLM Agent Benchmarks" → "llm-agent-benchmarks"
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

/** Approximate token count: characters / 4 */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parse YAML frontmatter from a Markdown string.
 * Handles strings, numbers, booleans, and JSON arrays.
 * Returns empty frontmatter and full string as body if no YAML block present.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (rawVal.startsWith("[")) {
      try { fm[key] = JSON.parse(rawVal); } catch { fm[key] = rawVal; }
    } else if (rawVal === "true") {
      fm[key] = true;
    } else if (rawVal === "false") {
      fm[key] = false;
    } else if (rawVal !== "" && !isNaN(Number(rawVal))) {
      fm[key] = Number(rawVal);
    } else {
      // Strip surrounding quotes added by stringifyFrontmatter
      fm[key] = rawVal.replace(/^"(.*)"$/, "$1");
    }
  }

  return { frontmatter: fm, body: match[2].trimStart() };
}

/**
 * Serialize a frontmatter object to a YAML block (---\n...\n---\n\n).
 * Undefined values are omitted. Strings containing special YAML chars
 * are double-quoted.
 */
export function stringifyFrontmatter(fm: Record<string, unknown>): string {
  const YAML_SPECIAL = /[:#{}[\],&*?|<>=!%@`'"]/;
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${JSON.stringify(v)}`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
      const s = String(v);
      if (YAML_SPECIAL.test(s)) return `${k}: "${s.replace(/"/g, '\\"')}"`;
      return `${k}: ${s}`;
    });
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * Resolve the effective vault path from params → env → /app/memory.
 *
 * Priority:
 *   1. node param `vaultPath` (if non-empty)
 *   2. MEMORY_VAULT_PATH environment variable
 *   3. /app/memory  (default bind-mount inside Docker)
 */
export function resolveVaultPath(params: Record<string, unknown>): string {
  const param = (params.vaultPath as string | undefined)?.trim();
  if (param) return param;
  const envPath = process.env.MEMORY_VAULT_PATH?.trim();
  if (envPath) return envPath;
  return "/app/memory";
}
```

- [ ] **Step 4.4: Run the tests — utility tests should pass**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: `slugify`, `parseFrontmatter`, `stringifyFrontmatter`, `resolveVaultPath` tests PASS. Index/scoring/operation tests still FAIL (functions not yet defined).

- [ ] **Step 4.5: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts \
        packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts
git commit -m "test+feat(engine): add obsidianMemory utility functions with passing tests"
```

---

## Task 5: Engine — Index management

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`

Add these functions after `resolveVaultPath` in `obsidianMemory.ts`:

- [ ] **Step 5.1: Add index management functions**

```typescript
// ── Index management ───────────────────────────────────────────────────────────

const INDEX_FILE = "_memory_index.json";
const EMPTY_INDEX: MemoryIndex = { version: 1, entries: [] };

/**
 * Load the sidecar index from disk.
 * Returns an empty index if the file is missing or corrupt.
 */
export async function loadIndex(vaultPath: string): Promise<MemoryIndex> {
  const indexPath = nodePath.join(vaultPath, INDEX_FILE);
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as MemoryIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { ...EMPTY_INDEX, entries: [] };
    }
    return parsed;
  } catch {
    return { ...EMPTY_INDEX, entries: [] };
  }
}

/** Write the sidecar index to disk atomically. */
export async function saveIndex(vaultPath: string, index: MemoryIndex): Promise<void> {
  const indexPath = nodePath.join(vaultPath, INDEX_FILE);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

/**
 * Add or replace an index entry matched by `id`.
 * Mutates the index in-place.
 */
export function upsertEntry(index: MemoryIndex, entry: MemoryIndexEntry): void {
  const idx = index.entries.findIndex((e) => e.id === entry.id);
  if (idx === -1) index.entries.push(entry);
  else index.entries[idx] = entry;
}

/**
 * Re-read a single entry if its mtime has changed.
 * Returns the original entry unchanged if the file is still fresh or unreadable.
 */
async function refreshEntry(
  entry: MemoryIndexEntry,
  vaultPath: string,
): Promise<MemoryIndexEntry> {
  const absPath = nodePath.join(vaultPath, entry.path);
  try {
    const stat = await fs.stat(absPath);
    if (stat.mtimeMs === entry.mtime) return entry;
    const raw = await fs.readFile(absPath, "utf8");
    const { body } = parseFrontmatter(raw);
    return {
      ...entry,
      excerpt: body.slice(0, 500),
      tokens: approxTokens(body),
      mtime: stat.mtimeMs,
    };
  } catch {
    // File disappeared or unreadable — keep stale entry; next write will clean up
    return entry;
  }
}

/**
 * Load the index and refresh any stale entries (mtime mismatch).
 * Only touches entries whose files have been modified externally.
 */
export async function loadFreshIndex(vaultPath: string): Promise<MemoryIndex> {
  const index = await loadIndex(vaultPath);
  const refreshed = await Promise.all(
    index.entries.map((e) => refreshEntry(e, vaultPath)),
  );
  return { ...index, entries: refreshed };
}
```

- [ ] **Step 5.2: Run tests — index tests should now pass**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: `loadIndex`, `saveIndex + loadIndex round-trip`, `upsertEntry` tests all PASS.

- [ ] **Step 5.3: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts
git commit -m "feat(engine): add obsidianMemory index management (loadIndex, saveIndex, upsertEntry)"
```

---

## Task 6: Engine — Scoring + note finder

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`

Add after the index management block:

- [ ] **Step 6.1: Add `scoreEntry` and `findNote`**

```typescript
// ── Scoring ────────────────────────────────────────────────────────────────────

/**
 * Score an index entry against a list of query words.
 *
 * Scoring weights:
 *   - title match:   +10 per query word
 *   - tag match:     +5 per query word
 *   - excerpt match: +1 per occurrence (capped at 5 per word)
 *
 * relevance is a 0–100 normalised score where 100 means every query word
 * matched both the title and tags.
 */
export function scoreEntry(
  entry: MemoryIndexEntry,
  queryWords: string[],
): { score: number; relevance: number } {
  if (queryWords.length === 0) return { score: 0, relevance: 0 };

  const titleLower   = entry.title.toLowerCase();
  const excerptLower = entry.excerpt.toLowerCase();
  const tagsLower    = entry.tags.map((t) => t.toLowerCase());

  let score = 0;
  for (const word of queryWords) {
    const w = word.toLowerCase();
    if (titleLower.includes(w)) score += 10;
    if (tagsLower.includes(w))  score += 5;

    // Count excerpt occurrences, capped at 5
    let occurrences = 0;
    let pos = excerptLower.indexOf(w);
    while (pos !== -1 && occurrences < 5) {
      occurrences++;
      pos = excerptLower.indexOf(w, pos + 1);
    }
    score += occurrences;
  }

  // Max possible: every word matches title (10) + tags (5) = 15 per word
  // We use 20 as ceiling so partial matches don't hit 100 artificially
  const maxPossible = queryWords.length * 20;
  const relevance = Math.min(100, Math.round((score / maxPossible) * 100));
  return { score, relevance };
}

// ── Note locator ───────────────────────────────────────────────────────────────

/**
 * Resolve a note to an index entry using the priority:
 *   path (most reliable) → noteId → exact title → partial title
 */
export function findNote(
  index: MemoryIndex,
  opts: { path?: string; noteId?: string; title?: string },
): MemoryIndexEntry | undefined {
  if (opts.path)   return index.entries.find((e) => e.path === opts.path);
  if (opts.noteId) return index.entries.find((e) => e.id === opts.noteId);
  if (opts.title) {
    const lower = opts.title.toLowerCase();
    return (
      index.entries.find((e) => e.title.toLowerCase() === lower) ??
      index.entries.find((e) => e.title.toLowerCase().includes(lower))
    );
  }
  return undefined;
}
```

- [ ] **Step 6.2: Run tests — scoring + findNote tests should pass**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: `scoreEntry` and `findNote` test groups all PASS.

- [ ] **Step 6.3: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts
git commit -m "feat(engine): add obsidianMemory scoring algorithm and note finder"
```

---

## Task 7: Engine — `memory-write` operation

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`
- Modify: `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`

- [ ] **Step 7.1: Add write operation tests to the test file**

Append to `obsidianMemory.test.ts`:

```typescript
// ── write operation ───────────────────────────────────────────────────────────

// Import the main executor for integration-level op tests
import { executeObsidianMemory } from "../obsidianMemory.js";
import type { NodeExecutionContext, NodeDefinition } from "@aistudio/shared";

function makeCtx(
  vaultPath: string,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
): NodeExecutionContext {
  return {
    nodeId: "test-node",
    runId: "test-run",
    inputs,
    params: { ...params, vaultPath, __nodeType: "obsidian-memory" },
    outputDir: vaultPath,
  };
}

const STUB_DEF = {} as NodeDefinition;

describe("memory-write operation", () => {
  it("creates a note file and index entry", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault,
      { content_in: "Hello from test." },
      { operation: "write", title: "Test Note", folder: "notes" }
    );
    const result = await executeObsidianMemory(ctx, STUB_DEF);

    // File should exist
    const filePath = path.join(vault, "notes", "test-note.md");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(raw.includes("Hello from test."));
    assert.ok(raw.includes("title: Test Note"));

    // Index should have one entry
    const index = await loadIndex(vault);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].title, "Test Note");

    // Outputs should be populated
    assert.ok(typeof result.outputs.content_out === "string");
    const res = result.outputs.result_out as { noteId: string; path: string };
    assert.ok(res.noteId.startsWith("n_"));
    assert.equal(res.path, "notes/test-note.md");

    await cleanTmpVault(vault);
  });

  it("returns a recoverable error if note exists and overwrite is false", async () => {
    const vault = await makeTmpVault();
    const ctx1 = makeCtx(vault, { content_in: "First." }, { operation: "write", title: "Dupe" });
    await executeObsidianMemory(ctx1, STUB_DEF);

    const ctx2 = makeCtx(vault, { content_in: "Second." }, { operation: "write", title: "Dupe", overwrite: false });
    const result = await executeObsidianMemory(ctx2, STUB_DEF);
    assert.ok((result.outputs.content_out as string).includes("already exists"));

    await cleanTmpVault(vault);
  });

  it("overwrites when overwrite: true", async () => {
    const vault = await makeTmpVault();
    const ctx1 = makeCtx(vault, { content_in: "Original." }, { operation: "write", title: "OW Note" });
    await executeObsidianMemory(ctx1, STUB_DEF);

    const ctx2 = makeCtx(vault, { content_in: "Updated." }, { operation: "write", title: "OW Note", overwrite: true });
    await executeObsidianMemory(ctx2, STUB_DEF);

    const filePath = path.join(vault, "notes", "ow-note.md");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(raw.includes("Updated."));
    assert.ok(!raw.includes("Original."));

    await cleanTmpVault(vault);
  });

  it("throws if content is empty", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault, { content_in: "  " }, { operation: "write", title: "Empty" });
    await assert.rejects(
      () => executeObsidianMemory(ctx, STUB_DEF),
      /content_in is required/,
    );
    await cleanTmpVault(vault);
  });
});
```

- [ ] **Step 7.2: Add `opWrite` and the main executor stub to `obsidianMemory.ts`**

Append to `obsidianMemory.ts`:

```typescript
// ── Operations ─────────────────────────────────────────────────────────────────

async function opWrite(
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  vaultPath: string,
  nodeId: string,
): Promise<NodeExecutionResult> {
  const content = (inputs.content_in as string | undefined) ??
                  (params.content    as string | undefined) ?? "";
  if (!content.trim()) {
    throw new Error("content_in is required and cannot be empty for memory-write.");
  }

  const title = (params.title as string | undefined)?.trim();
  if (!title) throw new Error("title param is required for memory-write.");

  const folder    = (params.folder    as string | undefined)?.trim() || "notes";
  const tags      = Array.isArray(params.tags) ? (params.tags as string[]) : [];
  const overwrite = Boolean(params.overwrite);
  const sourceUrl = (params.sourceUrl as string | undefined)?.trim() || undefined;

  const slug    = slugify(title);
  const relPath = `${folder}/${slug}.md`;
  const absPath = nodePath.join(vaultPath, relPath);

  await fs.mkdir(nodePath.dirname(absPath), { recursive: true });

  const index    = await loadIndex(vaultPath);
  const existing = index.entries.find((e) => e.path === relPath);
  if (existing && !overwrite) {
    const msg = `Note "${title}" already exists at ${relPath}. Set overwrite: true to replace it.`;
    return {
      outputs: { content_out: msg, result_out: { error: "already_exists", path: relPath } },
      cost: 0,
      metadata: { operation: "write", outcome: "already_exists" },
    };
  }

  const now    = new Date().toISOString();
  const id     = existing?.id ?? `n_${Date.now()}`;
  const tokens = approxTokens(content);

  const fm: Record<string, unknown> = {
    id, title, tags, folder,
    created:  existing?.created ?? now,
    modified: now,
    source:   nodeId,
    ...(sourceUrl ? { sourceUrl } : {}),
    tokens,
  };

  await fs.writeFile(absPath, stringifyFrontmatter(fm) + content, "utf8");
  const stat = await fs.stat(absPath);

  const entry: MemoryIndexEntry = {
    id, title, tags, folder, path: relPath,
    created:  existing?.created ?? now,
    modified: now,
    sourceUrl,
    tokens,
    excerpt:  content.slice(0, 500),
    mtime:    stat.mtimeMs,
  };
  upsertEntry(index, entry);
  await saveIndex(vaultPath, index);

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const msg = `Note "${title}" written to ${relPath} (${wordCount} words, ${tokens} tokens).`;
  return {
    outputs: { content_out: msg, result_out: { noteId: id, path: relPath, wordCount, tokens } },
    cost: 0,
    metadata: { operation: "write", noteId: id },
  };
}

// ── Main executor (stub — expands with each task) ───────────────────────────────

export async function executeObsidianMemory(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;
  const vaultPath = resolveVaultPath(params);
  await fs.mkdir(vaultPath, { recursive: true });

  const operation = (params.operation as string | undefined) ?? "search";

  switch (operation) {
    case "write":  return opWrite(inputs, params, vaultPath, context.nodeId);
    case "append": throw new Error("append operation not yet implemented");
    case "search": throw new Error("search operation not yet implemented");
    case "read":   throw new Error("read operation not yet implemented");
    default:
      throw new Error(`Unknown operation "${operation}". Valid: write | append | search | read`);
  }
}
```

- [ ] **Step 7.3: Run tests — write tests should pass**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: All `memory-write operation` tests PASS. Append/search/read tests don't exist yet.

- [ ] **Step 7.4: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts \
        packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts
git commit -m "feat(engine): implement memory-write operation with tests"
```

---

## Task 8: Engine — `memory-append` operation

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`
- Modify: `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`

- [ ] **Step 8.1: Add append operation tests**

Append to the test file:

```typescript
// ── append operation ──────────────────────────────────────────────────────────

describe("memory-append operation", () => {
  it("appends content to an existing note", async () => {
    const vault = await makeTmpVault();
    // Create the note first
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "Original content." },
        { operation: "write", title: "Append Target" }),
      STUB_DEF,
    );

    // Append to it
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "Appended paragraph." },
        { operation: "append", title: "Append Target" }),
      STUB_DEF,
    );

    const filePath = path.join(vault, "notes", "append-target.md");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(raw.includes("Original content."));
    assert.ok(raw.includes("Appended paragraph."));

    await cleanTmpVault(vault);
  });

  it("inserts a heading before the appended block when heading param is provided", async () => {
    const vault = await makeTmpVault();
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "Base." }, { operation: "write", title: "Headed" }),
      STUB_DEF,
    );

    await executeObsidianMemory(
      makeCtx(vault, { content_in: "New finding." },
        { operation: "append", title: "Headed", heading: "## New Research" }),
      STUB_DEF,
    );

    const raw = await fs.readFile(path.join(vault, "notes", "headed.md"), "utf8");
    assert.ok(raw.includes("## New Research"));
    assert.ok(raw.includes("New finding."));

    await cleanTmpVault(vault);
  });

  it("returns a recoverable error when the note is not found", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault, { content_in: "data" },
      { operation: "append", title: "Nonexistent Note" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);
    assert.ok((result.outputs.content_out as string).includes("not found"));
    await cleanTmpVault(vault);
  });

  it("updates modified and tokens in the index", async () => {
    const vault = await makeTmpVault();
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "x" }, { operation: "write", title: "TK Note" }),
      STUB_DEF,
    );
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "y".repeat(200) }, { operation: "append", title: "TK Note" }),
      STUB_DEF,
    );
    const index = await loadIndex(vault);
    assert.ok(index.entries[0].tokens > 1);
    await cleanTmpVault(vault);
  });
});
```

- [ ] **Step 8.2: Add `opAppend` to `obsidianMemory.ts` and wire into the switch**

Add `opAppend` function just before the `// ── Main executor` comment, and update the switch:

```typescript
async function opAppend(
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  vaultPath: string,
): Promise<NodeExecutionResult> {
  const content = (inputs.content_in as string | undefined) ??
                  (params.content    as string | undefined) ?? "";
  if (!content.trim()) {
    throw new Error("content_in is required and cannot be empty for memory-append.");
  }

  const title   = (params.title   as string | undefined)?.trim();
  const noteId  = (params.noteId  as string | undefined)?.trim();
  const heading = (params.heading as string | undefined)?.trim();

  const index = await loadFreshIndex(vaultPath);
  const entry = findNote(index, { noteId, title });
  if (!entry) {
    const target = title ?? noteId ?? "(unknown)";
    const msg = `Note "${target}" not found. Use memory-write to create it first.`;
    return {
      outputs: { content_out: msg, result_out: { error: "not_found", target } },
      cost: 0,
      metadata: { operation: "append", outcome: "not_found" },
    };
  }

  const absPath = nodePath.join(vaultPath, entry.path);
  const raw = await fs.readFile(absPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const now          = new Date().toISOString();
  const appendBlock  = heading
    ? `\n\n${heading}\n\n${content}`
    : `\n\n---\n\n${content}`;
  const newBody      = body + appendBlock;
  const newTokens    = approxTokens(newBody);
  const updatedFm    = { ...frontmatter, modified: now, tokens: newTokens };

  await fs.writeFile(absPath, stringifyFrontmatter(updatedFm) + newBody, "utf8");
  const stat = await fs.stat(absPath);

  const updated: MemoryIndexEntry = {
    ...entry,
    modified: now,
    lastUsed: now,
    tokens:   newTokens,
    excerpt:  newBody.slice(0, 500),
    mtime:    stat.mtimeMs,
  };
  upsertEntry(index, updated);
  await saveIndex(vaultPath, index);

  const totalWordCount = newBody.split(/\s+/).filter(Boolean).length;
  const msg = `Appended to "${entry.title}" (${entry.path} — now ${totalWordCount} words).`;
  return {
    outputs: {
      content_out: msg,
      result_out: { noteId: entry.id, path: entry.path, totalWordCount, tokens: newTokens },
    },
    cost: 0,
    metadata: { operation: "append", noteId: entry.id },
  };
}
```

Update the switch in `executeObsidianMemory`:

```typescript
    case "append": return opAppend(inputs, params, vaultPath);
```

- [ ] **Step 8.3: Run tests**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: all `memory-append operation` tests PASS.

- [ ] **Step 8.4: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts \
        packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts
git commit -m "feat(engine): implement memory-append operation with tests"
```

---

## Task 9: Engine — `memory-search` operation

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`
- Modify: `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`

- [ ] **Step 9.1: Add search operation tests**

Append to the test file:

```typescript
// ── search operation ──────────────────────────────────────────────────────────

describe("memory-search operation", () => {
  async function seedVault(vault: string) {
    for (const [title, content, tags] of [
      ["LLM Agent Benchmarks", "A review of LLM agent evaluation frameworks.", ["research", "agents"]],
      ["React Patterns", "Common patterns for React applications.", ["frontend", "react"]],
      ["Transformer Architecture", "How attention mechanisms work in transformers.", ["research", "ml"]],
    ] as [string, string, string[]][]) {
      await executeObsidianMemory(
        makeCtx(vault, { content_in: content }, { operation: "write", title, tags }),
        STUB_DEF,
      );
    }
  }

  it("returns matching notes sorted by relevance", async () => {
    const vault = await makeTmpVault();
    await seedVault(vault);

    const ctx = makeCtx(vault, { query_in: "agent research" }, { operation: "search" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);

    const hits = result.outputs.result_out as Array<{ title: string; relevance: number }>;
    assert.ok(hits.length >= 1);
    // "LLM Agent Benchmarks" should rank first (matches both "agent" in title and "research" in tags)
    assert.equal(hits[0].title, "LLM Agent Benchmarks");

    await cleanTmpVault(vault);
  });

  it("filters by tags (AND semantics)", async () => {
    const vault = await makeTmpVault();
    await seedVault(vault);

    const ctx = makeCtx(vault, { query_in: "architecture" },
      { operation: "search", tags: ["research"] });
    const result = await executeObsidianMemory(ctx, STUB_DEF);

    const hits = result.outputs.result_out as Array<{ title: string }>;
    // Only notes with "research" tag should appear
    for (const h of hits) {
      assert.ok(
        h.title === "LLM Agent Benchmarks" || h.title === "Transformer Architecture",
        `Unexpected title: ${h.title}`,
      );
    }
    await cleanTmpVault(vault);
  });

  it("respects the limit param", async () => {
    const vault = await makeTmpVault();
    await seedVault(vault);

    const ctx = makeCtx(vault, { query_in: "a" }, { operation: "search", limit: 2 });
    const result = await executeObsidianMemory(ctx, STUB_DEF);

    const hits = result.outputs.result_out as unknown[];
    assert.ok(hits.length <= 2);
    await cleanTmpVault(vault);
  });

  it("returns a friendly message when no results", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault, { query_in: "zzz-not-found-xyzzy" }, { operation: "search" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);
    assert.ok((result.outputs.content_out as string).includes("No notes found"));
    await cleanTmpVault(vault);
  });

  it("throws when query is empty", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault, {}, { operation: "search" });
    await assert.rejects(
      () => executeObsidianMemory(ctx, STUB_DEF),
      /query is required/,
    );
    await cleanTmpVault(vault);
  });
});
```

- [ ] **Step 9.2: Add `opSearch` to `obsidianMemory.ts` and wire into the switch**

```typescript
async function opSearch(
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  vaultPath: string,
): Promise<NodeExecutionResult> {
  const query = (
    (inputs.query_in as string | undefined) ??
    (params.query    as string | undefined) ?? ""
  ).trim();
  if (!query) {
    throw new Error("query is required for memory-search. Provide a query_in value or set the query param.");
  }

  const tags  = Array.isArray(params.tags) ? (params.tags as string[]) : [];
  const limit = Math.min(20, Math.max(1, Number(params.limit ?? 5)));

  const index      = await loadFreshIndex(vaultPath);
  const queryWords = query.split(/\s+/).filter(Boolean);

  // Tag filter (AND semantics)
  const filtered = tags.length > 0
    ? index.entries.filter((e) => tags.every((t) => e.tags.includes(t)))
    : index.entries;

  // Score and sort
  const scored = filtered
    .map((e) => ({ entry: e, ...scoreEntry(e, queryWords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) {
    const msg = `No notes found for query: "${query}". The vault may be empty or try broader search terms.`;
    return {
      outputs: { content_out: msg, result_out: [] },
      cost: 0,
      metadata: { operation: "search", query, resultCount: 0 },
    };
  }

  // Build structured result
  const resultOut = scored.map(({ entry, relevance }) => ({
    id:       entry.id,
    title:    entry.title,
    path:     entry.path,
    tags:     entry.tags,
    excerpt:  entry.excerpt,
    relevance,
    created:  entry.created,
    modified: entry.modified,
  }));

  // Update lastUsed for top result
  const topEntry = scored[0].entry;
  const now = new Date().toISOString();
  upsertEntry(index, { ...topEntry, lastUsed: now });
  await saveIndex(vaultPath, index);

  // Build human-readable summary
  const lines: string[] = [
    `Found ${scored.length} note${scored.length !== 1 ? "s" : ""} matching "${query}":`,
    "",
  ];
  for (let i = 0; i < scored.length; i++) {
    const { entry, relevance } = scored[i];
    lines.push(`${i + 1}. ${entry.title}  [relevance: ${relevance}]`);
    if (entry.tags.length > 0) lines.push(`   Tags: ${entry.tags.join(", ")}`);
    lines.push(`   ${entry.excerpt.slice(0, 300).replace(/\n/g, " ")}`);
    lines.push("");
  }
  const contentOut = lines.join("\n").trimEnd();

  return {
    outputs: { content_out: contentOut, result_out: resultOut },
    cost: 0,
    metadata: { operation: "search", query, resultCount: scored.length },
  };
}
```

Update the switch:

```typescript
    case "search": return opSearch(inputs, params, vaultPath);
```

- [ ] **Step 9.3: Run tests**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: all `memory-search operation` tests PASS.

- [ ] **Step 9.4: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts \
        packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts
git commit -m "feat(engine): implement memory-search operation with relevance scoring and tests"
```

---

## Task 10: Engine — `memory-read` operation + finalize executor

**Files:**
- Modify: `packages/engine/src/capabilities/obsidianMemory.ts`
- Modify: `packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts`

- [ ] **Step 10.1: Add read operation tests**

Append to the test file:

```typescript
// ── read operation ────────────────────────────────────────────────────────────

describe("memory-read operation", () => {
  it("returns the note body and metadata", async () => {
    const vault = await makeTmpVault();
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "This is the full body." },
        { operation: "write", title: "Read Me", tags: ["test"] }),
      STUB_DEF,
    );

    const ctx = makeCtx(vault, { query_in: "Read Me" }, { operation: "read" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);

    assert.ok((result.outputs.content_out as string).includes("This is the full body."));
    const meta = result.outputs.result_out as { title: string; tags: string[] };
    assert.equal(meta.title, "Read Me");
    assert.deepEqual(meta.tags, ["test"]);

    await cleanTmpVault(vault);
  });

  it("resolves by path when provided", async () => {
    const vault = await makeTmpVault();
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "By path." }, { operation: "write", title: "Path Note" }),
      STUB_DEF,
    );

    const ctx = makeCtx(vault, {}, { operation: "read", path: "notes/path-note.md" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);
    assert.ok((result.outputs.content_out as string).includes("By path."));
    await cleanTmpVault(vault);
  });

  it("returns a recoverable error when note is not found", async () => {
    const vault = await makeTmpVault();
    const ctx = makeCtx(vault, { query_in: "Ghost Note" }, { operation: "read" });
    const result = await executeObsidianMemory(ctx, STUB_DEF);
    assert.ok((result.outputs.content_out as string).includes("not found"));
    await cleanTmpVault(vault);
  });

  it("updates lastUsed in the index", async () => {
    const vault = await makeTmpVault();
    await executeObsidianMemory(
      makeCtx(vault, { content_in: "Content." }, { operation: "write", title: "LU Note" }),
      STUB_DEF,
    );

    await executeObsidianMemory(
      makeCtx(vault, { query_in: "LU Note" }, { operation: "read" }),
      STUB_DEF,
    );

    const index = await loadIndex(vault);
    assert.ok(typeof index.entries[0].lastUsed === "string");
    await cleanTmpVault(vault);
  });
});
```

- [ ] **Step 10.2: Add `opRead` and finalize the executor switch**

Add `opRead` before the `// ── Main executor` comment:

```typescript
async function opRead(
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  vaultPath: string,
): Promise<NodeExecutionResult> {
  const titleQuery = (inputs.query_in as string | undefined)?.trim();
  const pathParam  = (params.path    as string | undefined)?.trim();
  const noteId     = (params.noteId  as string | undefined)?.trim();

  const index = await loadFreshIndex(vaultPath);
  const entry = findNote(index, { path: pathParam, noteId, title: titleQuery });
  if (!entry) {
    const target = pathParam ?? noteId ?? titleQuery ?? "(unknown)";
    const msg = `Note "${target}" not found. Use memory-search to find available notes.`;
    return {
      outputs: { content_out: msg, result_out: { error: "not_found", target } },
      cost: 0,
      metadata: { operation: "read", outcome: "not_found" },
    };
  }

  const absPath = nodePath.join(vaultPath, entry.path);
  const raw = await fs.readFile(absPath, "utf8");
  const { body } = parseFrontmatter(raw);

  const now = new Date().toISOString();
  upsertEntry(index, { ...entry, lastUsed: now });
  await saveIndex(vaultPath, index);

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  return {
    outputs: {
      content_out: body,
      result_out: {
        id:        entry.id,
        title:     entry.title,
        tags:      entry.tags,
        folder:    entry.folder,
        path:      entry.path,
        created:   entry.created,
        modified:  entry.modified,
        lastUsed:  now,
        sourceUrl: entry.sourceUrl,
        wordCount,
        tokens:    entry.tokens,
      },
    },
    cost: 0,
    metadata: { operation: "read", noteId: entry.id },
  };
}
```

Update the switch in `executeObsidianMemory` to replace the stub line:

```typescript
    case "read": return opRead(inputs, params, vaultPath);
```

- [ ] **Step 10.3: Run the full test suite — all tests should pass**

```bash
pnpm --filter @aistudio/engine test 2>&1
```

Expected: ALL tests pass (slugify, parseFrontmatter, stringifyFrontmatter, resolveVaultPath, loadIndex, saveIndex, upsertEntry, scoreEntry, findNote, memory-write, memory-append, memory-search, memory-read).

- [ ] **Step 10.4: Commit**

```bash
git add packages/engine/src/capabilities/obsidianMemory.ts \
        packages/engine/src/capabilities/__tests__/obsidianMemory.test.ts
git commit -m "feat(engine): implement memory-read, finalize all four operations with full test coverage"
```

---

## Task 11: Engine — Register capability aliases

**Files:**
- Modify: `packages/engine/src/capabilities/index.ts`
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 11.1: Update `capabilities/index.ts`**

Replace the full file with:

```typescript
import { nodeExecutor } from "../executor.js";
import { executeBestOfN }         from "./bestOfN.js";
import { executeClipScoring }     from "./clipScoring.js";
import { executeRanking }         from "./ranking.js";
import { executeSocialFormat }    from "./socialFormat.js";
import { executeExportBundle }    from "./exportBundle.js";
import { executeReactAgent }      from "./reactAgent.js";
import { executeObsidianMemory }  from "./obsidianMemory.js";
import type { NodeDefinition, NodeExecutionContext, NodeExecutionResult } from "@aistudio/shared";

export { executeBestOfN }        from "./bestOfN.js";
export { executeClipScoring }    from "./clipScoring.js";
export { executeRanking }        from "./ranking.js";
export { executeSocialFormat }   from "./socialFormat.js";
export { executeExportBundle }   from "./exportBundle.js";
export { executeReactAgent }     from "./reactAgent.js";
export { executeObsidianMemory } from "./obsidianMemory.js";

export {
  MockGeneratorAdapter,
  FalGeneratorAdapter,
  ReplicateGeneratorAdapter,
  FalVideoGeneratorAdapter,
  createGenerator,
  createVideoGenerator,
  isFalVideoModelId,
} from "./generator.js";
export type {
  GeneratorAdapter,
  VideoGeneratorAdapter,
  GeneratorAdapterOptions,
  GenerateOpts,
  GeneratedImage,
  GeneratedVideo,
} from "./generator.js";

/**
 * Thin alias wrapper: injects a fixed `operation` value and delegates
 * to the main executeObsidianMemory executor.
 */
function makeMemoryAlias(
  operation: string,
): (ctx: NodeExecutionContext, def: NodeDefinition) => Promise<NodeExecutionResult> {
  return (ctx, def) =>
    executeObsidianMemory(
      { ...ctx, params: { ...ctx.params, operation } },
      def,
    );
}

/**
 * Register all built-in capability executors with the node executor.
 *
 * Call once at worker/host startup after the node registry is initialized.
 */
export function registerCapabilityExecutors(): void {
  nodeExecutor.registerCapability("react-agent",    executeReactAgent);
  nodeExecutor.registerCapability("best-of-n",      executeBestOfN);
  nodeExecutor.registerCapability("clip-scoring",   executeClipScoring);
  nodeExecutor.registerCapability("ranking",        executeRanking);
  nodeExecutor.registerCapability("social-format",  executeSocialFormat);
  nodeExecutor.registerCapability("export-bundle",  executeExportBundle);

  // Obsidian Memory — one canvas node type + four focused tool aliases
  nodeExecutor.registerCapability("obsidian-memory", executeObsidianMemory);
  nodeExecutor.registerCapability("memory-write",    makeMemoryAlias("write"));
  nodeExecutor.registerCapability("memory-append",   makeMemoryAlias("append"));
  nodeExecutor.registerCapability("memory-search",   makeMemoryAlias("search"));
  nodeExecutor.registerCapability("memory-read",     makeMemoryAlias("read"));
}
```

- [ ] **Step 11.2: Export `executeObsidianMemory` from the engine index**

In `packages/engine/src/index.ts`, update the capabilities export block to add `executeObsidianMemory`:

```typescript
// ── Capability Executors ──
export {
  registerCapabilityExecutors,
  executeReactAgent,
  executeObsidianMemory,   // ← add this
  executeBestOfN,
  executeClipScoring,
  executeRanking,
  executeSocialFormat,
  executeExportBundle,
  MockGeneratorAdapter,
  FalGeneratorAdapter,
  ReplicateGeneratorAdapter,
  FalVideoGeneratorAdapter,
  createGenerator,
  createVideoGenerator,
  isFalVideoModelId,
} from "./capabilities/index.js";
```

- [ ] **Step 11.3: TypeScript check**

```bash
pnpm --filter @aistudio/engine typecheck
```

Expected: no errors.

- [ ] **Step 11.4: Commit**

```bash
git add packages/engine/src/capabilities/index.ts \
        packages/engine/src/index.ts
git commit -m "feat(engine): register obsidian-memory and 4 tool aliases in capability executor"
```

---

## Task 12: Frontend — `ObsidianMemoryNode.tsx`

**Files:**
- Create: `apps/web/src/components/canvas/ObsidianMemoryNode.tsx`

- [ ] **Step 12.1: Create the component**

Create `apps/web/src/components/canvas/ObsidianMemoryNode.tsx`:

```typescript
"use client";

/**
 * ObsidianMemoryNode — specialized React Flow canvas component for
 * the Obsidian Memory node type.
 *
 * Visual identity:
 *   - Emerald / teal accent border (distinct from violet Agent nodes)
 *   - Brain icon in the header
 *   - Vault path shown below the node label in muted text
 *   - Operation badge (WRITE / APPEND / SEARCH / READ) showing the
 *     active operation from params
 *   - Last result summary (note title written or result count) drawn
 *     from the run debug snapshot when available
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Port } from "@aistudio/shared";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useShallow } from "zustand/react/shallow";

// ── Port colours (shared with CustomNode + AgentNode) ────────────────────────

const PORT_COLORS: Record<string, string> = {
  image:  "#a855f7",
  video:  "#f97316",
  text:   "#22c55e",
  number: "#3b82f6",
  json:   "#eab308",
};

// ── Operation badge ──────────────────────────────────────────────────────────

const OP_STYLES: Record<string, string> = {
  write:  "bg-emerald-900/60 text-emerald-300 border-emerald-700/60",
  append: "bg-teal-900/60 text-teal-300 border-teal-700/60",
  search: "bg-cyan-900/60 text-cyan-300 border-cyan-700/60",
  read:   "bg-sky-900/60 text-sky-300 border-sky-700/60",
};

function OperationBadge({ operation }: { operation: string }) {
  const styleClass = OP_STYLES[operation] ?? "bg-neutral-800/60 text-neutral-400 border-neutral-700/60";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styleClass}`}>
      {operation}
    </span>
  );
}

// ── Brain icon ───────────────────────────────────────────────────────────────

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ObsidianMemoryNodeComponent({ id, data, selected }: NodeProps) {
  const inputs    = (data.inputs    as Port[]) ?? [];
  const outputs   = (data.outputs   as Port[]) ?? [];
  const label     = (data.label     as string) ?? "Obsidian Memory";
  const params    = (data.params    as Record<string, unknown>) ?? {};
  const operation = (params.operation as string | undefined) ?? "search";
  const vaultPath = (params.vaultPath as string | undefined)?.trim() || "/app/memory";

  // Pull last result summary from the debug snapshot
  const { runStatus, lastResult } = useWorkflowStore(useShallow((state) => {
    if (!state.debugSnapshot) return { runStatus: null as string | null, lastResult: null as string | null };
    const node = state.debugSnapshot.nodes.find((n) => n.nodeId === id);
    const contentOut = node?.outputs?.content_out;
    return {
      runStatus:  node?.status ?? null,
      lastResult: typeof contentOut === "string" ? contentOut.split("\n")[0].slice(0, 80) : null,
    };
  }));

  const isRunning   = runStatus === "running";
  const isCompleted = runStatus === "completed";
  const isFailed    = runStatus === "failed";

  const borderClass = isFailed
    ? "border-red-500 ring-1 ring-red-500/30"
    : isRunning
    ? "border-emerald-400/70 ring-1 ring-emerald-400/20"
    : selected
    ? "border-emerald-500 ring-1 ring-emerald-500/30"
    : "border-emerald-800/70 hover:border-emerald-700/80";

  return (
    <div
      className={`relative min-w-[200px] max-w-[260px] rounded-lg border bg-neutral-900 shadow-lg transition-colors ${borderClass}`}
    >
      {/* Input handles */}
      {inputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{
            top: `${((i + 1) / (inputs.length + 1)) * 100}%`,
            background: PORT_COLORS[port.type] ?? "#737373",
            width: 10,
            height: 10,
            border: "2px solid #171717",
          }}
          title={`${port.name} (${port.type})`}
        />
      ))}

      {/* Header */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="flex items-center gap-1.5">
          {/* Status dot */}
          {isRunning   && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Running" />}
          {isCompleted && <span className="h-2 w-2 rounded-full bg-emerald-400" title="Completed" />}
          {isFailed    && <span className="h-2 w-2 rounded-full bg-red-400" title="Failed" />}

          <span className="text-emerald-400"><BrainIcon /></span>

          <span className="flex-1 truncate text-sm font-medium text-neutral-100">{label}</span>

          <OperationBadge operation={operation} />
        </div>

        {/* Vault path */}
        <p className="mt-0.5 truncate text-[9px] text-neutral-600" title={vaultPath}>
          {vaultPath}
        </p>
      </div>

      {/* Last result summary */}
      {lastResult && !isRunning && (
        <div className="border-t border-neutral-800 px-3 py-1.5">
          <p className="truncate text-[10px] text-neutral-400">{lastResult}</p>
        </div>
      )}

      {/* Running indicator */}
      {isRunning && (
        <div className="border-t border-neutral-800 px-3 py-1.5">
          <p className="text-[10px] text-emerald-400 animate-pulse">Working…</p>
        </div>
      )}

      {/* Output handles */}
      {outputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{
            top: `${((i + 1) / (outputs.length + 1)) * 100}%`,
            background: PORT_COLORS[port.type] ?? "#737373",
            width: 10,
            height: 10,
            border: "2px solid #171717",
          }}
          title={`${port.name} (${port.type})`}
        />
      ))}
    </div>
  );
}

export const ObsidianMemoryNode = memo(ObsidianMemoryNodeComponent);
```

- [ ] **Step 12.2: TypeScript check**

```bash
pnpm --filter @aistudio/web typecheck 2>&1 | head -20
```

Expected: no errors in the new file.

- [ ] **Step 12.3: Commit**

```bash
git add apps/web/src/components/canvas/ObsidianMemoryNode.tsx
git commit -m "feat(web): add ObsidianMemoryNode canvas component with emerald theme and operation badge"
```

---

## Task 13: Frontend — Canvas + Palette registration

**Files:**
- Modify: `apps/web/src/components/canvas/WorkflowCanvas.tsx`
- Modify: `apps/web/src/stores/workflowStore.ts`
- Modify: `apps/web/src/components/canvas/NodePalette.tsx`

- [ ] **Step 13.1: Add `ObsidianMemoryNode` import to `WorkflowCanvas.tsx`**

Find the `AgentNode` import line (line ~39) and add after it:

```typescript
import { AgentNode } from "./AgentNode";
import { ObsidianMemoryNode } from "./ObsidianMemoryNode";  // ← add
```

- [ ] **Step 13.2: Register `"obsidian-memory"` in the `nodeTypes` map**

In `WorkflowCanvas.tsx`, find where `nodeTypes` is defined and used. It will look like:

```typescript
const nodeTypes: NodeTypes = useMemo(
  () => ({ custom: CustomNode, "react-agent": AgentNode }),
  [],
);
```

Update it to:

```typescript
const nodeTypes: NodeTypes = useMemo(
  () => ({
    custom:            CustomNode,
    "react-agent":     AgentNode,
    "obsidian-memory": ObsidianMemoryNode,   // ← add
  }),
  [],
);
```

- [ ] **Step 13.3: Add `"obsidian-memory"` to `SPECIALIZED_NODE_TYPES` in `workflowStore.ts`**

In `apps/web/src/stores/workflowStore.ts`, find `SPECIALIZED_NODE_TYPES`:

```typescript
const SPECIALIZED_NODE_TYPES = new Set(["react-agent"]);
```

Update to:

```typescript
const SPECIALIZED_NODE_TYPES = new Set(["react-agent", "obsidian-memory"]);
```

- [ ] **Step 13.4: Add `Memory` category to `NodePalette.tsx`**

In `apps/web/src/components/canvas/NodePalette.tsx`, find `CATEGORY_META` (around line 26) and add the `Memory` entry. Use order `-0.5` so it slots between Agent (-1) and Generation (0) without changing any existing order values:

```typescript
const CATEGORY_META: Record<
  NodeCategory,
  { label: string; order: number }
> = {
  [NodeCategory.Agent]:      { label: "Agent",        order: -1 },
  [NodeCategory.Memory]:     { label: "Memory",        order: -0.5 },  // ← add
  [NodeCategory.Generation]: { label: "Generation",   order: 0 },
  [NodeCategory.Input]:      { label: "Input / Output", order: 1 },
  [NodeCategory.Output]:     { label: "Input / Output", order: 1 },
  [NodeCategory.Transform]:  { label: "Utility",      order: 3 },
  [NodeCategory.Utility]:    { label: "Utility",      order: 3 },
  [NodeCategory.Scoring]:    { label: "Scoring",      order: 4 },
  [NodeCategory.Formatting]: { label: "Formatting",   order: 5 },
  [NodeCategory.Export]:     { label: "Export",       order: 6 },
  [NodeCategory.Annotation]: { label: "Annotation",   order: 7 },
};
```

- [ ] **Step 13.5: TypeScript check**

```bash
pnpm --filter @aistudio/web typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 13.6: Commit**

```bash
git add apps/web/src/components/canvas/WorkflowCanvas.tsx \
        apps/web/src/stores/workflowStore.ts \
        apps/web/src/components/canvas/NodePalette.tsx
git commit -m "feat(web): register ObsidianMemoryNode in canvas, workflowStore, and palette"
```

---

## Manual E2E test plan

Run after merging to main and rebuilding Docker (`docker compose build --no-cache && docker compose up -d`).

**1. Palette check**
- Open the canvas → click **Add Node**
- Expect: **Memory** category appears between Agent and Generation
- Expect: **Obsidian Memory** node visible under Memory

**2. Write note**
- Drop an Obsidian Memory node; set `operation: write`, `title: "E2E Test Note"`, enter content via a connected text literal or the `content_in` port
- Run → check `./memory/notes/e2e-test-note.md` exists on the host
- Open it — verify YAML frontmatter (id, title, tags, created, modified, tokens) and the body content

**3. Index check**
- Open `./memory/_memory_index.json` on the host
- Verify it contains an entry for "E2E Test Note" with non-zero tokens and a valid mtime

**4. Search**
- Create a second node, `operation: search`, `query: "E2E"`
- Run → `content_out` should read "Found 1 note matching "E2E"" with the title and excerpt

**5. Append**
- Create a third node, `operation: append`, `title: "E2E Test Note"`, `heading: "## Extra"`, content: "Appended line."
- Run → open the file on the host — verify "## Extra" heading and "Appended line." are present after the original body

**6. Read**
- Create a fourth node, `operation: read`, `query_in: "E2E Test Note"`
- Run → `content_out` has the full body; `result_out` JSON contains `{ id, title, tags, wordCount, tokens }`

**7. ReAct agent integration**
- Add a ReAct Agent node; set `tools: ["memory-write", "memory-search"]`
- Goal: `"Write a note called 'Agent Self-Test' with content about ReAct agents, then search for it and confirm it was stored"`
- Run → Run Debugger shows `memory-write` and `memory-search` tool calls in the agent's step trace
- Final answer should mention the note title

**8. Error recovery**
- Node with `operation: write`, `title: "E2E Test Note"`, `overwrite: false` — second run
- Expect `content_out` reads "already exists" — node does NOT fail, run completes

**9. Vault path fallback**
- Remove `vaultPath` param → leave blank
- Run any operation → confirms the node uses `/app/memory` (same result as before)

---

## Self-review log

After writing this plan I checked it against the spec (`2026-05-19-obsidian-memory-node-design.md`):

| Spec requirement | Covered by |
|---|---|
| Bind-mount `./memory:/app/memory` | Task 1 |
| `NodeCategory.Memory` + `NodeType.ObsidianMemory` | Task 2 |
| `obsidianMemoryNode` definition with full param schema | Task 3 |
| `vaultPath` resolution order (param → env → /app/memory → /data/memory) | Task 4 step 4.3 |
| `slugify` + frontmatter parse/stringify | Task 4 |
| JSON sidecar index, mtime stale detection | Task 5 |
| Scoring: title=10, tag=5, excerpt=1 (capped 5) per word; relevance 0–100 | Task 6 |
| `memory-write` with overwrite guard | Task 7 |
| `memory-append` with heading + not-found recovery | Task 8 |
| `memory-search` with tag filter + limit + empty result message | Task 9 |
| `memory-read` with path/noteId/title priority; `lastUsed` update | Task 10 |
| Five capability registrations (obsidian-memory + 4 aliases) | Task 11 |
| `ObsidianMemoryNode.tsx` — emerald theme, op badge, vault path display | Task 12 |
| `SPECIALIZED_NODE_TYPES`, `nodeTypes` map, `CATEGORY_META` | Task 13 |
| `sourceUrl` in frontmatter + index | Task 3 (param schema) + Task 7 (opWrite) |
| `lastUsed` in index entries | Task 10 (opRead) + Task 9 (opSearch updates top result) |
| `semantic?: boolean` no-op param for Phase 3 | Task 3 (param schema) |
| All errors: bad input → recoverable string; infra failures → throw | Tasks 7–10 |
| `_memory_index.json` corruption → rebuild | Task 5 (`loadIndex` returns empty on parse failure — full rebuild on next write) |

No gaps found. No placeholders. Type signatures are consistent across all tasks (`MemoryIndexEntry`, `MemoryIndex`, function signatures match between tasks 4–10).
