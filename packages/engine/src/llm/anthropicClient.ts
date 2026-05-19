/**
 * Anthropic (Claude) LLM adapter.
 *
 * Uses the Anthropic Messages API directly via fetch — no SDK dependency.
 * https://docs.anthropic.com/en/api/messages
 *
 * Error mapping:
 *   401             → auth
 *   429             → rate_limit
 *   400 "context"   → context_length (input exceeds model limit)
 *   5xx             → server
 *   fetch throws    → network
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";
import { LLMError } from "./llmClient.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Map Anthropic HTTP status + body to a structured LLMError. */
function mapAnthropicError(status: number, body: string): LLMError {
  const lower = body.toLowerCase();

  if (status === 401 || status === 403) {
    return new LLMError(
      `Anthropic authentication error (${status}). Check your API key.`,
      "auth",
      status,
    );
  }
  if (status === 429) {
    return new LLMError(
      `Anthropic rate limit exceeded. Slow down requests or upgrade your plan.`,
      "rate_limit",
      status,
    );
  }
  if (
    status === 400 &&
    (lower.includes("context") || lower.includes("too long") || lower.includes("token"))
  ) {
    return new LLMError(
      `Anthropic context length exceeded. Reduce the conversation history or switch to a model with a larger context window.`,
      "context_length",
      status,
    );
  }
  if (status >= 500) {
    return new LLMError(
      `Anthropic server error (${status}): ${body}`,
      "server",
      status,
    );
  }
  return new LLMError(`Anthropic API error ${status}: ${body}`, "unknown", status);
}

export class AnthropicClient implements LLMTextClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = "claude-3-5-haiku-20241022",
  ) {}

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    // Anthropic requires system messages in a top-level field, not in messages[]
    const systemMsg    = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model:      this.model,
      max_tokens: opts?.maxTokens ?? 1024,
      messages:   userMessages.map((m) => ({ role: m.role, content: m.content })),
      ...(systemMsg ? { system: systemMsg.content } : {}),
      ...(opts?.temperature !== undefined ? { temperature: Math.min(1, Math.max(0, opts.temperature)) } : {}),
      ...(opts?.stop?.length ? { stop_sequences: opts.stop.slice(0, 4) } : {}),
    };

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method:  "POST",
        headers: {
          "x-api-key":         this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type":      "application/json",
        },
        body:   JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (err) {
      throw new LLMError(
        `Anthropic network error: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw mapAnthropicError(res.status, text);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content?.find((c) => c.type === "text");
    if (!textBlock) {
      throw new LLMError("Anthropic response contained no text content", "unknown");
    }

    return textBlock.text;
  }
}
