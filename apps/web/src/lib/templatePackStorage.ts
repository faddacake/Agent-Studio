/**
 * localStorage persistence for template packs.
 *
 * Stores imported and user-created packs so they survive page reload.
 * Built-in packs are NOT stored — they are always loaded from static imports.
 *
 * Storage format: JSON array of raw TemplatePack objects under a single key.
 */

import {
  templatePackLoader,
  parseTemplatePack,
  type TemplatePack,
} from "@iterastudio/shared";

const STORAGE_KEY = "iteraStudio.templatePacks";

// ── Read ──

/**
 * Load persisted packs from localStorage, validate each via parseTemplatePack(),
 * and register valid ones into templatePackLoader.
 * Invalid packs are silently skipped.
 * Returns the number of packs successfully rehydrated.
 */
export function rehydratePersistedPacks(): number {
  if (typeof window === "undefined") return 0;

  let rawArray: unknown[];
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return 0;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return 0;
    rawArray = parsed;
  } catch {
    return 0;
  }

  let count = 0;
  for (const raw of rawArray) {
    try {
      const pack = parseTemplatePack(raw);

      // Skip built-in packs — they're loaded separately
      if (pack.manifest.source === "builtin") continue;

      // Avoid duplicates
      if (templatePackLoader.has(pack.manifest.id)) continue;

      templatePackLoader.register(pack);
      count++;
    } catch {
      // Skip invalid packs silently
    }
  }

  return count;
}

// ── Write ──

/**
 * Persist a pack to localStorage.
 * Adds to the existing array or replaces if the pack ID already exists.
 */
export function persistPack(pack: TemplatePack): void {
  if (typeof window === "undefined") return;

  const existing = readStoredPacks();

  // Replace if same ID exists, otherwise append
  const idx = existing.findIndex(
    (p) =>
      p &&
      typeof p === "object" &&
      (p as Record<string, unknown>).manifest &&
      ((p as Record<string, unknown>).manifest as Record<string, unknown>).id === pack.manifest.id,
  );

  const serializable = toSerializablePack(pack);

  if (idx >= 0) {
    existing[idx] = serializable;
  } else {
    existing.push(serializable);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/**
 * Remove a pack from localStorage by ID.
 */
export function removePersistedPack(packId: string): void {
  if (typeof window === "undefined") return;

  const existing = readStoredPacks();
  const filtered = existing.filter((p) => {
    if (!p || typeof p !== "object") return false;
    const manifest = (p as Record<string, unknown>).manifest;
    if (!manifest || typeof manifest !== "object") return false;
    return (manifest as Record<string, unknown>).id !== packId;
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // fail silently
  }
}

// ── Helpers ──

function readStoredPacks(): unknown[] {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Convert a TemplatePack into a plain object safe for JSON.stringify.
 * The TemplatePack type is already plain data, but this ensures
 * we store the same shape that parseTemplatePack() expects.
 */
function toSerializablePack(pack: TemplatePack): Record<string, unknown> {
  return {
    manifest: { ...pack.manifest },
    templates: { ...pack.templates },
  };
}
