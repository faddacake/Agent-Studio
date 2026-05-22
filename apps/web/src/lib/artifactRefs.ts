import { isArtifactRef } from "@iterastudio/shared";
import type { ArtifactRef } from "@iterastudio/shared";

/**
 * Recursively extract image ArtifactRefs from an unknown output value (max 3 levels deep).
 * Handles:
 *   - Direct ArtifactRef images
 *   - Arrays of refs
 *   - CandidateCollection / CandidateSelection shapes: { items: [{ value: ArtifactRef }] }
 */
export function extractImageRefs(value: unknown, depth = 0): ArtifactRef[] {
  if (depth > 3) return [];
  if (isArtifactRef(value) && value.mimeType.startsWith("image/")) return [value];
  if (Array.isArray(value)) return value.flatMap((v) => extractImageRefs(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      return (obj.items as unknown[]).flatMap((item) => {
        if (item !== null && typeof item === "object") {
          return extractImageRefs((item as Record<string, unknown>).value, depth + 1);
        }
        return [];
      });
    }
  }
  return [];
}

/**
 * Recursively extract video ArtifactRefs from an unknown output value (max 3 levels deep).
 * Parallel to extractImageRefs but matches mimeType "video/*".
 */
export function extractVideoRefs(value: unknown, depth = 0): ArtifactRef[] {
  if (depth > 3) return [];
  if (isArtifactRef(value) && value.mimeType.startsWith("video/")) return [value];
  if (Array.isArray(value)) return value.flatMap((v) => extractVideoRefs(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      return (obj.items as unknown[]).flatMap((item) => {
        if (item !== null && typeof item === "object") {
          return extractVideoRefs((item as Record<string, unknown>).value, depth + 1);
        }
        return [];
      });
    }
  }
  return [];
}
