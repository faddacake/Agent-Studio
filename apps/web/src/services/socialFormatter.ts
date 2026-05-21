// ── Types ──

export type PlatformId = "instagram" | "tiktok" | "x" | "linkedin" | "youtubeShorts";

export interface InstagramVariant {
  caption: string;
  hashtags: string[];
}

export interface TikTokVariant {
  caption: string;
  hashtags: string[];
}

export interface XVariant {
  caption: string;
}

export interface LinkedInVariant {
  caption: string;
}

export interface YouTubeShortsVariant {
  title: string;
  description: string;
  hashtags: string[];
}

export interface PlatformVariants {
  instagram: InstagramVariant;
  tiktok: TikTokVariant;
  x: XVariant;
  linkedin: LinkedInVariant;
  youtubeShorts: YouTubeShortsVariant;
}

export interface PlatformImageSpec {
  width: number;
  height: number;
  aspectRatio: string;
  label: string;
}

export const PLATFORM_IMAGE_SPECS: Record<PlatformId, PlatformImageSpec> = {
  instagram: { width: 1080, height: 1080, aspectRatio: "1:1", label: "Square" },
  tiktok: { width: 1080, height: 1920, aspectRatio: "9:16", label: "Vertical" },
  x: { width: 1600, height: 900, aspectRatio: "16:9", label: "Horizontal" },
  linkedin: { width: 1080, height: 1080, aspectRatio: "1:1", label: "Square" },
  youtubeShorts: { width: 1080, height: 1920, aspectRatio: "9:16", label: "Vertical" },
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  youtubeShorts: "YouTube Shorts",
};

// ── Caption generation ──

function generateHashtags(topic: string, count: number): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const base = words.map((w) => `#${w}`);

  const compound: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    compound.push(`#${words[i]}${words[i + 1]}`);
  }

  const extras = [
    "#ai", "#aiart", "#aigeneratedart", "#aigenerated", "#creative",
    "#digitalart", "#generativeart", "#aicreator", "#contentcreator",
    "#trending", "#viral", "#fyp", "#explore", "#instagood",
    "#photooftheday", "#art", "#design", "#inspiration", "#aesthetic",
    "#aitools", "#techcreator", "#creator", "#socialmedia", "#content",
  ];

  const pool = [...new Set([...base, ...compound, ...extras])];
  return pool.slice(0, count);
}

function truncateToWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(" ");
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
}

function buildSentences(caption: string, topic: string): string[] {
  const sentences: string[] = [];
  const raw = caption.replace(/\n+/g, " ").trim();

  if (raw) {
    const parts = raw.match(/[^.!?]+[.!?]+/g) || [raw];
    sentences.push(...parts.map((s) => s.trim()));
  }

  if (sentences.length < 3) {
    sentences.push(
      `Bringing ${topic} to life with AI.`,
      "The future of content creation is here.",
      "Made with Agent Studio.",
    );
  }

  return sentences;
}

function buildInstagram(caption: string, topic: string): InstagramVariant {
  const sentences = buildSentences(caption, topic);
  const hashtags = generateHashtags(topic, 20);

  let body = sentences.join(" ");
  const targetWords = 150;
  const currentWords = body.split(/\s+/).length;

  if (currentWords < targetWords) {
    const fillers = [
      `\n\nThis ${topic} piece was crafted using cutting-edge AI tools that push creative boundaries.`,
      "Every detail matters when you're creating something truly unique.",
      "What do you think? Drop your thoughts below!",
    ];
    body += " " + fillers.join(" ");
  }

  body = body.split(/\s+/).slice(0, 220).join(" ");
  if (body.split(/\s+/).length < 125) {
    body += "\n\nFollow for more AI-generated content and creative inspiration!";
  }

  body += "\n\nSave this for later and share with a friend who needs to see this!";

  return { caption: body, hashtags };
}

function buildTikTok(caption: string, topic: string): TikTokVariant {
  const sentences = buildSentences(caption, topic);
  const hashtags = generateHashtags(topic, 7);

  const hook = `Wait until you see this ${topic} creation...`;
  const bodyParts = [hook, "", ...sentences.slice(0, 3), "", "Would you try this? Comment below!"];

  return { caption: bodyParts.join("\n"), hashtags };
}

function buildX(caption: string, topic: string): XVariant {
  const sentences = buildSentences(caption, topic);
  const core = sentences[0] || `Check out this ${topic} creation.`;
  const tweet = truncateToWordBoundary(core, 250);
  const suffix = ` #${topic.replace(/\s+/g, "")} #AI`;

  const full = tweet + suffix;
  return { caption: full.length <= 280 ? full : truncateToWordBoundary(tweet, 280) };
}

function buildLinkedIn(caption: string, topic: string): LinkedInVariant {
  const sentences = buildSentences(caption, topic);

  const parts = [
    sentences[0] || `Exploring ${topic} with AI-powered tools.`,
    "",
    "Here's what stood out:",
    "",
    ...sentences.slice(1, 4).map((s) => s),
    "",
    `The intersection of AI and ${topic} is creating new possibilities for creators and businesses alike.`,
    "",
    "What are your thoughts on using AI for content creation?",
    "",
    "#AI #ContentCreation #Innovation",
  ];

  return { caption: parts.join("\n") };
}

function buildYouTubeShorts(caption: string, topic: string): YouTubeShortsVariant {
  const sentences = buildSentences(caption, topic);
  const hashtags = generateHashtags(topic, 5);

  const title = truncateToWordBoundary(
    `AI Creates Stunning ${topic.charAt(0).toUpperCase() + topic.slice(1)} - You Won't Believe This!`,
    100,
  );

  const description = [
    sentences[0] || `Watch AI create amazing ${topic} content in seconds.`,
    "",
    ...sentences.slice(1, 3),
    "",
    "Made with Agent Studio - the ultimate multi-model content creation platform.",
    "",
    hashtags.join(" "),
  ].join("\n");

  return { title, description, hashtags };
}

// ── Public API ──

export async function generatePlatformVariants(input: {
  caption: string;
  imageUrl: string;
  topic: string;
}): Promise<PlatformVariants> {
  const { caption, topic } = input;

  return {
    instagram: buildInstagram(caption, topic),
    tiktok: buildTikTok(caption, topic),
    x: buildX(caption, topic),
    linkedin: buildLinkedIn(caption, topic),
    youtubeShorts: buildYouTubeShorts(caption, topic),
  };
}

/**
 * Returns a URL for a resized version of the image for the given platform.
 * Uses a server-side resize endpoint. Falls back to the original URL if
 * no resize service is available.
 */
export function resizeForPlatform(imageUrl: string, platform: PlatformId): string {
  const spec = PLATFORM_IMAGE_SPECS[platform];
  return `/api/social-format/image?url=${encodeURIComponent(imageUrl)}&w=${spec.width}&h=${spec.height}`;
}
