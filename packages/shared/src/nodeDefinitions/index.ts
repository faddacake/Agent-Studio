import { nodeRegistry } from "../nodeRegistry.js";
import { ioNodes } from "./io.js";
import { utilityNodes } from "./utility.js";
import { providerNodes } from "./provider.js";
import { capabilityNodes } from "./capabilities.js";

// Re-export individual definitions for direct access
export { imageInputNode, outputNode } from "./io.js";
export {
  resizeNode,
  cropNode,
  formatConvertNode,
  compositingNode,
  promptTemplateNode,
  commentNode,
} from "./utility.js";
export {
  imageGenerationNode,
  videoGenerationNode,
  createProviderNodeDefinition,
} from "./provider.js";
export {
  reactAgentNode,
  bestOfNNode,
  clipScoringNode,
  socialFormatNode,
  exportBundleNode,
  rankingNode,
} from "./capabilities.js";

/**
 * All built-in node definitions shipped with AI Studio.
 */
export const builtInNodeDefinitions = [
  ...ioNodes,
  ...utilityNodes,
  ...providerNodes,
  ...capabilityNodes,
];

/**
 * Register all built-in node definitions into the global registry.
 * Call this once at application startup (both client and server).
 *
 * Additional provider-specific nodes can be registered after this
 * using `nodeRegistry.register()` or `createProviderNodeDefinition()`.
 */
export function registerBuiltInNodes(): void {
  nodeRegistry.registerAll(builtInNodeDefinitions);
}
