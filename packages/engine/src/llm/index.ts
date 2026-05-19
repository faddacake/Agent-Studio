/**
 * LLM text adapter layer.
 *
 * All adapters implement LLMTextClient so the ReAct loop is provider-agnostic.
 * Each adapter is a thin fetch wrapper — no external SDK dependencies.
 *
 * Provider defaults:
 *   anthropic → claude-3-5-haiku-20241022
 *   openai    → gpt-4o-mini
 *   grok      → grok-3-mini
 *   ollama    → llama3.2  (local, no key required)
 */

export type { LLMMessage, LLMChatOptions, LLMTextClient } from "./llmClient.js";
export { AnthropicClient } from "./anthropicClient.js";
export { OpenAIClient } from "./openaiClient.js";
export { createGrokClient } from "./grokClient.js";
export { OllamaClient } from "./ollamaClient.js";

import { AnthropicClient } from "./anthropicClient.js";
import { OpenAIClient } from "./openaiClient.js";
import { createGrokClient } from "./grokClient.js";
import { OllamaClient } from "./ollamaClient.js";
import type { LLMTextClient } from "./llmClient.js";

const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: "claude-3-5-haiku-20241022",
  openai:    "gpt-4o-mini",
  grok:      "grok-3-mini",
  ollama:    "llama3.2",
};

/**
 * Create an LLMTextClient for the given provider.
 *
 * @param provider  One of: "anthropic" | "openai" | "grok" | "ollama"
 * @param model     Model name override. Falls back to the provider default when empty.
 * @param apiKey    API key (not required for Ollama).
 * @param ollamaBaseUrl  Override Ollama base URL (default: http://localhost:11434)
 */
export function createLLMClient(
  provider: string,
  model: string | undefined,
  apiKey: string | undefined,
  ollamaBaseUrl?: string,
): LLMTextClient {
  const resolvedModel = (model && model.trim()) || PROVIDER_DEFAULTS[provider] || "";

  switch (provider) {
    case "anthropic":
      if (!apiKey) throw new Error("Anthropic API key is required.");
      return new AnthropicClient(apiKey, resolvedModel);

    case "openai":
      if (!apiKey) throw new Error("OpenAI API key is required.");
      return new OpenAIClient(apiKey, resolvedModel);

    case "grok":
      if (!apiKey) throw new Error("Grok (xAI) API key is required.");
      return createGrokClient(apiKey, resolvedModel);

    case "ollama":
      return new OllamaClient(resolvedModel, ollamaBaseUrl);

    default:
      throw new Error(
        `Unknown LLM provider "${provider}". ` +
        `Supported: anthropic, openai, grok, ollama`,
      );
  }
}
