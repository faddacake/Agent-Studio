/**
 * Ollama (local) LLM adapter.
 *
 * Calls a locally running Ollama server at the configured base URL.
 * No API key required — authentication is handled at the network level.
 * https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";

const OLLAMA_DEFAULT_BASE = "http://localhost:11434";
const OLLAMA_DEFAULT_MODEL = "llama3.2";

export class OllamaClient implements LLMTextClient {
  private readonly chatUrl: string;

  constructor(
    private readonly model: string = OLLAMA_DEFAULT_MODEL,
    baseUrl: string = OLLAMA_DEFAULT_BASE,
  ) {
    this.chatUrl = `${baseUrl.replace(/\/$/, "")}/api/chat`;
  }

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        ...(opts?.maxTokens ? { num_predict: opts.maxTokens } : {}),
      },
    };

    const res = await fetch(this.chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(
        `Ollama error ${res.status}: ${text}. ` +
        `Ensure Ollama is running locally and "${this.model}" is pulled.`,
      );
    }

    const data = (await res.json()) as {
      message?: { content?: string };
    };

    const content = data.message?.content;
    if (!content) {
      throw new Error("Ollama response contained no message content");
    }

    return content;
  }
}
