import { useState, useCallback } from "react";

export type ExportStatus = "idle" | "preparing" | "fetching-images" | "building-zip" | "ready" | "error";

interface ExportState {
  status: ExportStatus;
  error: string | null;
  progress: string;
}

export interface ExportInput {
  prompt: string;
  imageUrl: string;
  topic: string;
  modelName?: string;
  platformFilter?: string;
  /** When provided, the API uses these instead of regenerating variants. */
  editedVariants?: unknown;
}

const WATERMARK_TEXT = "Made with Itera Studio — Free Tier";

async function fetchImageAsBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function applyWatermark(
  imageBytes: Uint8Array,
  contentType: string,
): Promise<Uint8Array> {
  if (typeof document === "undefined") return imageBytes;

  return new Promise((resolve, reject) => {
    const blob = new Blob([imageBytes as BlobPart], { type: contentType || "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(imageBytes); return; }

        ctx.drawImage(img, 0, 0);

        const fontSize = Math.max(16, Math.floor(img.width / 30));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const textY = img.height - fontSize * 0.8;
        const textX = img.width / 2;

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        const metrics = ctx.measureText(WATERMARK_TEXT);
        const padding = fontSize * 0.5;
        ctx.fillRect(
          textX - metrics.width / 2 - padding,
          textY - fontSize - padding / 2,
          metrics.width + padding * 2,
          fontSize + padding,
        );

        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillText(WATERMARK_TEXT, textX, textY);

        canvas.toBlob((blob) => {
          if (!blob) { resolve(imageBytes); return; }
          blob.arrayBuffer().then((buf) => {
            resolve(new Uint8Array(buf));
          });
        }, "image/png");
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for watermark"));
    };
    img.src = url;
  });
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function useExportBundle() {
  const [state, setState] = useState<ExportState>({
    status: "idle",
    error: null,
    progress: "",
  });

  const exportCampaign = useCallback(async (input: ExportInput) => {
    setState({ status: "preparing", error: null, progress: "Preparing bundle..." });

    try {
      // 1. Call export API to get all text data + image URLs
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }

      const bundle = await res.json();
      const { metadata, captions, hashtags, imageUrls, formatted, csv, manifest, postingGuides } = bundle;
      const watermarked = metadata.watermarked === true;

      // Filter to selected platform if not "auto".
      // Keys are now creator-friendly (e.g. "instagram_caption_01"), so match
      // against the platform prefix. Formatted keys still use the short name.
      const filterKey = input.platformFilter;
      const filterEntries = (obj: Record<string, unknown>) => {
        if (!filterKey) return obj;
        return Object.fromEntries(
          Object.entries(obj).filter(([k]) => k === filterKey || k.startsWith(filterKey + "_")),
        );
      };
      const filteredCaptions = filterEntries(captions) as Record<string, string>;
      const filteredHashtags = filterEntries(hashtags) as Record<string, string>;
      const filteredImageUrls = filterEntries(imageUrls) as Record<string, string>;
      const filteredFormatted = filterEntries(formatted ?? {}) as Record<string, unknown>;

      // 2. Fetch all images
      setState({ status: "fetching-images", error: null, progress: "Downloading images..." });

      const imageEntries: Array<{ name: string; data: Uint8Array }> = [];
      const imageKeys = Object.keys(filteredImageUrls);

      for (let i = 0; i < imageKeys.length; i++) {
        const name = imageKeys[i];
        const url = filteredImageUrls[name];
        if (!url) continue;

        setState({
          status: "fetching-images",
          error: null,
          progress: `Downloading image ${i + 1}/${imageKeys.length}...`,
        });

        try {
          let data = await fetchImageAsBytes(url);
          if (watermarked) {
            data = await applyWatermark(data, "image/png");
          }
          imageEntries.push({ name: `${name}.png`, data });
        } catch {
          // Skip failed images
        }
      }

      // 3. Build zip using fflate
      setState({ status: "building-zip", error: null, progress: "Building zip file..." });

      const { zipSync } = await import("fflate");

      const zipData: Record<string, Uint8Array> = {};

      // /images/
      for (const img of imageEntries) {
        zipData[`images/${img.name}`] = img.data;
      }

      // /captions/
      for (const [name, text] of Object.entries(filteredCaptions)) {
        zipData[`captions/${name}.txt`] = textToBytes(text as string);
      }

      // /hashtags/
      for (const [name, text] of Object.entries(filteredHashtags)) {
        zipData[`hashtags/${name}.txt`] = textToBytes(text as string);
      }

      // /formatted/
      if (Object.keys(filteredFormatted).length > 0) {
        zipData["formatted/blocks.json"] = textToBytes(JSON.stringify(filteredFormatted, null, 2));
      }

      // /guides/
      if (postingGuides && typeof postingGuides === "object") {
        for (const [platform, guide] of Object.entries(postingGuides as Record<string, string>)) {
          if (!filterKey || platform === filterKey) {
            zipData[`guides/${platform}_posting_guide.txt`] = textToBytes(guide);
          }
        }
      }

      // /csv/
      zipData["csv/scheduler.csv"] = textToBytes(csv);

      // /metadata.json
      zipData["metadata.json"] = textToBytes(JSON.stringify(metadata, null, 2));

      // /bundle_manifest.json
      if (manifest) {
        zipData["bundle_manifest.json"] = textToBytes(JSON.stringify(manifest, null, 2));
      }

      // Legacy alias files — duplicate content under old filenames so existing
      // automations/docs that reference e.g. captions/instagram.txt still work.
      // Only created if the alias path doesn't already exist in zipData.
      const addLegacyAlias = (newPath: string, legacyPath: string) => {
        if (zipData[newPath] && !zipData[legacyPath]) {
          zipData[legacyPath] = zipData[newPath];
        }
      };

      // Derive legacy base from creator-friendly key: "instagram_caption_01" → "instagram"
      for (const key of Object.keys(filteredCaptions)) {
        const base = key.replace(/_caption_\d+$/, "");
        addLegacyAlias(`captions/${key}.txt`, `captions/${base}.txt`);
      }
      for (const key of Object.keys(filteredHashtags)) {
        const base = key.replace(/_hashtags_\d+$/, "");
        addLegacyAlias(`hashtags/${key}.txt`, `hashtags/${base}.txt`);
      }
      for (const img of imageEntries) {
        // img.name is e.g. "instagram_image_01.png"
        const base = img.name.replace(/_image_\d+\.png$/, "");
        addLegacyAlias(`images/${img.name}`, `images/${base}.png`);
      }

      const zipped = zipSync(zipData);
      const blob = new Blob([zipped as BlobPart], { type: "application/zip" });

      const timestamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `campaign-export-${timestamp}.zip`);

      setState({ status: "ready", error: null, progress: "Download ready" });

      // Reset after a delay
      setTimeout(() => {
        setState((s) => (s.status === "ready" ? { status: "idle", error: null, progress: "" } : s));
      }, 5000);
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : "Export failed",
        progress: "",
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", error: null, progress: "" });
  }, []);

  return { ...state, exportCampaign, reset };
}
