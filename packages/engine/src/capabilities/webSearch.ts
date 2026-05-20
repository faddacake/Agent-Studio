/**
 * Web Search capability executor.
 *
 * Supports two providers:
 *   - duckduckgo (default): scrapes https://html.duckduckgo.com/html/ — no API key needed.
 *   - serpapi: calls https://serpapi.com/search — requires SERPAPI_KEY env var or apiKey param.
 *
 * Returns:
 *   results_out: WebSearchResult[]   — structured array
 *   content_out: string              — LLM-readable text (one result per line)
 */

import type { NodeDefinition, NodeExecutionContext, NodeExecutionResult } from "@aistudio/shared";

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** Parse DuckDuckGo HTML response — no external HTML parser, pure regex. */
export function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // DDG HTML wraps results in <div class="result__body">
  // Title in <a class="result__a" href="...">TEXT</a>
  // Snippet in <a class="result__snippet">TEXT</a>
  // URL in the href of result__a (may be a redirect, decode later)

  const resultBlockRe = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = resultBlockRe.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];
    const titleMatch = titleRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = stripHtmlTags(titleMatch[2]).trim();
    const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]).trim() : "";

    // DDG may wrap the URL in a redirect; decode if needed
    const url = decodeUrl(rawUrl);
    if (!url || !title) continue;

    results.push({ title, snippet, url });
  }

  return results;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeUrl(raw: string): string {
  // DDG sometimes wraps URLs in "//duckduckgo.com/l/?uddg=<encoded>"
  if (raw.includes("uddg=")) {
    const m = /uddg=([^&]+)/.exec(raw);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch { /* ignore */ }
    }
  }
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("//")) return "https:" + raw;
  return raw;
}

/** Search via DuckDuckGo HTML endpoint. */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IteraStudio/1.0; web-search-node)",
      "Accept": "text/html",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo responded ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGoHtml(html, maxResults);
}

/** Search via SerpAPI. */
async function searchSerpApi(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult[]> {
  const url = `https://serpapi.com/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&num=${maxResults}&engine=google`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`SerpAPI responded ${res.status}`);
  const data = await res.json() as { organic_results?: Array<{ title?: string; snippet?: string; link?: string }> };
  return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "",
    snippet: r.snippet ?? "",
    url: r.link ?? "",
  }));
}

/** Format results as LLM-readable text. */
export function formatResultsAsText(results: WebSearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
    .join("\n\n");
}

/** Main executor — invoked by the RunCoordinator. */
export async function executeWebSearch(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // Resolve query
  const query = ((inputs.query_in as string | undefined) ?? (params.query as string | undefined) ?? "").trim();
  if (!query) {
    return {
      outputs: { results_out: [], content_out: "No search query provided." },
      metadata: { provider: "none", resultCount: 0 },
    };
  }

  const provider = (params.provider as string | undefined) ?? "duckduckgo";
  const maxResults = Math.min(Math.max(Number(params.maxResults ?? 5), 1), 10);
  const apiKey = (params.apiKey as string | undefined) ?? process.env.SERPAPI_KEY ?? "";

  let results: WebSearchResult[];
  if (provider === "serpapi") {
    if (!apiKey) throw new Error("SerpAPI provider requires an API key (param apiKey or env SERPAPI_KEY).");
    results = await searchSerpApi(query, maxResults, apiKey);
  } else {
    results = await searchDuckDuckGo(query, maxResults);
  }

  const content_out = formatResultsAsText(results);

  return {
    outputs: { results_out: results, content_out },
    metadata: { provider, resultCount: results.length, query },
  };
}
