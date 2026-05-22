import type { ProviderAdapter, ModelExecutionInput, ModelExecutionResult } from "./types";
import { FalAdapter } from "./fal.adapter";
import { ReplicateAdapter } from "./replicate.adapter";
import { GoogleAdapter } from "./google.adapter";
import { OpenAIAdapter } from "./openai.adapter";
import { GrokAdapter } from "./grok.adapter";

/**
 * Stub adapter for providers that do not yet have a full execution adapter.
 * Satisfies the ProviderAdapter interface so the registry stays complete
 * for API-key management even before execution is implemented.
 *
 * Returns `{ status: "error" }` with a clear "not yet implemented" message
 * rather than silently returning null — this surfaces in the run's error strip
 * and is a better UX than a mysterious blank result.
 */
class StubAdapter implements ProviderAdapter {
  constructor(private readonly name: string) {}
  async generate(_input: ModelExecutionInput): Promise<ModelExecutionResult> {
    return {
      status: "error",
      error: `Provider "${this.name}" is not configured. Add your API key in Settings → Providers…`,
    };
  }
}

export const providerRegistry: Record<string, ProviderAdapter> = {
  // ── Image & Video Generation ───────────────────────────────────────────────
  fal:        new FalAdapter(),
  replicate:  new ReplicateAdapter(),
  stability:  new StubAdapter("stability"),
  midjourney: new StubAdapter("midjourney"),
  // ── Language Models ────────────────────────────────────────────────────────
  openai:     new OpenAIAdapter(),
  anthropic:  new StubAdapter("anthropic"),
  grok:       new GrokAdapter(),
  ollama:     new StubAdapter("ollama"),
  // ── Multimodal ─────────────────────────────────────────────────────────────
  google:     new GoogleAdapter(),
  // ── Voice & Audio ──────────────────────────────────────────────────────────
  elevenlabs: new StubAdapter("elevenlabs"),
  // ── Cloud Providers ────────────────────────────────────────────────────────
  bedrock:    new StubAdapter("bedrock"),
  azure:      new StubAdapter("azure"),
};

export type ProviderKey = keyof typeof providerRegistry;
