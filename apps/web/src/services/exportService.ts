import {
  type PlatformId,
  type PlatformVariants,
  PLATFORM_LABELS,
  PLATFORM_IMAGE_SPECS,
} from "@/services/socialFormatter";
import {
  formatForPlatform,
  type Platform,
  type FormatOutput,
  type TextBlock,
} from "@aistudio/shared";
import type { LicenseTier } from "@/lib/license";

const PLATFORM_MAP: Record<PlatformId, Platform> = {
  instagram: "instagram",
  tiktok: "tiktok",
  x: "twitter",
  linkedin: "linkedin",
  youtubeShorts: "youtube",
};

// ── Types ──

export interface ExportBundleInput {
  prompt: string;
  topic: string;
  imageUrl: string;
  variants: PlatformVariants;
  images: Record<string, string>;
  tier: LicenseTier;
  modelName?: string;
  /** True when the variants were hand-edited in the Canvas editor. */
  edited?: boolean;
}

export interface ExportBundleData {
  metadata: ExportMetadata;
  captions: Record<string, string>;
  hashtags: Record<string, string>;
  imageUrls: Record<string, string>;
  formatted: Record<string, FormatOutput>;
  csv: string;
  manifest: BundleManifest;
  postingGuides: Record<string, string>;
}

export interface ExportMetadata {
  version: number;
  createdAt: string;
  prompt: string;
  topic: string;
  modelName: string;
  tier: LicenseTier;
  watermarked: boolean;
  platforms: string[];
  edited: boolean;
}

// ── Manifest ──

interface ManifestFileEntry {
  path: string;
  type: "caption" | "hashtags" | "image" | "csv" | "metadata" | "manifest" | "formatted" | "guide";
  platform: string | null;
  description: string;
}

export interface BundleManifest {
  generatedAt: string;
  campaignId: string;
  platforms: string[];
  counts: Record<string, { captions: number; hashtags: number; images: number }>;
  modelName: string;
  tier: LicenseTier;
  topic: string;
  files: ManifestFileEntry[];
}

const PLATFORM_FILE_NAMES: Record<PlatformId, string> = {
  instagram: "instagram",
  tiktok: "tiktok",
  x: "x",
  linkedin: "linkedin",
  youtubeShorts: "youtube",
};

const PLATFORMS: PlatformId[] = ["instagram", "tiktok", "x", "linkedin", "youtubeShorts"];

const SUGGESTED_POST_TIMES: Record<PlatformId, string> = {
  instagram: "11:00 AM (Tue/Thu)",
  tiktok: "7:00 PM (Tue/Thu/Sat)",
  x: "9:00 AM (Mon–Fri)",
  linkedin: "8:00 AM (Tue/Wed/Thu)",
  youtubeShorts: "12:00 PM (Fri/Sat)",
};

// ── Creator-friendly file names ──

const CAPTION_FILE_NAMES: Record<PlatformId, string> = {
  instagram: "instagram_caption_01",
  tiktok: "tiktok_caption_01",
  x: "x_caption_01",
  linkedin: "linkedin_caption_01",
  youtubeShorts: "youtube_caption_01",
};

const HASHTAG_FILE_NAMES: Record<PlatformId, string> = {
  instagram: "instagram_hashtags_01",
  tiktok: "tiktok_hashtags_01",
  x: "x_hashtags_01",
  linkedin: "linkedin_hashtags_01",
  youtubeShorts: "youtube_hashtags_01",
};

const IMAGE_FILE_NAMES: Record<PlatformId, string> = {
  instagram: "instagram_image_01",
  tiktok: "tiktok_image_01",
  x: "x_image_01",
  linkedin: "linkedin_image_01",
  youtubeShorts: "youtube_image_01",
};

// ── Posting guides ──

