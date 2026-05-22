export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  generatePlatformVariants,
  resizeForPlatform,
  PLATFORM_IMAGE_SPECS,
  type PlatformId,
} from "@/services/socialFormatter";
import { formatForPlatform, type Platform, type FormatOutput } from "@iterastudio/shared";

const PLATFORM_MAP: Record<PlatformId, Platform> = {
  instagram: "instagram",
  tiktok: "tiktok",
  x: "twitter",
  linkedin: "linkedin",
  youtubeShorts: "youtube",
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { caption, imageUrl, topic } = body as {
      caption?: string;
      imageUrl?: string;
      topic?: string;
    };

    if (!caption) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[social-format] 400", { bodyKeys: Object.keys(body || {}) });
      }
      return NextResponse.json({ error: "Missing required field: caption" }, { status: 400 });
    }

    const resolvedTopic =
      topic || caption.split(/\s+/).slice(0, 5).join(" ") || "AI generated content";
    const resolvedImageUrl = imageUrl || "";

    const variants = await generatePlatformVariants({
      caption,
      imageUrl: resolvedImageUrl,
      topic: resolvedTopic,
    });

    const images: Record<string, string> = {};
    const formatted: Record<string, FormatOutput> = {};

    for (const platform of Object.keys(PLATFORM_IMAGE_SPECS) as PlatformId[]) {
      images[platform] = resolvedImageUrl ? resizeForPlatform(resolvedImageUrl, platform) : "";

      const v = variants[platform];
      const text = "caption" in v ? (v as { caption: string }).caption : "";
      const hashtags = "hashtags" in v ? (v as { hashtags: string[] }).hashtags : undefined;
      const spec = PLATFORM_IMAGE_SPECS[platform];

      formatted[platform] = formatForPlatform(PLATFORM_MAP[platform], {
        text,
        hashtags,
        media: resolvedImageUrl ? { width: spec.width, height: spec.height, url: images[platform] } : undefined,
      });
    }

    return NextResponse.json({ variants, images, formatted });
  } catch (err) {
    console.error("[social-format] Error:", err);
    return NextResponse.json({ error: "Failed to generate social variants" }, { status: 500 });
  }
}
