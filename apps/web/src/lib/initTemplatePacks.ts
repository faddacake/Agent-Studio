/**
 * Single initialization point for built-in template packs.
 *
 * Registration order determines getFeaturedTemplates() output order —
 * videoCreationStarters is first so quick-social-reel appears first.
 */

import { registerBuiltInPacks } from "@iterastudio/shared";
import { rehydratePersistedPacks } from "./templatePackStorage";

import videoCreationStarters from "../../../../templates/packs/video-creation-starters.json";
import imageGenStarter from "../../../../templates/packs/image-gen-starter.json";
import socialContentPipeline from "../../../../templates/packs/social-content-pipeline.json";

let packsRegistered = false;

export function ensurePacksLoaded(): void {
  if (packsRegistered) return;
  packsRegistered = true;
  registerBuiltInPacks([videoCreationStarters, imageGenStarter, socialContentPipeline]);
  rehydratePersistedPacks();
}
