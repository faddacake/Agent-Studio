/**
 * Generator adapter abstraction.
 *
 * Decouples media generation from the rest of the engine so that underlying
 * providers can be swapped without touching the scoring/ranking pipeline.
 *
 * Image adapters implement `GeneratorAdapter` and are used by Best-of-N and
 * the provider executor for image-generation nodes:
 *   - MockGeneratorAdapter       — deterministic solid-color PNGs; tests/fallback.
 *   - FalGeneratorAdapter        — fal.ai image models (FLUX family).
 *   - ReplicateGeneratorAdapter  — Replicate image models (SDXL, etc.).
 *
 * Video adapters implement the separate `VideoGeneratorAdapter` interface and
 * are used exclusively by the provider executor for video-generation nodes:
 *   - FalVideoGeneratorAdapter   — fal.ai video models (Kling family).
 *
 * The two interfaces are intentionally separate: video generation returns a
 * URL-based result with duration metadata rather than image pixels, and the
 * image-focused Best-of-N/CLIP pipeline has no meaning for video.
 */

import sharp from "sharp";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GenerateOpts {
  prompt: string;
  /** Desired width in pixels. Adapters may round to nearest supported size. */
  width?: number;
  /** Desired height in pixels. */
  height?: number;
  /**
   * Optional seed for reproducibility.
   * Real providers forward this to the model; the mock uses it to derive a
   * deterministic color so the same seed always produces the same image.
   */
  seed?: number;
  /** Desired clip duration in seconds (video adapters only; ignored by image adapters). */
  duration?: number;
  /**
   * Number of diffusion steps. Forwarded to the provider when set.
   * Defaults vary by adapter: Fal → 4, Replicate → 30.
   * The node parameter schema default of 28 is appropriate for most
   * quality models (FLUX Pro, FLUX Dev, SDXL); Schnell works best at 1–4.
   */
  numInferenceSteps?: number;
  /**
   * Classifier-free guidance scale. Forwarded to the provider when set.
   * Controls how closely the output follows the prompt (higher = stricter).
   */
  guidanceScale?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  buffer:   Buffer;
  width:    number;
  height:   number;
  /** MIME type of the generated image (e.g. "image/png", "image/jpeg"). */
  mimeType: string;
}

export interface GeneratorAdapter {
  /** Identifies the adapter; surfaced in node metadata as `generatorKind`. */
  readonly kind: string;
  generate(opts: GenerateOpts): Promise<GeneratedImage>;
}

// ── Mock Adapter ───────────────────────────────────────────────────────────

/**
 * Deterministic solid-color PNG generator.
 *
 * Derives a unique RGB color from `seed` using simple linear arithmetic so
 * that different seeds reliably produce visually distinct images.  This lets
 * the CLIP-scoring step (which ignores pixel content in mock mode) still
 * differentiate candidates by stable collection index.
 */
export class MockGeneratorAdapter implements GeneratorAdapter {
  readonly kind = "mock";

  async generate(opts: GenerateOpts): Promise<GeneratedImage> {
    const seed   = opts.seed ?? 42;
    const width  = opts.width  ?? 64;
    const height = opts.height ?? 64;

    const r = seed % 256;
    const g = (seed * 3 + 71)  % 256;
    const b = (seed * 7 + 113) % 256;

    const buffer = await sharp({
      create: { width, height, channels: 3, background: { r, g, b } },
    })
      .png()
      .toBuffer();

    return { buffer, width, height, mimeType: "image/png" };
  }
}

// ── Fal Adapter ────────────────────────────────────────────────────────────

interface FalApiResponse {
  images: Array<{
    url:          string;
    width?:       number;
    height?:      number;
    content_type?: string;
  }>;
}

/**
 * Fal.ai image generation adapter.
 *
 * Uses a plain `fetch` call — no SDK dependency required.
 * Defaults to `fal-ai/flux/schnell` (4-step FLUX model; fast and free-tier
 * friendly). The model ID is overridable via `modelId`.
 *
 * Activation: set `FAL_API_KEY` environment variable.
 */