const POSTING_GUIDES: Record<PlatformId, string> = {
  instagram: `How to post on Instagram
─────────────────────────
1. Open Instagram and tap the + button at the bottom center.
2. Select the image from your camera roll (see images/ folder).
3. Apply any filters if desired, then tap Next.
4. Paste the caption from the caption file. Add hashtags at the end or in the first comment.
5. Tap Share.

Suggested cadence: 3-5 posts per week.
Best times: ${SUGGESTED_POST_TIMES.instagram}
Tip: Use Reels for higher reach. Carousel posts get 1.4x more engagement.`,

  tiktok: `How to post on TikTok
─────────────────────
1. Open TikTok and tap the + button at the bottom center.
2. Upload the image/video from your gallery.
3. Add any effects or sounds, then tap Next.
4. Paste the caption and hashtags from the provided files.
5. Tap Post.

Suggested cadence: 1-3 posts per day for growth, 3-5 per week to maintain.
Best times: ${SUGGESTED_POST_TIMES.tiktok}
Tip: Keep videos under 60 seconds. Hook viewers in the first 2 seconds.`,

  x: `How to post on X
─────────────────
1. Open X (twitter.com or the X app) and tap the compose button.
2. Paste the caption from the caption file.
3. Attach the image from the images/ folder.
4. Tap Post.

Suggested cadence: 3-5 tweets per day (including replies and reposts).
Best times: ${SUGGESTED_POST_TIMES.x}
Tip: Threads perform well for longer content. Quote-tweet your own post to boost visibility.`,

  linkedin: `How to post on LinkedIn
───────────────────────
1. Open LinkedIn and click "Start a post" at the top of your feed.
2. Paste the caption from the caption file.
3. Click the image icon and upload from the images/ folder.
4. Click Post.

Suggested cadence: 2-3 posts per week.
Best times: ${SUGGESTED_POST_TIMES.linkedin}
Tip: Posts with 1-2 images perform better than text-only. Ask a question to drive comments.`,

  youtubeShorts: `How to post on YouTube Shorts
─────────────────────────────
1. Open YouTube Studio or the YouTube app.
2. Tap the + button and select "Create a Short" or "Upload video."
3. Upload the vertical video/image from the images/ folder.
4. Set the title from the caption file (Title line).
5. Paste the description and add hashtags.
6. Tap Upload / Publish.

Suggested cadence: 3-5 Shorts per week.
Best times: ${SUGGESTED_POST_TIMES.youtubeShorts}
Tip: Add #Shorts to the title or description. Use trending sounds for discovery.`,
};

// ── Caption extraction ──

function getCaptionText(variants: PlatformVariants, platform: PlatformId): string {
  const v = variants[platform];
  if (platform === "youtubeShorts") {
    const yt = v as PlatformVariants["youtubeShorts"];
    return `Title: ${yt.title}\n\nDescription:\n${yt.description}`;
  }
  return (v as { caption: string }).caption;
}

function getHashtagText(variants: PlatformVariants, platform: PlatformId): string | null {
  const v = variants[platform];
  if ("hashtags" in v && Array.isArray((v as { hashtags: string[] }).hashtags)) {
    return (v as { hashtags: string[] }).hashtags.join(" ");
  }
  return null;
}

