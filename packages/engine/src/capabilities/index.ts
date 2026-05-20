import { nodeExecutor } from "../executor.js";
import { executeBestOfN } from "./bestOfN.js";
import { executeClipScoring } from "./clipScoring.js";
import { executeRanking } from "./ranking.js";
import { executeSocialFormat } from "./socialFormat.js";
import { executeExportBundle } from "./exportBundle.js";
import { executeReactAgent } from "./reactAgent.js";
import { executeSubAgent } from "./subAgent.js";
import { executeObsidianMemory } from "./obsidianMemory.js";
import { executeWebSearch } from "./webSearch.js";
import type { NodeDefinition, NodeExecutionContext, NodeExecutionResult } from "@aistudio/shared";

export { executeBestOfN } from "./bestOfN.js";
export { executeClipScoring } from "./clipScoring.js";
export { executeRanking } from "./ranking.js";
export { executeSocialFormat } from "./socialFormat.js";
export { executeExportBundle } from "./exportBundle.js";
export { executeReactAgent } from "./reactAgent.js";
export { executeSubAgent } from "./subAgent.js";
export { executeObsidianMemory } from "./obsidianMemory.js";
export { executeWebSearch } from "./webSearch.js";

export {
  MockGeneratorAdapter,
  FalGeneratorAdapter,
  ReplicateGeneratorAdapter,
  FalVideoGeneratorAdapter,
  createGenerator,
  createVideoGenerator,
  isFalVideoModelId,
} from "./generator.js";
export type {
  GeneratorAdapter,
  VideoGeneratorAdapter,
  GeneratorAdapterOptions,
  GenerateOpts,
  GeneratedImage,
  GeneratedVideo,
} from "./generator.js";

/**
 * Thin alias wrapper: injects a fixed `operation` value and delegates
 * to the main executeObsidianMemory executor.
 */
function makeMemoryAlias(
  operation: string,
): (ctx: NodeExecutionContext, def: NodeDefinition) => Promise<NodeExecutionResult> {
  return (ctx, def) =>
    executeObsidianMemory(
      { ...ctx, params: { ...ctx.params, operation } },
      def,
    );
}

/**
 * Register all built-in capability executors with the node executor.
 *
 * Call this once at worker/host startup after the node registry is
 * initialized. Each capability executor is keyed by its node type
 * string, matching the NodeDefinition.type in the registry.
 */
export function registerCapabilityExecutors(): void {
  nodeExecutor.registerCapability("react-agent",   executeReactAgent);
  nodeExecutor.registerCapability("sub-agent",     executeSubAgent);
  nodeExecutor.registerCapability("best-of-n",     executeBestOfN);
  nodeExecutor.registerCapability("clip-scoring",  executeClipScoring);
  nodeExecutor.registerCapability("ranking",       executeRanking);
  nodeExecutor.registerCapability("social-format", executeSocialFormat);
  nodeExecutor.registerCapability("export-bundle", executeExportBundle);

  // Obsidian Memory — one canvas node type + four focused tool aliases
  nodeExecutor.registerCapability("obsidian-memory", executeObsidianMemory);
  nodeExecutor.registerCapability("memory-write",    makeMemoryAlias("write"));
  nodeExecutor.registerCapability("memory-append",   makeMemoryAlias("append"));
  nodeExecutor.registerCapability("memory-search",   makeMemoryAlias("search"));
  nodeExecutor.registerCapability("memory-read",     makeMemoryAlias("read"));

  // Web Search — one canvas node type + tool alias for the ReAct Agent
  nodeExecutor.registerCapability("web-search", executeWebSearch);
}