export class FalGeneratorAdapter implements GeneratorAdapter {
  readonly kind = "fal";

  constructor(
    private readonly apiKey:  string,
    private readonly modelId: string = "fal-ai/flux/schnell",
  ) {}

  async generate(opts: GenerateOpts): Promise<GeneratedImage> {
    const width  = opts.width  ?? 512;
    const height = opts.height ?? 512;

    // Map pixel dimensions to the nearest supported fal image_size preset.
    const imageSize = width <= 512 && height <= 512 ? "square" : "square_hd";

    const body: Record<string, unknown> = {
      prompt:              opts.prompt || "abstract image",
      image_size:          imageSize,
      num_images:          1,
      num_inference_steps: opts.numInferenceSteps ?? 4,
    };
    if (opts.guidanceScale !== undefined) {
      body.guidance_scale = opts.guidanceScale;
    }
    if (opts.seed !== undefined) {
      body.seed = opts.seed;
    }

    const response = await fetch(`https://fal.run/${this.modelId}`, {
      method:  "POST",
      headers: {
        Authorization:  `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body:   JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Fal API error ${response.status}: ${errorText}`);
    }

    const data      = await response.json() as FalApiResponse;
    const imageInfo = data.images?.[0];

    if (!imageInfo?.url) {
      throw new Error("Fal API returned no images in response");
    }

    // Download the generated image to a Buffer.
    const imageResponse = await fetch(imageInfo.url, { signal: opts.signal });
    if (!imageResponse.ok) {
      throw new Error(
        `Failed to download generated image from Fal CDN: ${imageResponse.status}`,
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    return {
      buffer,
      width:    imageInfo.width  ?? width,
      height:   imageInfo.height ?? height,
      mimeType: imageInfo.content_type ?? "image/jpeg",
    };
  }
}

// ── Replicate Adapter ──────────────────────────────────────────────────────

interface ReplicatePrediction {
  id:      string;
  status:  "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[];
  error?:  string;
}

/**
 * Replicate image generation adapter.
 *
 * Uses synchronous mode (`Prefer: wait`) — Replicate waits up to 60 seconds
 * and returns the completed prediction in the POST response body.  If the
 * prediction does not complete within that window the adapter falls back to
 * polling at 2-second intervals for up to 60 additional seconds.
 *
 * Defaults to `stability-ai/sdxl`.  The model slug (`owner/name`) is
 * overridable via `modelId`.
 *
 * Activation: set `REPLICATE_API_TOKEN` environment variable.
 */
export class ReplicateGeneratorAdapter implements GeneratorAdapter {
  readonly kind = "replicate";

  constructor(
    private readonly apiToken:  string,
    private readonly modelSlug: string = "stability-ai/sdxl",
  ) {}

  async generate(opts: GenerateOpts): Promise<GeneratedImage> {
    // Round to nearest 64 — SDXL produces best results at multiples of 64.
    const width  = Math.round((opts.width  ?? 1024) / 64) * 64;
    const height = Math.round((opts.height ?? 1024) / 64) * 64;

    const input: Record<string, unknown> = {
      prompt:              opts.prompt || "abstract image",
      width,
      height,
      num_inference_steps: opts.numInferenceSteps ?? 30,
    };
    if (opts.guidanceScale !== undefined) {
      input.guidance_scale = opts.guidanceScale;
    }
    if (opts.seed !== undefined) {
      input.seed = opts.seed;
    }

    const [owner, name] = this.modelSlug.split("/");
    const createResponse = await fetch(
      `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          Prefer:         "wait",
        },
        body:   JSON.stringify({ input }),
        signal: opts.signal,
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => "unknown error");
      throw new Error(`Replicate API error ${createResponse.status}: ${errorText}`);
    }

    const prediction = await createResponse.json() as ReplicatePrediction;

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(
        `Replicate generation ${prediction.status}: ${prediction.error ?? "unknown error"}`,
      );
    }

    // Sync mode completed within wait window — grab the first output URL.
    let imageUrl = prediction.output?.[0];

    // Sync mode timed out before completion — poll until the prediction finishes.
    if (!imageUrl && prediction.id) {
      imageUrl = await this.pollUntilComplete(prediction.id, opts.signal);
    }

    if (!imageUrl) {
      throw new Error("Replicate returned no output image URL");
    }

    // Download the generated image to a Buffer.
    const imageResponse = await fetch(imageUrl, { signal: opts.signal });
    if (!imageResponse.ok) {
      throw new Error(
        `Failed to download image from Replicate CDN: ${imageResponse.status}`,
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    return { buffer, width, height, mimeType: "image/png" };
  }

  private async pollUntilComplete(id: string, signal?: AbortSignal): Promise<string> {
    const MAX_ATTEMPTS  = 30; // 30 × 2 s = 60 s max
    const POLL_INTERVAL = 2000;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Abortable sleep.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, POLL_INTERVAL);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });

      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`Replicate poll error ${response.status}: ${errorText}`);
      }

      const prediction = await response.json() as ReplicatePrediction;

      if (prediction.status === "succeeded") {
        const url = prediction.output?.[0];
        if (!url) throw new Error("Replicate succeeded but returned no output URL");
        return url;
      }

      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(
          `Replicate prediction ${prediction.status}: ${prediction.error ?? ""}`,
        );
      }
    }

    throw new Error("Replicate prediction timed out after 60 seconds");
  }
}

// ── Video Types & Adapter ──────────────────────────────────────────────────

/**
 * Result returned by a VideoGeneratorAdapter.
 * Unlike GeneratedImage, video stays as a downloaded buffer with duration
 * metadata; width/height are not meaningful for video artifacts.
 */
export interface GeneratedVideo {
  buffer:       Buffer;
  mimeType:     string;  // "video/mp4"
  durationSecs: number;
}

/**
 * Adapter interface for video-generation models.
 * Intentionally separate from GeneratorAdapter — video adapters are used only
 * by the provider executor and do not participate in the CLIP-scoring pipeline.
 */
export interface VideoGeneratorAdapter {
  readonly kind: string;
  generateVideo(opts: GenerateOpts): Promise<GeneratedVideo>;
}

interface FalVideoApiResponse {
  video: {
    url:           string;
    content_type?: string;
    file_name?:    string;
    file_size?:    number;
  };
}

/**
 * fal.ai video generation adapter.
 *
 * Calls the Kling video API (or any compatible fal.ai video endpoint) via a
 * plain `fetch` — no SDK required.  Defaults to Kling 1.6 standard text-to-video.
 *
 * Duration is clamped to fal.ai's accepted values (5 s or 10 s).
 * Aspect ratio is derived from width/height when provided; defaults to "16:9".
 *
 * Activation: same FAL_API_KEY used for image generation.
 */
export class FalVideoGeneratorAdapter implements VideoGeneratorAdapter {
  readonly kind = "fal-video";

  constructor(
    private readonly apiKey:  string,
    private readonly modelId: string = "fal-ai/kling-video/v1.6/standard/text-to-video",
  ) {}

  async generateVideo(opts: GenerateOpts): Promise<GeneratedVideo> {
    const durationSecs = this.clampDuration(opts.duration ?? 5);
    const aspectRatio  = this.deriveAspectRatio(opts.width, opts.height);

    const body: Record<string, unknown> = {
      prompt:       opts.prompt || "abstract motion",
      duration:     String(durationSecs),
      aspect_ratio: aspectRatio,
    };

    const response = await fetch(`https://fal.run/${this.modelId}`, {
      method:  "POST",
      headers: {
        Authorization:  `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body:   JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Fal video API error ${response.status}: ${errorText}`);
    }

    const data      = await response.json() as FalVideoApiResponse;
    const videoInfo = data.video;

    if (!videoInfo?.url) {
      throw new Error("Fal video API returned no video URL in response");
    }

    // Download the generated video to a Buffer.
    const videoResponse = await fetch(videoInfo.url, { signal: opts.signal });
    if (!videoResponse.ok) {
      throw new Error(
        `Failed to download video from Fal CDN: ${videoResponse.status}`,
      );
    }

    const arrayBuffer = await videoResponse.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    return {
      buffer,
      mimeType:     videoInfo.content_type ?? "video/mp4",
      durationSecs,
    };
  }

  /** Clamp duration to the nearest value fal.ai Kling accepts: 5 or 10 seconds. */
  private clampDuration(secs: number): 5 | 10 {
    return secs <= 7 ? 5 : 10;
  }

  /** Derive fal.ai aspect_ratio string from pixel dimensions (defaults to "16:9"). */
  private deriveAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return "16:9";
    const ratio = width / height;
    if (ratio >= 1.6)  return "16:9";
    if (ratio <= 0.65) return "9:16";
    return "1:1";
  }
}

// ── Replicate Video Adapter ────────────────────────────────────────────────

/**
 * Replicate video generation adapter.
 *
 * Uses the same predictions API as ReplicateGeneratorAdapter (synchronous
 * `Prefer: wait` with polling fallback). Defaults to `minimax/video-01`.
 *
 * The output field is expected to be a URL string (not an array) for some
 * Replicate video models; the adapter handles both shapes.
 *
 * Activation: set `REPLICATE_API_TOKEN` environment variable.
 */
export class ReplicateVideoGeneratorAdapter implements VideoGeneratorAdapter {
  readonly kind = "replicate-video";

  constructor(
    private readonly apiToken:  string,
    private readonly modelSlug: string = "minimax/video-01",
  ) {}

  async generateVideo(opts: GenerateOpts): Promise<GeneratedVideo> {
    const input: Record<string, unknown> = {
      prompt: opts.prompt || "abstract motion",
    };
    if (opts.duration !== undefined) {
      input.duration = opts.duration;
    }

    const [owner, name] = this.modelSlug.split("/");
    const createResponse = await fetch(
      `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          Prefer:         "wait",
        },
        body:   JSON.stringify({ input }),
        signal: opts.signal,
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => "unknown error");
      throw new Error(`Replicate video API error ${createResponse.status}: ${errorText}`);
    }

    const prediction = await createResponse.json() as ReplicatePrediction;

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(
        `Replicate video generation ${prediction.status}: ${prediction.error ?? "unknown error"}`,
      );
    }

    // Sync mode: output may be a URL string or a single-element array.
    let videoUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : (prediction.output as string | undefined);

    // Poll if not completed within the wait window.
    if (!videoUrl && prediction.id) {
      videoUrl = await this.pollUntilComplete(prediction.id, opts.signal);
    }

    if (!videoUrl) {
      throw new Error("Replicate video returned no output URL");
    }

    const videoResponse = await fetch(videoUrl, { signal: opts.signal });
    if (!videoResponse.ok) {
      throw new Error(
        `Failed to download video from Replicate CDN: ${videoResponse.status}`,
      );
    }

    const arrayBuffer = await videoResponse.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    return {
      buffer,
      mimeType:     "video/mp4",
      durationSecs: opts.duration ?? 5,
    };
  }

  private async pollUntilComplete(id: string, signal?: AbortSignal): Promise<string> {
    const MAX_ATTEMPTS  = 30; // 30 × 2 s = 60 s max
    const POLL_INTERVAL = 2000;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, POLL_INTERVAL);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });

      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`Replicate video poll error ${response.status}: ${errorText}`);
      }

      const prediction = await response.json() as ReplicatePrediction;

      if (prediction.status === "succeeded") {
        const url = Array.isArray(prediction.output)
          ? prediction.output[0]
          : (prediction.output as string | undefined);
        if (!url) throw new Error("Replicate video succeeded but returned no output URL");
        return url;
      }

      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(
          `Replicate video prediction ${prediction.status}: ${prediction.error ?? ""}`,
        );
      }
    }

    throw new Error("Replicate video prediction timed out after 60 seconds");
  }
}

// ── Video helpers ──────────────────────────────────────────────────────────

/**
 * fal.ai model IDs that produce video output rather than images.
 * Used by the provider executor to route to the video code path.
 */
const FAL_VIDEO_MODEL_PREFIXES = [
  "fal-ai/kling-video",
] as const;

/**
 * Returns true if the given fal.ai adapterModelId refers to a video model.
 * Used in `runs/route.ts` to decide between the image and video executor paths.
 */
export function isFalVideoModelId(modelId: string): boolean {
  return FAL_VIDEO_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

// ── Factory ────────────────────────────────────────────────────────────────

export interface GeneratorAdapterOptions {
  /** "fal" | "replicate". Ignored when no apiKey is provided. */
  provider?: string;
  /** Provider API key. Absence falls back to MockGeneratorAdapter. */
  apiKey?:   string;
  /** Provider-specific model ID override. */
  modelId?:  string;
}

/**
 * Returns the appropriate GeneratorAdapter for the given options.
 *
 * Priority:
 *   1. provider="fal"       + apiKey (explicit or FAL_API_KEY env)       → FalGeneratorAdapter
 *   2. provider="replicate" + apiKey (explicit or REPLICATE_API_TOKEN env) → ReplicateGeneratorAdapter
 *   3. Fallback → MockGeneratorAdapter
 *
 * This is the primary entry point used by `executeBestOfN` and the provider
 * executor in `runs/route.ts`; tests inject a custom adapter directly via
 * `context.params.__generator`.
 */
export function createGenerator(opts: GeneratorAdapterOptions = {}): GeneratorAdapter {
  const { provider = "fal", modelId } = opts;

  // Resolve API key: explicit option takes precedence over env var.
  const envKey =
    provider === "replicate" ? process.env.REPLICATE_API_TOKEN : process.env.FAL_API_KEY;
  const apiKey = opts.apiKey ?? envKey;

  if (provider === "fal" && apiKey) {
    return new FalGeneratorAdapter(apiKey, modelId || "fal-ai/flux/schnell");
  }

  if (provider === "replicate" && apiKey) {
    return new ReplicateGeneratorAdapter(apiKey, modelId || "stability-ai/sdxl");
  }

  return new MockGeneratorAdapter();
}

/**
 * Returns a VideoGeneratorAdapter for the given options.
 *
 * Supports fal.ai (Kling family) and Replicate (minimax/video-01, etc.).
 * Throws with an actionable error if no API key is available — unlike
 * `createGenerator`, there is no mock fallback for video generation.
 */
export function createVideoGenerator(opts: GeneratorAdapterOptions = {}): VideoGeneratorAdapter {
  const { provider = "fal", modelId } = opts;

  if (provider === "fal") {
    const apiKey = opts.apiKey ?? process.env.FAL_API_KEY;
    if (apiKey) {
      return new FalVideoGeneratorAdapter(
        apiKey,
        modelId || "fal-ai/kling-video/v1.6/standard/text-to-video",
      );
    }
  }

  if (provider === "replicate") {
    const apiKey = opts.apiKey ?? process.env.REPLICATE_API_TOKEN;
    if (apiKey) {
      return new ReplicateVideoGeneratorAdapter(
        apiKey,
        modelId || "minimax/video-01",
      );
    }
  }

  throw new Error(
    `Video provider "${provider}" is not configured. ` +
    `Add your API key in Settings → Providers to run video generation.`,
  );
}
