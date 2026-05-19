// ── Execution Graph ──
export {
  buildExecutionGraph,
  topologicalSort,
  getReadyNodes,
  resolveNodeInputs,
} from "./executionGraph.js";
export type {
  ExecutionGraph,
  ExecutionNode,
  NodeExecutionStatus,
} from "./executionGraph.js";

// ── Run Coordinator ──
export { RunCoordinator } from "./runCoordinator.js";
export type {
  RunStatus,
  RunState,
  NodeState,
  RunEvent,
  EventListener,
  DispatchJob,
} from "./runCoordinator.js";

// ── Node Executor ──
export { NodeExecutor, nodeExecutor } from "./executor.js";
export type {
  ProviderExecutor,
  LocalExecutor,
  CapabilityExecutor,
} from "./executor.js";

// ── Debug Snapshot ──
export { buildDebugSnapshot, buildGraphPreview } from "./debugSnapshot.js";
export type {
  RunDebugSnapshot,
  NodeDebugInfo,
  BlockedReason,
} from "./debugSnapshot.js";

// ── LLM Text Adapters ──
export { createLLMClient, AnthropicClient, OpenAIClient, OllamaClient, createGrokClient, LLMError, isUserFacingLLMError } from "./llm/index.js";
export type { LLMMessage, LLMChatOptions, LLMTextClient, LLMErrorKind } from "./llm/index.js";

// ── Capability Executors ──
export {
  registerCapabilityExecutors,
  executeReactAgent,
  executeBestOfN,
  executeClipScoring,
  executeRanking,
  executeSocialFormat,
  executeExportBundle,
  MockGeneratorAdapter,
  FalGeneratorAdapter,
  ReplicateGeneratorAdapter,
  FalVideoGeneratorAdapter,
  createGenerator,
  createVideoGenerator,
  isFalVideoModelId,
} from "./capabilities/index.js";
export type {
  GeneratorAdapter,
  VideoGeneratorAdapter,
  GeneratorAdapterOptions,
  GenerateOpts,
  GeneratedImage,
  GeneratedVideo,
} from "./capabilities/index.js";

// ── Local Executors ──
export {
  registerLocalExecutors,
  executeResize,
  executeCrop,
  executeFormatConvert,
  bufferFromInput,
  writeArtifact,
} from "./local/index.js";
