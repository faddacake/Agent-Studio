/**
 * OpenAI (GPT) LLM adapter.
 *
 * Uses the OpenAI Chat Completions API directly via fetch — no SDK dependency.
 * Also the base for Grok (xAI), which is fully OpenAI API-compatible.
 * https://platform.openai.com/docs/api-reference/chat
 *
 * Error mapping:
 *   401                          → auth
 *   429                          → rate_limit
 *   400 "context_length_exceeded"
 *   or "maximum context length"  → context_length
 *   5xx                          → server
 *   fetch throws                 → network
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";
import { LLMError } from "./llmClient.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Map OpenAI-compatible HTTP status + body to a structured LLMError. */
function mapOpenAIError(status: number, body: string, providerName: string): LLMError {
  const lower = body.toLowerCase();

  if (status === 401 || status === 403) {
    return new LLMError(
      `${providerName} authentication error (${status}). Check your API key.`,
      "auth",
      status,
    );
  }
  if (status === 429) {
    return new LLMError(
      `${providerName} rate limit exceeded. Slow down requests or upgrade your plan.`,
      "rate_limit",
      status,
    );
  }
  if (
    status === 400 &&
    (lower.includes("context_length_exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("context window"))
  ) {
    return new LLMError(
      `${providerName} context length exceeded. Reduce the conversation history or switch to a model with a larger context window.`,
      "context_length",
      status,
    );
  }
  if (status >= 500) {
    return new LLMError(`${providerName} server error (${status}): ${body}`, "server", status);
  }
  return new LLMError(`${providerName} API error ${status}: ${body}`, "unknown", status);
}

export class OpenAIClient implements LLMTextClient {
  /**
   * @param apiKey       API key for authentication.
   * @param model        Model name (default: gpt-4o-mini).
   * @param baseUrl      Full chat completions URL. Override for Grok, Azure, etc.
   * @param providerName Display name used in error messages (default: "OpenAI").
   */
  constructor(
    private readonly apiKey: string,
    private readonly model: string = "gpt-4o-mini",
    private readonly baseUrl: string = OPENAI_CHAT_URL,
    private readonly providerName: string = "OpenAI",
  ) {}

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model:    this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(opts?.maxTokens    ? { max_tokens:   opts.maxTokens }         : {}),
      ...(opts?.temperature !== undefined ? { temperature: Math.min(2, Math.max(0, opts.temperature)) } : {}),
      ...(opts?.stop?.length ? { stop:         opts.stop.slice(0, 4) } : {}),
    };

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body:   JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (err) {
      throw new LLMError(
        `${this.providerName} network error: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw mapOpenAIError(res.status, text, this.providerName);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (content == null) {
      throw new LLMError(`${this.providerName} response contained no content`, "unknown");
    }

    return content;
  }
}
