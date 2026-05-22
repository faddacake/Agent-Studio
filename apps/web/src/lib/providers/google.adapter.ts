import type { ProviderAdapter, ModelExecutionInput, ModelExecutionResult } from "./types";

/**
 * Google AI adapter — supports Gemini Imagen 3 (image) and Veo 3 (video)
 * via the Google AI / Vertex AI REST APIs.
 *
 * Imagen 3: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict
 * Veo 3:    POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * Expects `input.params.__apiKey` to contain the resolved Google AI API key
 * (injected by makeDispatch / nodeJobProcessor before the adapter is called).
 */
export class GoogleAdapter implements ProviderAdapter {
  async generate(input: ModelExecutionInput): Promise<ModelExecutionResult> {
    const apiKey = (input.params?.__apiKey as string | undefined)?.trim();
    if (!apiKey) {
      return {
        status: "error",
        error: 'Provider "google" is not configured. Add your API key in Settings → Providers…',
      };
    }

    const model = (input.params?.model as string | undefined) ?? "imagen-3.0-generate-002";
    const prompt = input.prompt?.trim();

    if (!prompt) {
      return { status: "error", error: "Prompt is required for Google image/video generation" };
    }

    // Route by model family
    if (model.startsWith("imagen")) {
      return this.generateImage(apiKey, model, prompt, input.params ?? {});
    }

    if (model.startsWith("veo")) {
      return this.generateVideo(apiKey, model, prompt, input.params ?? {});
    }

    return { status: "error", error: `Unknown Google model: ${model}` };
  }

  private async generateImage(
    apiKey: string,
    model: string,
    prompt: string,
    params: Record<string, unknown>,
  ): Promise<ModelExecutionResult> {
    const aspectRatio = (params.aspectRatio as string | undefined) ?? "1:1";
    const sampleCount = 1;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount, aspectRatio },
        }),
      });
    } catch (err) {
      return { status: "error", error: `Network error reaching Google AI: ${String(err)}` };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (body as { error?: { message?: string } }).error?.message;
      return {
        status: "error",
        error: errMsg ?? `Google AI error: HTTP ${res.status}`,
      };
    }

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };

    const prediction = data.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      return { status: "error", error: "Google Imagen returned no image data" };
    }

    // Return base64 data URI so the result can be displayed inline
    const mimeType = prediction.mimeType ?? "image/png";
    const dataUri = `data:${mimeType};base64,${prediction.bytesBase64Encoded}`;

    return {
      status: "success",
      output: dataUri,
      metadata: { provider: "google", model, aspectRatio },
    };
  }

  private async generateVideo(
    apiKey: string,
    model: string,
    prompt: string,
    params: Record<string, unknown>,
  ): Promise<ModelExecutionResult> {
    // Veo 3 uses the long-running operations pattern; here we initiate the
    // generation and return the operation name so the caller can poll.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateVideo?key=${apiKey}`;
    const duration = (params.duration as number | undefined) ?? 5;
    const resolution = (params.resolution as string | undefined) ?? "1080p";

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: { text: prompt },
          videoConfig: { durationSeconds: duration, resolution },
        }),
      });
    } catch (err) {
      return { status: "error", error: `Network error reaching Google AI: ${String(err)}` };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (body as { error?: { message?: string } }).error?.message;
      return {
        status: "error",
        error: errMsg ?? `Google Veo error: HTTP ${res.status}`,
      };
    }

    // Returns a long-running operation; output will be polled by the executor
    const data = await res.json() as { name?: string };
    return {
      status: "success",
      output: data.name ?? null,
      metadata: { provider: "google", model, operationId: data.name },
    };
  }
}
