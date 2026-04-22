import { nodeExecutor } from "../executor.js";
import { executeResize } from "./resize.js";
import { executeCrop } from "./crop.js";
import { executeFormatConvert } from "./formatConvert.js";
import { executePromptTemplate } from "./promptTemplate.js";

export { executeResize } from "./resize.js";
export { executeCrop } from "./crop.js";
export { executeFormatConvert } from "./formatConvert.js";
export { bufferFromInput, writeArtifact } from "./imageUtils.js";
export { executePromptTemplate } from "./promptTemplate.js";

/**
 * Register all built-in local node executors with the node executor.
 *
 * Call this once at worker/host startup after the node registry is
 * initialized. Each executor is keyed by its NodeDefinition.type string.
 */
export function registerLocalExecutors(): void {
  nodeExecutor.registerLocal("resize",           executeResize);
  nodeExecutor.registerLocal("crop",             executeCrop);
  nodeExecutor.registerLocal("format-convert",   executeFormatConvert);
  nodeExecutor.registerLocal("prompt-template",  executePromptTemplate);
}
