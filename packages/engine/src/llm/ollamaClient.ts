/**
 * Ollama (local) LLM adapter.
 *
 * Calls a locally running Ollama server at the configured base URL.
 * No API key required.
 * https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
 *
 * Error mapping:
 *   404                       → model not found (surfaced as auth/config error)
 *   context overflow (500)    → context_length
 *   other 4xx/5xx             → server
 *   fetch throws              → network (Ollama not running)
 *
 * Note: Ollama temperature range is 0–2 (same as OpenAI); stop sequences
 * are passed via the options.stop array.
 */

import type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";
import { LLMError } from "./llmClient.js";

const OLLAMA_DEFAULT_BASE  = "http://localhost:11434";
const OLLAMA_DEFAULT_MODEL = "llama3.2";

function mapOllamaError(status: number, body: string, model: string): LLMError {
  const lower = body.toLowerCase();

  if (status === 404) {
    return new LLMError(
      `Ollama model "${model}" not found. Run: ollama pull ${model}`,
      "auth", // surfaced to user as a config issue
      status,
    );
  }
  if (
    status === 500 &&
    (lower.includes("context") || lower.includes("kv cache") || lower.includes("prompt is too long"))
  ) {
    return new LLMError(
      `Ollama context length exceeded. Reduce the conversation history or use a model with a larger context window.`,
      "context_length",
      status,
    );
  }
  if (status >= 500) {
    return new LLMError(`Ollama server error (${status}): ${body}`, "server", status);
  }
  return new LLMError(`Ollama error ${status}: ${body}`, "unknown", status);
}

export class OllamaClient implements LLMTextClient {
  private readonly chatUrl: string;

  constructor(
    private readonly model: string = OLLAMA_DEFAULT_MODEL,
    baseUrl: string = OLLAMA_DEFAULT_BASE,
  ) {
    this.chatUrl = `${baseUrl.replace(/\/$/, "")}/api/chat`;
  }

  async chat(messages: LLMMessage[], opts?: LLMChatOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model:    this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream:   false,
      options: {
        ...(opts?.maxTokens    ? { num_predict:  opts.maxTokens }          : {}),
        ...(opts?.temperature !== undefined ? { temperature: Math.min(2, Math.max(0, opts.temperature)) } : {}),
        ...(opts?.stop?.length ? { stop:         opts.stop.slice(0, 4) } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(this.chatUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  opts?.signal,
      });
    } catch (err) {
      throw new LLMError(
        `Ollama network error: ${err instanceof Error ? err.message : String(err)}. ` +
        `Ensure Ollama is running (ollama serve).`,
        "network",
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw mapOllamaError(res.status, text, this.model);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content;
    if (!content) {
      throw new LLMError("Ollama response contained no message content", "unknown");
    }

    return content;
  }
}