// ── CSV generation ──

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildSchedulerCSV(variants: PlatformVariants): string {
  const header = "platform,caption,image_filename,suggested_post_time";
  const rows = PLATFORMS.map((p) => {
    const caption = getCaptionText(variants, p);
    const fileName = `${IMAGE_FILE_NAMES[p]}.png`;
    const time = SUGGESTED_POST_TIMES[p];
    return [
      escapeCSV(PLATFORM_LABELS[p]),
      escapeCSV(caption),
      escapeCSV(fileName),
      escapeCSV(time),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

// ── Watermark text ──

export function getWatermarkText(tier: LicenseTier): string | null {
  if (tier === "free") return "Made with Agent Studio — Free Tier";
  return null;
}

// ── Campaign ID ──

function generateCampaignId(prompt: string, timestamp: string): string {
  // Deterministic hash: simple djb2 of prompt + timestamp
  const input = prompt + "|" + timestamp;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `campaign_${hash.toString(36)}`;
}

// ── Public API ──

export async function createExportBundle(input: ExportBundleInput): Promise<ExportBundleData> {
  const { prompt, topic, variants, images, tier, modelName, edited } = input;
  const watermarked = tier === "free";
  const createdAt = new Date().toISOString();

  const captions: Record<string, string> = {};
  const hashtags: Record<string, string> = {};
  const imageUrls: Record<string, string> = {};
  const formatted: Record<string, FormatOutput> = {};
  const postingGuides: Record<string, string> = {};

  const manifestFiles: ManifestFileEntry[] = [];
  const manifestCounts: Record<string, { captions: number; hashtags: number; images: number }> = {};

  for (const platform of PLATFORMS) {
    const captionKey = CAPTION_FILE_NAMES[platform];
    const hashtagKey = HASHTAG_FILE_NAMES[platform];
    const imageKey = IMAGE_FILE_NAMES[platform];
    const label = PLATFORM_LABELS[platform];

    let captionCount = 0;
    let hashtagCount = 0;
    let imageCount = 0;

    // Captions
    const captionText = getCaptionText(variants, platform);
    captions[captionKey] = captionText;
    captionCount = 1;
    manifestFiles.push({
      path: `captions/${captionKey}.txt`,
      type: "caption",
      platform: label,
      description: `${label} caption text`,
    });

    // Hashtags
    const hashtagText = getHashtagText(variants, platform);
    if (hashtagText) {
      hashtags[hashtagKey] = hashtagText;
      hashtagCount = 1;
      manifestFiles.push({
        path: `hashtags/${hashtagKey}.txt`,
        type: "hashtags",
        platform: label,
        description: `${label} hashtags`,
      });
    }

    // Images
    imageUrls[imageKey] = images[platform] || "";
    if (images[platform]) {
      imageCount = 1;
      manifestFiles.push({
        path: `images/${imageKey}.png`,
        type: "image",
        platform: label,
        description: `${label} image (${PLATFORM_IMAGE_SPECS[platform].aspectRatio})`,
      });
    }

    // Posting guide — keyed by PLATFORM_FILE_NAMES for stable filtering
    postingGuides[PLATFORM_FILE_NAMES[platform]] = POSTING_GUIDES[platform];
    manifestFiles.push({
      path: `guides/${PLATFORM_FILE_NAMES[platform]}_posting_guide.txt`,
      type: "guide",
      platform: label,
      description: `How to post on ${label}`,
    });

    // Formatted
    const sharedPlatform = PLATFORM_MAP[platform];
    formatted[PLATFORM_FILE_NAMES[platform]] = formatForPlatform(sharedPlatform, {
      text: captionText,
      hashtags: hashtagText ? hashtagText.split(" ") : undefined,
      media: images[platform]
        ? { width: PLATFORM_IMAGE_SPECS[platform].width, height: PLATFORM_IMAGE_SPECS[platform].height, url: images[platform] }
        : undefined,
    });

    manifestCounts[label] = { captions: captionCount, hashtags: hashtagCount, images: imageCount };
  }

  // Add non-platform files to manifest
  manifestFiles.push(
    { path: "formatted/blocks.json", type: "formatted", platform: null, description: "Structured format blocks for all platforms" },
    { path: "csv/scheduler.csv", type: "csv", platform: null, description: "Social media posting schedule" },
    { path: "metadata.json", type: "metadata", platform: null, description: "Export metadata and settings" },
    { path: "bundle_manifest.json", type: "manifest", platform: null, description: "File index and campaign summary" },
  );

  const csv = buildSchedulerCSV(variants);

  const resolvedModelName = modelName || "Unknown";
  const campaignId = generateCampaignId(prompt, createdAt);

  const metadata: ExportMetadata = {
    version: 1,
    createdAt,
    prompt,
    topic,
    modelName: resolvedModelName,
    tier,
    watermarked,
    platforms: PLATFORMS.map((p) => PLATFORM_LABELS[p]),
    edited: edited === true,
  };

  const manifest: BundleManifest = {
    generatedAt: createdAt,
    campaignId,
    platforms: PLATFORMS.map((p) => PLATFORM_LABELS[p]),
    counts: manifestCounts,
    modelName: resolvedModelName,
    tier,
    topic,
    files: manifestFiles,
  };

  return { metadata, captions, hashtags, imageUrls, formatted, csv, manifest, postingGuides };
}
