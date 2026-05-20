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

import type { NodeExecutionContext, NodeDefinition } from "@aistudio/shared";
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
  executeObsidianMemory,
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

// ── Helpers for operation tests ───────────────────────────────────────────────

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

// ── write operation ───────────────────────────────────────────────────────────

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
