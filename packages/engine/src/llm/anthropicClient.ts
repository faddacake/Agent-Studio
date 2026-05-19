/**
 * Anthropic (Claude) LLM adapter.
 *
 * Uses the Anthropic Messages API directly via fetch — no SDK dependency.
 * https://docs.anthropic.com/en/api/messages
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicClient implements LLMTextClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = "claude-3-5-haiku-20241022",
  ) {}

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    // Anthropic requires system messages in a top-level field, not in messages[]
    const systemMsg = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const body = {
      model: this.model,
      max_tokens: opts?.maxTokens ?? 1024,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content?.find((c) => c.type === "text");
    if (!textBlock) {
      throw new Error("Anthropic response contained no text content");
    }

    return textBlock.text;
  }
}
