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
  // Snippet in <div class="result__snippet">TEXT</div>
  // URL in the href of result__a (may be a redirect, decode later)

  // Fallback: split on result__body divs using a greedy approach per block
  // Find each result__body section by locating its start and matching the closing tag depth
  const bodyStartRe = /<div class="result__body">/g;
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
  // Match the opening tag of the snippet container (div, a, or span), then extract inner content
  // by finding the correct closing tag at the same depth.
  const snippetStartRe = /<(div|a|span)[^>]*class="result__snippet"[^>]*>/;

  // Extract result blocks by tracking div depth from each result__body start
  let startMatch: RegExpExecArray | null;
  while ((startMatch = bodyStartRe.exec(html)) !== null && results.length < maxResults) {
    const start = startMatch.index;
    let depth = 0;
    let end = start;

    // Walk forward counting open/close div tags to find the matching close
    const divRe = /<\/?div[^>]*>/g;
    divRe.lastIndex = start;
    let divMatch: RegExpExecArray | null;
    while ((divMatch = divRe.exec(html)) !== null) {
      if (divMatch[0].startsWith("</")) {
        depth--;
        if (depth === 0) {
          end = divMatch.index + divMatch[0].length;
          break;
        }
      } else if (!divMatch[0].endsWith("/>")) {
        depth++;
      }
    }
    if (end <= start) continue;

    const block = html.slice(start, end);
    const titleMatch = titleRe.exec(block);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = stripHtmlTags(titleMatch[2]).trim();
    const snippet = extractSnippetContent(block, snippetStartRe);
    const url = decodeUrl(rawUrl);
    if (!url || !title) continue;

    results.push({ title, snippet, url });
  }

  return results;
}

/**
 * Extract the inner content of the first element matching `startRe` (which must
 * capture the tag name in group 1), tracking nested tags of the same name so we
 * correctly find the matching close tag even when the content contains nested
 * elements of the same tag type.
 */
function extractSnippetContent(block: string, startRe: RegExp): string {
  const startMatch = startRe.exec(block);
  if (!startMatch) return "";
  const tagName = startMatch[1];
  const contentStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  const tagRe = new RegExp(`</?${tagName}[^>]*>`, "g");
  tagRe.lastIndex = contentStart;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(block)) !== null) {
    if (tagMatch[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return stripHtmlTags(block.slice(contentStart, tagMatch.index)).trim();
      }
    } else if (!tagMatch[0].endsWith("/>")) {
      depth++;
    }
  }
  // No matching close found — return from content start to end of block
  return stripHtmlTags(block.slice(contentStart)).trim();
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
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
  return ""; // Unknown format — caller's !url guard will filter it out
}

/** Search via DuckDuckGo HTML endpoint. */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentStudio/1.0; web-search-node)",
        "Accept": "text/html",
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`DuckDuckGo responded ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGoHtml(html, maxResults);
}

/** Search via SerpAPI. */
async function searchSerpApi(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult[]> {
  const url = `https://serpapi.com/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&num=${maxResults}&engine=google`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
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
