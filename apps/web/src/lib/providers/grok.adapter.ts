import type { ProviderAdapter, ModelExecutionInput, ModelExecutionResult } from "./types";

/**
 * Grok (xAI) image generation adapter.
 *
 * Uses the xAI Aurora image generation API:
 *   POST https://api.x.ai/v1/images/generations
 *
 * Expects `input.params.__apiKey` to contain the resolved xAI API key
 * (injected by makeDispatch / nodeJobProcessor before the adapter is called).
 */
export class GrokAdapter implements ProviderAdapter {
  async generate(input: ModelExecutionInput): Promise<ModelExecutionResult> {
    const apiKey = (input.params?.__apiKey as string | undefined)?.trim();
    if (!apiKey) {
      return {
        status: "error",
        error: 'Provider "grok" is not configured. Add your API key in Settings → Providers…',
      };
    }

    const model = (input.params?.model as string | undefined) ?? "grok-2-image-1212";
    const prompt = input.prompt?.trim();

    if (!prompt) {
      return { status: "error", error: "Prompt is required for Grok image generation" };
    }

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          response_format: "url",
        }),
      });
    } catch (err) {
      return { status: "error", error: `Network error reaching xAI: ${String(err)}` };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (body as { error?: { message?: string } }).error?.message;
      return {
        status: "error",
        error: errMsg ?? `Grok API error: HTTP ${res.status}`,
      };
    }

    const data = await res.json() as { data?: Array<{ url?: string }> };
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      return { status: "error", error: "Grok returned no image URL" };
    }

    return {
      status: "success",
      output: imageUrl,
      metadata: { provider: "grok", model },
    };
  }
}
