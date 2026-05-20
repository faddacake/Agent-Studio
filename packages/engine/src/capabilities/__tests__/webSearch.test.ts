/**
 * Tests for webSearch.ts
 *
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: pnpm --filter @aistudio/engine test
 *
 * No real HTTP requests are made — tests cover pure functions and edge cases only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { NodeExecutionContext } from "@aistudio/shared";
import {
  parseDuckDuckGoHtml,
  formatResultsAsText,
  executeWebSearch,
  type WebSearchResult,
} from "../webSearch.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal DDG-style HTML block for a single result. */
function makeDdgBlock(title: string, snippet: string, url: string): string {
  return `
    <div class="result__body">
      <a class="result__a" href="${url}">${title}</a>
      <a class="result__snippet">${snippet}</a>
    </div>
    </div>
  `;
}

function makeDdgHtml(results: Array<{ title: string; snippet: string; url: string }>): string {
  return results.map((r) => makeDdgBlock(r.title, r.snippet, r.url)).join("\n");
}

function makeCtx(
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
): NodeExecutionContext {
  return {
    nodeId: "test-ws",
    inputs,
    params,
    workflowId: "wf1",
    runId: "r1",
    emit: () => {},
    onAgentStep: undefined,
  } as unknown as NodeExecutionContext;
}

// ── parseDuckDuckGoHtml ───────────────────────────────────────────────────────

describe("parseDuckDuckGoHtml", () => {
  it("parses real-looking DDG HTML and extracts title, snippet, and url", () => {
    const html = makeDdgHtml([
      { title: "OpenAI Blog", snippet: "Latest news from OpenAI about GPT.", url: "https://openai.com/blog" },
    ]);
    const results = parseDuckDuckGoHtml(html, 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "OpenAI Blog");
    assert.equal(results[0].snippet, "Latest news from OpenAI about GPT.");
    assert.equal(results[0].url, "https://openai.com/blog");
  });

  it("respects maxResults and returns at most that many results", () => {
    const html = makeDdgHtml([
      { title: "Result 1", snippet: "Snippet 1", url: "https://example.com/1" },
      { title: "Result 2", snippet: "Snippet 2", url: "https://example.com/2" },
      { title: "Result 3", snippet: "Snippet 3", url: "https://example.com/3" },
      { title: "Result 4", snippet: "Snippet 4", url: "https://example.com/4" },
      { title: "Result 5", snippet: "Snippet 5", url: "https://example.com/5" },
    ]);
    const results = parseDuckDuckGoHtml(html, 3);
    assert.equal(results.length, 3);
  });

  it("returns empty array for empty HTML", () => {
    const results = parseDuckDuckGoHtml("", 5);
    assert.deepEqual(results, []);
  });

  it("strips HTML tags from title and snippet", () => {
    const html = makeDdgHtml([
      {
        title: "<b>AI</b> &amp; <em>Agents</em>",
        snippet: "<span>Deep &lt;learning&gt;</span> overview",
        url: "https://example.com/ai",
      },
    ]);
    const results = parseDuckDuckGoHtml(html, 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "AI & Agents");
    assert.equal(results[0].snippet, "Deep <learning> overview");
  });
});

// ── formatResultsAsText ───────────────────────────────────────────────────────

describe("formatResultsAsText", () => {
  it("formats a result array as numbered text with title, snippet, and url", () => {
    const results: WebSearchResult[] = [
      { title: "OpenAI Blog", snippet: "News from OpenAI.", url: "https://openai.com/blog" },
      { title: "Anthropic", snippet: "AI safety company.", url: "https://anthropic.com" },
    ];
    const text = formatResultsAsText(results);
    assert.ok(text.includes("1. **OpenAI Blog**"));
    assert.ok(text.includes("News from OpenAI."));
    assert.ok(text.includes("https://openai.com/blog"));
    assert.ok(text.includes("2. **Anthropic**"));
    assert.ok(text.includes("AI safety company."));
    assert.ok(text.includes("https://anthropic.com"));
  });

  it("returns \"No results found.\" for an empty array", () => {
    assert.equal(formatResultsAsText([]), "No results found.");
  });
});

// ── executeWebSearch ──────────────────────────────────────────────────────────

describe("executeWebSearch", () => {
  it("returns empty outputs when no query is provided", async () => {
    const ctx = makeCtx({}, {});
    const result = await executeWebSearch(ctx, {} as never);
    assert.deepEqual(result.outputs.results_out, []);
    assert.equal(result.outputs.content_out, "No search query provided.");
    assert.equal((result.metadata as Record<string, unknown>)?.provider, "none");
    assert.equal((result.metadata as Record<string, unknown>)?.resultCount, 0);
  });

  it("throws when provider is serpapi and no apiKey is provided", async () => {
    // Temporarily clear SERPAPI_KEY from env if set
    const origKey = process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_KEY;

    const ctx = makeCtx({}, { query: "test query", provider: "serpapi" });

    await assert.rejects(
      () => executeWebSearch(ctx, {} as never),
      /SerpAPI provider requires an API key/,
    );

    // Restore env
    if (origKey !== undefined) process.env.SERPAPI_KEY = origKey;
  });
});
