/**
 * OpenAI (GPT) LLM adapter.
 *
 * Uses the OpenAI Chat Completions API directly via fetch — no SDK dependency.
 * Also used as the base for Grok (xAI) which is OpenAI API-compatible.
 * https://platform.openai.com/docs/api-reference/chat
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIClient implements LLMTextClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = "gpt-4o-mini",
    private readonly baseUrl: string = OPENAI_API_URL,
  ) {}

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    };

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (content == null) {
      throw new Error("OpenAI response contained no content");
    }

    return content;
  }
}
