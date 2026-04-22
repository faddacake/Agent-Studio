export const runtime = "nodejs";

/**
 * POST /api/editor-projects/[id]/voiceover
 *
 * Synthesizes speech from the project's scene text overlays using the
 * fal.ai Kokoro TTS model, saves the resulting audio as a durable artifact,
 * and attaches it as the project's audioTrack.
 *
 * API key resolution: DB providerConfig for "fal" → FAL_API_KEY env var.
 * Returns 422 when no captions exist or no API key is configured.
 * Returns 502 on provider or download errors.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getEditorProject, updateEditorProject } from "@/server/api/editorProjects";
import { resolveProviderKey } from "@/lib/providers/resolveProviderKey";
import { ARTIFACTS_DIR } from "@/lib/artifactStorage";

const FAL_TTS_MODEL = "fal-ai/kokoro";

interface KokoroResponse {
  audio: {
    url: string;
    content_type?: string;
  };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = getEditorProject(id);
  if (!project) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Collect non-empty caption text from scenes in order
  const captions = project.scenes
    .map((s) => s.textOverlay?.text?.trim() ?? "")
    .filter((t) => t.length > 0);

  if (captions.length === 0) {
    return NextResponse.json(
      {
        error: "NO_CAPTIONS",
        message: "No scene captions to synthesize. Enable captions (CC) and add text to scenes first.",
      },
      { status: 422 },
    );
  }

  // Resolve API key: DB config → env var
  const apiKey = resolveProviderKey("fal") ?? process.env.FAL_API_KEY ?? null;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "NO_API_KEY",
        message: "No fal.ai API key configured. Add a fal provider key in Settings → Providers.",
      },
      { status: 422 },
    );
  }

  // Join captions with sentence-boundary pauses
  const text = captions.join(". ");

  // Call fal.ai Kokoro TTS — same plain-fetch pattern as FalGeneratorAdapter
  let falRes: Response;
  try {
    falRes = await fetch(`https://fal.run/${FAL_TTS_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[voiceover] network error calling fal TTS", err);
    return NextResponse.json(
      { error: "PROVIDER_ERROR", message: "Could not reach TTS provider" },
      { status: 502 },
    );
  }

  if (!falRes.ok) {
    const errText = await falRes.text().catch(() => "");
    console.error("[voiceover] fal TTS error", falRes.status, errText);
    return NextResponse.json(
      { error: "PROVIDER_ERROR", message: `TTS generation failed (${falRes.status})` },
      { status: 502 },
    );
  }

  const falData = (await falRes.json()) as KokoroResponse;
  const audioUrl = falData.audio?.url;
  if (!audioUrl) {
    return NextResponse.json(
      { error: "PROVIDER_ERROR", message: "TTS provider returned no audio URL" },
      { status: 502 },
    );
  }

  // Download the generated audio and save to durable artifact storage
  let audioRes: Response;
  try {
    audioRes = await fetch(audioUrl);
  } catch (err) {
    console.error("[voiceover] download error", err);
    return NextResponse.json(
      { error: "DOWNLOAD_ERROR", message: "Failed to download generated audio" },
      { status: 502 },
    );
  }

  if (!audioRes.ok) {
    return NextResponse.json(
      { error: "DOWNLOAD_ERROR", message: "Failed to download generated audio" },
      { status: 502 },
    );
  }

  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const voiceoverDir = path.join(ARTIFACTS_DIR, "voiceover");
  await fs.mkdir(voiceoverDir, { recursive: true });
  const filename = `${id}-${randomUUID()}.mp3`;
  const filePath = path.join(voiceoverDir, filename);
  await fs.writeFile(filePath, audioBuffer);

  // Attach as the project's audio track and persist
  const updated = updateEditorProject(id, {
    audioTrack: { src: filePath, volume: 1 },
  });

  if (!updated) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ audioTrack: updated.audioTrack });
}
