import {
  registerBuiltInNodes,
  nodeRegistry,
  modelsToNodeDefinitions,
} from "@iterastudio/shared";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/config/models";

let initialized = false;

/**
 * Initialize the node registry with all built-in definitions
 * and provider-specific model definitions from the model catalog.
 *
 * Safe to call multiple times — only runs once.
 *
 * Usage:
 *   import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
 *   initializeNodeRegistry();
 *   // Now nodeRegistry is populated and ready
 */
export function initializeNodeRegistry(): void {
  if (initialized) return;

  // Register built-in nodes (utility, I/O, provider templates, capabilities)
  registerBuiltInNodes();

  // Register model-specific provider nodes from the catalog
  const modelNodes = modelsToNodeDefinitions([...IMAGE_MODELS, ...VIDEO_MODELS]);
  nodeRegistry.registerAll(modelNodes);

  initialized = true;
}
