/**
 * Grok (xAI) LLM adapter.
 *
 * Grok uses an OpenAI-compatible Chat Completions API, so this is a thin
 * wrapper that points the OpenAIClient at the xAI base URL.
 * https://docs.x.ai/api
 */

import { OpenAIClient } from "./openaiClient.js";
import type { LLMTextClient } from "./llmClient.js";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_DEFAULT_MODEL = "grok-3-mini";

export function createGrokClient(
  apiKey: string,
  model: string = GROK_DEFAULT_MODEL,
): LLMTextClient {
  return new OpenAIClient(apiKey, model, GROK_API_URL);
}
