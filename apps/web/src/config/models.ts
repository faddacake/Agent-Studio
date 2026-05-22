export type ModelCategory = "image" | "video" | "voice";

/**
 * Provider identifier — must match a key in providerRegistry.
 * "external" is reserved for providers with no adapter (keeps SOON badge).
 */
export type ModelProvider =
  | "fal"
  | "replicate"
  | "google"
  | "openai"
  | "anthropic"
  | "grok"
  | "ollama"
  | "elevenlabs"
  | "stability"
  | "midjourney"
  | "bedrock"
  | "azure"
  | "external";

export interface ModelOption {
  id: string;
  name: string;
  category: ModelCategory;
  provider: ModelProvider;
  /** Key into providerRegistry — determines which adapter handles execution */
  providerKey: string;
  /** Model identifier used by the provider adapter (e.g. "fal/flux-1.1-pro") */
  adapterModelId: string;
  supported: boolean;
  tags: string[];
  costTier: "low" | "medium" | "high";
  /** Estimated cost per generation in USD */
  estimatedCost: number;
  speedTier: "fast" | "balanced" | "slow";
  qualityTier: "draft" | "production";
  defaultParams: Record<string, unknown>;
}

// ── Image Models ──

export const IMAGE_MODELS: ModelOption[] = [
  {
    id: "flux-1.1-pro",
    name: "FLUX 1.1 Pro",
    category: "image",
    provider: "fal",
    providerKey: "fal",
    adapterModelId: "fal-ai/flux-pro/v1.1",
    supported: true,
    tags: ["recommended", "high-quality"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: { width: 1024, height: 1024, num_inference_steps: 28 },
  },
  {
    id: "flux-schnell",
    name: "FLUX Schnell",
    category: "image",
    provider: "fal",
    providerKey: "fal",
    adapterModelId: "fal-ai/flux/schnell",
    supported: true,
    tags: ["recommended", "fast"],
    costTier: "low",
    estimatedCost: 0.003,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: { width: 1024, height: 1024, num_inference_steps: 4 },
  },
  {
    id: "sdxl",
    name: "Stable Diffusion XL",
    category: "image",
    provider: "replicate",
    providerKey: "replicate",
    adapterModelId: "stability-ai/sdxl",
    supported: true,
    tags: ["versatile"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { width: 1024, height: 1024, num_inference_steps: 30 },
  },
  {
    id: "dall-e-3",
    name: "DALL·E 3",
    category: "image",
    provider: "openai",
    providerKey: "openai",
    adapterModelId: "dall-e-3",
    supported: true,
    tags: ["text-rendering", "creative"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { size: "1024x1024", quality: "hd" },
  },
  {
    id: "gemini-imagen",
    name: "Google Imagen 3",
    category: "image",
    provider: "google",
    providerKey: "google",
    adapterModelId: "imagen-3.0-generate-002",
    supported: true,
    tags: ["google", "multimodal"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: { aspectRatio: "1:1" },
  },
  {
    id: "adobe-firefly",
    name: "Adobe Firefly",
    category: "image",
    provider: "external",
    providerKey: "external",
    adapterModelId: "adobe/firefly",
    supported: false,
    tags: ["commercial-safe", "design"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "recraft-v3",
    name: "Recraft V3",
    category: "image",
    provider: "external",
    providerKey: "external",
    adapterModelId: "recraft/v3",
    supported: false,
    tags: ["vector", "illustration"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "grok-image",
    name: "Grok Aurora",
    category: "image",
    provider: "grok",
    providerKey: "grok",
    adapterModelId: "grok-2-image-1212",
    supported: true,
    tags: ["xai", "photorealistic"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "midjourney-v6",
    name: "Midjourney v6",
    category: "image",
    provider: "external",
    providerKey: "external",
    adapterModelId: "midjourney/v6",
    supported: false,
    tags: ["artistic", "photorealistic"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "midjourney-v5",
    name: "Midjourney v5",
    category: "image",
    provider: "external",
    providerKey: "external",
    adapterModelId: "midjourney/v5",
    supported: false,
    tags: ["artistic"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "dall-e-2",
    name: "DALL·E 2",
    category: "image",
    provider: "external",
    providerKey: "external",
    adapterModelId: "openai/dall-e-2",
    supported: false,
    tags: ["legacy"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: { size: "1024x1024" },
  },
];

// ── Video Models ──

export const VIDEO_MODELS: ModelOption[] = [
  {
    id: "kling-1.6",
    name: "Kling 1.6",
    category: "video",
    provider: "fal",
    providerKey: "fal",
    adapterModelId: "fal-ai/kling-video/v1.6/standard/text-to-video",
    supported: true,
    tags: ["recommended", "fast"],
    costTier: "medium",
    estimatedCost: 0.09,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { duration: 5, aspect_ratio: "16:9" },
  },
  {
    id: "minimax-video-01",
    name: "MiniMax Video-01",
    category: "video",
    provider: "replicate",
    providerKey: "replicate",
    adapterModelId: "minimax/video-01",
    supported: true,
    tags: ["replicate"],
    costTier: "medium",
    estimatedCost: 0.08,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { duration: 5 },
  },
  {
    id: "veo-3",
    name: "Google Veo 3",
    category: "video",
    provider: "google",
    providerKey: "google",
    adapterModelId: "veo-003",
    supported: true,
    tags: ["cutting-edge", "long-form"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: { duration: 5, resolution: "1080p" },
  },
  {
    id: "runway-gen4",
    name: "Runway Gen-4",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "runway/gen-4",
    supported: false,
    tags: ["cinematic", "motion"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: { duration: 4 },
  },
  {
    id: "luma-dream-machine",
    name: "Luma Dream Machine",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "luma/dream-machine",
    supported: false,
    tags: ["3d", "creative"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { duration: 5 },
  },
  {
    id: "kling",
    name: "Kling",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "kuaishou/kling",
    supported: false,
    tags: ["fast", "accessible"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: { duration: 5 },
  },
  {
    id: "pika",
    name: "Pika",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "pika/v2",
    supported: false,
    tags: ["stylized", "short-form"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: { duration: 3 },
  },
  {
    id: "heygen",
    name: "HeyGen",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "heygen/avatar",
    supported: false,
    tags: ["avatar", "talking-head"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "invideo",
    name: "InVideo",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "invideo/v3",
    supported: false,
    tags: ["template", "social"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: {},
  },
  {
    id: "veed-io",
    name: "Veed.io",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "veed/editor",
    supported: false,
    tags: ["editing", "subtitles"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: {},
  },
  {
    id: "synthesia",
    name: "Synthesia",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "synthesia/avatar",
    supported: false,
    tags: ["avatar", "enterprise"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "openai-sora",
    name: "OpenAI Sora",
    category: "video",
    provider: "external",
    providerKey: "external",
    adapterModelId: "openai/sora",
    supported: false,
    tags: ["cutting-edge"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "slow",
    qualityTier: "production",
    defaultParams: {},
  },
];

// ── Voice Models ──

export const VOICE_MODELS: ModelOption[] = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "elevenlabs/v2",
    supported: false,
    tags: ["realistic", "cloning"],
    costTier: "high",
    estimatedCost: 0.12,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: { voice_id: "default", stability: 0.5 },
  },
  {
    id: "azure-neural-tts",
    name: "Azure Neural TTS",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "azure/neural-tts",
    supported: false,
    tags: ["enterprise", "multilingual"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "amazon-polly",
    name: "Amazon Polly",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "aws/polly",
    supported: false,
    tags: ["aws", "ssml"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "fast",
    qualityTier: "draft",
    defaultParams: {},
  },
  {
    id: "gemini-voice",
    name: "Gemini Voice",
    category: "voice",
    provider: "google",
    providerKey: "google",
    adapterModelId: "google/gemini-voice",
    supported: false,
    tags: ["google", "conversational"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "fast",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "murf-ai",
    name: "Murf AI",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "murf/studio",
    supported: false,
    tags: ["studio", "voiceover"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "suno",
    name: "Suno",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "suno/v4",
    supported: false,
    tags: ["music", "singing"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "coqui-xtts",
    name: "Coqui XTTS",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "coqui/xtts-v2",
    supported: false,
    tags: ["open-source", "cloning"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "balanced",
    qualityTier: "draft",
    defaultParams: {},
  },
  {
    id: "typecast",
    name: "Typecast",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "typecast/voice",
    supported: false,
    tags: ["character", "acting"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "production",
    defaultParams: {},
  },
  {
    id: "vall-e",
    name: "VALL-E",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "microsoft/vall-e",
    supported: false,
    tags: ["research", "zero-shot"],
    costTier: "low",
    estimatedCost: 0.02,
    speedTier: "slow",
    qualityTier: "draft",
    defaultParams: {},
  },
  {
    id: "gaga-ai",
    name: "Gaga AI",
    category: "voice",
    provider: "external",
    providerKey: "external",
    adapterModelId: "gaga/lip-sync",
    supported: false,
    tags: ["avatar", "lip-sync"],
    costTier: "medium",
    estimatedCost: 0.05,
    speedTier: "balanced",
    qualityTier: "draft",
    defaultParams: {},
  },
];

// ── Helpers ──

const ALL_MODELS: ModelOption[] = [...IMAGE_MODELS, ...VIDEO_MODELS, ...VOICE_MODELS];

export function getModelsByCategory(category: ModelCategory): ModelOption[] {
  switch (category) {
    case "image":
      return IMAGE_MODELS;
    case "video":
      return VIDEO_MODELS;
    case "voice":
      return VOICE_MODELS;
  }
}

export function getModelById(id: string): ModelOption | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function getDefaultModels(category: ModelCategory): string[] {
  return getModelsByCategory(category)
    .filter((m) => m.supported && m.tags.includes("recommended"))
    .map((m) => m.id);
}

export function getSupportedModels(category: ModelCategory): ModelOption[] {
  return getModelsByCategory(category).filter((m) => m.supported);
}

export function estimateCost(models: ModelOption[]): string {
  const total = models.reduce((sum, m) => sum + m.estimatedCost, 0);
  if (total === 0) return "Free";
  return `~$${total.toFixed(2)}`;
}

export function getModelsWithinBudget(models: ModelOption[], maxBudget: number): ModelOption[] {
  return models.filter((m) => m.estimatedCost <= maxBudget);
}
