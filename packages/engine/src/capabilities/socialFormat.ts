import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  CandidateItem,
} from "@iterastudio/shared";
import {
  ensureCollection,
  attachCollectionMetadata,
  toCollection,
} from "@iterastudio/shared";

// ── Platform content specs ──

interface PlatformSpec {
  maxCaptionLength: number;
  hashtagCount: number;
  imageAspect: string;
  imageSize: { width: number; height: number };
}

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  instagram: { maxCaptionLength: 2200, hashtagCount: 15, imageAspect: "1:1", imageSize: { width: 1080, height: 1080 } },
  x: { maxCaptionLength: 280, hashtagCount: 3, imageAspect: "16:9", imageSize: { width: 1200, height: 675 } },
  linkedin: { maxCaptionLength: 3000, hashtagCount: 5, imageAspect: "1.91:1", imageSize: { width: 1200, height: 628 } },
  tiktok: { maxCaptionLength: 2200, hashtagCount: 8, imageAspect: "9:16", imageSize: { width: 1080, height: 1920 } },
  youtubeShorts: { maxCaptionLength: 100, hashtagCount: 3, imageAspect: "9:16", imageSize: { width: 1080, height: 1920 } },
  generic: { maxCaptionLength: 500, hashtagCount: 5, imageAspect: "16:9", imageSize: { width: 1200, height: 675 } },
};

// ── Per-platform variant ──

interface SocialVariant {
  platform: string;
  caption: string;
  hook: string;
  hashtags: string[];
  cta: string;
  title: string;
  shortDescription: string;
  imageSpec: PlatformSpec["imageSize"] & { aspect: string };
}

// ── Mock formatting logic ──

function generateHashtags(topic: string, platform: string, count: number): string[] {
  const baseTopics = topic ? topic.split(/[,\s]+/).filter(Boolean) : ["content", "ai"];
  const platformTag = `${platform}content`;
  const tags = [platformTag, ...baseTopics.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))];
  // Pad with generic tags
  const generic = ["aiart", "creative", "digital", "trending", "viral", "fyp", "instagood", "explore"];
  while (tags.length < count) {
    const next = generic[tags.length % generic.length];
    if (!tags.includes(next)) tags.push(next);
    else tags.push(`${next}${tags.length}`);
  }
  return tags.slice(0, count).map((t) => `#${t}`);
}

function generateCaption(
  prompt: string | undefined,
  platform: string,
  spec: PlatformSpec,
  tone: string,
  rank?: number,
): string {
  const subject = prompt ?? "this creation";
  const rankNote = rank ? ` [Ranked #${rank}]` : "";
  const tonePrefix = tone === "professional" ? "Introducing: " :
                     tone === "casual" ? "Check this out — " :
                     tone === "bold" ? "You need to see this. " :
                     "";
  const raw = `${tonePrefix}${subject}${rankNote}`;
  return raw.length > spec.maxCaptionLength
    ? raw.slice(0, spec.maxCaptionLength - 3) + "..."
    : raw;
}

function generateHook(prompt: string | undefined, tone: string): string {
  const subject = prompt ?? "this";
  if (tone === "bold") return `Stop scrolling. ${subject} is here.`;
  if (tone === "casual") return `Wait till you see ${subject}!`;
  return `Discover ${subject}`;
}

function generateCTA(platform: string, includeCTA: boolean): string {
  if (!includeCTA) return "";
  const ctas: Record<string, string> = {
    instagram: "Double-tap if you agree!",
    x: "RT if this resonates.",
    linkedin: "Share your thoughts below.",
    tiktok: "Follow for more!",
    youtubeShorts: "Subscribe for more!",
    generic: "Let us know what you think!",
  };
  return ctas[platform] ?? ctas.generic;
}

function formatCandidate(
  item: CandidateItem,
  platforms: string[],
  tone: string,
  topic: string,
  includeHashtags: boolean,
  includeCTA: boolean,
): Record<string, SocialVariant> {
  const variants: Record<string, SocialVariant> = {};

  for (const platform of platforms) {
    const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.generic;
    variants[platform] = {
      platform,
      caption: generateCaption(item.prompt, platform, spec, tone, item.rank),
      hook: generateHook(item.prompt, tone),
      hashtags: includeHashtags ? generateHashtags(topic, platform, spec.hashtagCount) : [],
      cta: generateCTA(platform, includeCTA),
      title: item.prompt ? item.prompt.slice(0, 60) : "Untitled",
      shortDescription: item.prompt ? item.prompt.slice(0, 120) : "AI-generated content",
      imageSpec: { ...spec.imageSize, aspect: spec.imageAspect },
    };
  }

  return variants;
}

// ── Executor ──

/**
 * SocialFormat capability executor.
 *
 * Takes a CandidateCollection/Selection (typically from Ranking) and
 * generates platform-specific social content metadata per candidate.
 * Attaches formatted social variants to each candidate's metadata.
 *
 * Currently uses deterministic mock formatting. A real implementation
 * would call an LLM for caption generation and image processing for
 * platform-specific resizing.
 */
export async function executeSocialFormat(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // Normalize input — accepts CandidateCollection, CandidateSelection, or raw
  const collection = ensureCollection(inputs.candidates_in, "image", context.nodeId);

  if (collection.items.length === 0) {
    throw new Error("SocialFormat: no candidates provided in candidates_in port");
  }

  // Also accept an optional text context
  const contextText = inputs.text_in as string | undefined;

  // Resolve params
  const platforms = (params.platforms as string[]) ?? ["instagram", "x", "linkedin"];
  const tone = (params.tone as string) ?? "professional";
  const topic = (params.topic as string) ?? "";
  const includeHashtags = (params.includeHashtags as boolean) ?? true;
  const includeCTA = (params.includeCTA as boolean) ?? true;

  // Format each candidate, preserving all upstream data
  const formatted = attachCollectionMetadata(collection, (item) => {
    const promptContext = contextText ?? item.prompt ?? "";
    const itemWithPrompt = promptContext ? { ...item, prompt: promptContext } : item;
    const socialVariants = formatCandidate(
      itemWithPrompt,
      platforms,
      tone,
      topic,
      includeHashtags,
      includeCTA,
    );
    return { socialVariants };
  });

  const result = toCollection(formatted.items, "formatted", context.nodeId);

  return {
    outputs: {
      formatted_out: result,
    },
    cost: 0,
    metadata: {
      platforms,
      tone,
      candidateCount: collection.items.length,
      mock: true,
    },
  };
}
