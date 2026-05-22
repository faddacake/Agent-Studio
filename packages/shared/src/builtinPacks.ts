/**
 * Built-in template pack registration.
 *
 * Loads template packs shipped with Agent Studio from the templates/packs/
 * directory. Each pack is a JSON file containing a manifest and templates.
 *
 * This module is designed to work in both Node.js (server) and bundled
 * (client) environments. Built-in packs are imported statically to
 * avoid runtime file system access in the browser.
 */

import { templatePackLoader, parseTemplatePack, type TemplatePack } from "./templatePack.js";

// ── Static imports of built-in packs ──
// Each built-in pack is imported here. When adding a new built-in pack,
// add an import and include it in the BUILTIN_PACKS array below.

// Note: The actual JSON import happens at the call site (registerBuiltInPacks)
// because JSON imports require runtime or bundler support. The pack data
// is passed in by the host environment.

/**
 * Register built-in template packs from raw JSON data.
 *
 * Call this at application startup with the built-in pack data.
 * Each entry is validated via parseTemplatePack() before registration.
 *
 * Usage (Node.js / server):
 *   import packData from "../../../templates/packs/social-content-pipeline.json";
 *   registerBuiltInPacks([packData]);
 *
 * Usage (Next.js / bundler):
 *   import packData from "@/../../templates/packs/social-content-pipeline.json";
 *   registerBuiltInPacks([packData]);
 */
export function registerBuiltInPacks(rawPacks: unknown[]): TemplatePack[] {
  const registered: TemplatePack[] = [];

  for (const raw of rawPacks) {
    try {
      const pack = parseTemplatePack(raw);
      templatePackLoader.register(pack);
      registered.push(pack);
    } catch (err) {
      console.warn(
        "[TemplatePacks] Failed to load built-in pack:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return registered;
}
