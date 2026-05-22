import type { ProviderAdapter, ModelExecutionInput, ModelExecutionResult } from "./types";

/**
 * OpenAI image generation adapter.
 *
 * Supports DALL·E 3 (and DALL·E 2 as a fallback) via the
 * OpenAI Images API: POST https://api.openai.com/v1/images/generations
 *
 * Expects `input.params.__apiKey` to contain the resolved API key
 * (injected by makeDispatch / nodeJobProcessor before the adapter is called).
 */
export class OpenAIAdapter implements ProviderAdapter {
  async generate(input: ModelExecutionInput): Promise<ModelExecutionResult> {
    const apiKey = (input.params?.__apiKey as string | undefined)?.trim();
    if (!apiKey) {
      return {
        status: "error",
        error: 'Provider "openai" is not configured. Add your API key in Settings → Providers…',
      };
    }

    const model = (input.params?.model as string | undefined) ?? "dall-e-3";
    const size = (input.params?.size as string | undefined) ?? "1024x1024";
    const quality = (input.params?.quality as string | undefined) ?? "standard";
    const prompt = input.prompt?.trim();

    if (!prompt) {
      return { status: "error", error: "Prompt is required for OpenAI image generation" };
    }

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          quality,
          response_format: "url",
        }),
      });
    } catch (err) {
      return { status: "error", error: `Network error reaching OpenAI: ${String(err)}` };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (body as { error?: { message?: string } }).error?.message;
      return {
        status: "error",
        error: errMsg ?? `OpenAI API error: HTTP ${res.status}`,
      };
    }

    const data = await res.json() as { data?: Array<{ url?: string }> };
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      return { status: "error", error: "OpenAI returned no image URL" };
    }

    return {
      status: "success",
      output: imageUrl,
      metadata: { provider: "openai", model, size },
    };
  }
}
