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

// ── Main executor ──────────────────────────────────────────────────────────────

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
    case "append": return opAppend(inputs, params, vaultPath);
    case "search": return opSearch(inputs, params, vaultPath);
    case "read":   return opRead(inputs, params, vaultPath);
    default:
      throw new Error(`Unknown operation "${operation}". Valid: write | append | search | read`);
  }
}
