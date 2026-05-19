import type { NodeDefinition } from "../nodeDefinition.js";
import { NodeCategory, NodeRuntimeKind } from "../nodeDefinition.js";
import { PortType } from "../portTypes.js";
import { NodeType } from "../nodeTypes.js";

/**
 * CLIP Scoring node — evaluates image quality or prompt relevance.
 *
 * Receives an array of images and an optional text prompt, computes a
 * similarity/quality score per image, and returns structured results.
 * The executor uses a mock scoring function until a real CLIP model
 * (e.g. open_clip) is integrated.
 */
export const clipScoringNode: NodeDefinition = {
  type: "clip-scoring",
  label: "CLIP Scoring",
  category: NodeCategory.Scoring,
  description: "Score image quality or prompt relevance using CLIP similarity.",
  icon: "bar-chart",

  inputs: [
    {
      id: "images_in",
      label: "Images",
      type: PortType.Image,
      required: true,
      isArray: true,
      description: "Array of images to score",
    },
    {
      id: "prompt_in",
      label: "Prompt",
      type: PortType.Text,
      required: false,
      description: "Optional text prompt to score relevance against",
    },
  ],
  outputs: [
    {
      id: "scores_out",
      label: "Scores",
      type: PortType.Json,
      description: "Array of numeric scores (one per input image, backward-compatible)",
    },
    {
      id: "scored_images_out",
      label: "Scored Images",
      type: PortType.Json,
      description: "CandidateCollection with scores attached — connects directly to Ranking",
    },
  ],

  parameterSchema: [
    {
      key: "model",
      label: "Model",
      type: "enum",
      defaultValue: "open_clip",
      options: [
        { value: "open_clip", label: "OpenCLIP (ViT-B/32)" },
        { value: "open_clip_large", label: "OpenCLIP (ViT-L/14)" },
      ],
      description: "CLIP model variant to use for scoring",
    },
    {
      key: "normalizeScores",
      label: "Normalize Scores",
      type: "boolean",
      defaultValue: true,
      description: "Normalize scores to 0–100 range",
    },
    {
      key: "topKPreview",
      label: "Top-K Preview",
      type: "number",
      min: 1,
      max: 100,
      step: 1,
      description: "If set, only include the top K scored images in output (optional)",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Model", fields: ["model"] },
      { label: "Output", fields: ["normalizeScores", "topKPreview"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["scoring", "quality", "clip", "image"],
  isAvailable: true,
};

/**
 * Social Format node — generates platform-specific social content per candidate.
 *
 * Accepts a CandidateCollection or CandidateSelection (typically from Ranking)
 * and attaches social metadata (caption, hook, hashtags, CTA) per candidate
 * per platform. Preserves all upstream scores and ranks.
 */
export const socialFormatNode: NodeDefinition = {
  type: "social-format",
  label: "Social Format",
  category: NodeCategory.Formatting,
  description: "Generate platform-specific captions, hashtags, hooks, and CTAs per candidate.",
  icon: "share-2",

  inputs: [
    {
      id: "candidates_in",
      label: "Candidates",
      type: PortType.Json,
      required: true,
      description: "CandidateCollection or CandidateSelection from upstream (e.g. Ranking)",
    },
    {
      id: "text_in",
      label: "Context Text",
      type: PortType.Text,
      required: false,
      description: "Optional text context for caption generation (overrides candidate prompt)",
    },
  ],
  outputs: [
    {
      id: "formatted_out",
      label: "Formatted Candidates",
      type: PortType.Json,
      description: "CandidateCollection with social variants attached per candidate",
    },
  ],

  parameterSchema: [
    {
      key: "platforms",
      label: "Platforms",
      type: "json",
      defaultValue: ["instagram", "x", "linkedin"],
      description: "Which platforms to generate variants for",
    },
    {
      key: "tone",
      label: "Tone",
      type: "enum",
      defaultValue: "professional",
      options: [
        { value: "professional", label: "Professional" },
        { value: "casual", label: "Casual" },
        { value: "bold", label: "Bold" },
      ],
      description: "Tone of the generated captions",
    },
    {
      key: "topic",
      label: "Topic",
      type: "string",
      placeholder: "AI art, digital creation",
      description: "Topic keywords for hashtag generation",
    },
    {
      key: "includeHashtags",
      label: "Include Hashtags",
      type: "boolean",
      defaultValue: true,
    },
    {
      key: "includeCTA",
      label: "Include CTA",
      type: "boolean",
      defaultValue: true,
      description: "Include a call-to-action per platform",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Platforms", fields: ["platforms"] },
      { label: "Content", fields: ["tone", "topic", "includeHashtags", "includeCTA"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["formatting", "social", "caption", "hashtags"],
  isAvailable: true,
};

/**
 * Export Bundle node — assembles a structured export manifest from candidates.
 *
 * Accepts a CandidateCollection (typically from SocialFormat or Ranking)
 * and produces an export manifest with asset references, social content,
 * scores, and ranks. Ready for future real zip/folder generation.
 */
export const exportBundleNode: NodeDefinition = {
  type: "export-bundle",
  label: "Export Bundle",
  category: NodeCategory.Export,
  description: "Assemble an export manifest with assets, captions, scores, and ranks from candidates.",
  icon: "package",

  inputs: [
    {
      id: "candidates_in",
      label: "Candidates",
      type: PortType.Json,
      required: true,
      description: "CandidateCollection from upstream (e.g. SocialFormat or Ranking)",
    },
  ],
  outputs: [
    {
      id: "bundle_out",
      label: "Bundle Manifest",
      type: PortType.Json,
      description: "Structured export manifest with assets, social entries, and summary",
    },
    {
      id: "candidates_out",
      label: "Exported Candidates",
      type: PortType.Json,
      description: "CandidateCollection with export metadata attached",
    },
  ],

  parameterSchema: [
    {
      key: "bundleName",
      label: "Bundle Name",
      type: "string",
      placeholder: "campaign-spring-2026",
      description: "Name for the export bundle",
    },
    {
      key: "format",
      label: "Export Format",
      type: "enum",
      defaultValue: "manifest-only",
      options: [
        { value: "manifest-only", label: "Manifest Only (JSON)" },
        { value: "zip", label: "ZIP Archive" },
        { value: "folder", label: "Folder Structure" },
      ],
      description: "Output format (zip/folder require file system — currently manifest-only)",
    },
    {
      key: "includeImages",
      label: "Include Image Assets",
      type: "boolean",
      defaultValue: true,
    },
    {
      key: "includeMetadata",
      label: "Include Metadata",
      type: "boolean",
      defaultValue: true,
      description: "Include provenance and collection metadata",
    },
    {
      key: "includeSocialText",
      label: "Include Social Text",
      type: "boolean",
      defaultValue: true,
      description: "Include captions, hashtags, and CTAs from SocialFormat",
    },
    {
      key: "includeScores",
      label: "Include Scores",
      type: "boolean",
      defaultValue: true,
      description: "Include scoring data per candidate",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Bundle", fields: ["bundleName", "format"] },
      { label: "Contents", fields: ["includeImages", "includeMetadata", "includeSocialText", "includeScores"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["export", "bundle", "campaign", "manifest"],
  isAvailable: true,
};

/**
 * Ranking node — sorts and selects items by score.
 *
 * Takes parallel arrays of items and scores, sorts by score descending,
 * and returns ranked results. Supports topK, threshold, and sort-only modes.
 */
export const rankingNode: NodeDefinition = {
  type: "ranking",
  label: "Ranking",
  category: NodeCategory.Scoring,
  description: "Sort and select items by score. Supports top-K selection, threshold filtering, and plain sorting.",
  icon: "trophy",

  inputs: [
    {
      id: "items_in",
      label: "Items",
      type: PortType.Json,
      required: true,
      isArray: true,
      description: "CandidateCollection or array of items to rank",
    },
    {
      id: "scores_in",
      label: "Scores",
      type: PortType.Json,
      required: false,
      isArray: true,
      description: "Parallel score array (optional if items already have scores from upstream)",
    },
  ],
  outputs: [
    {
      id: "top_items_out",
      label: "Top Items",
      type: PortType.Json,
      description: "CandidateSelection — selected items based on mode (topK or threshold)",
    },
    {
      id: "ranked_items_out",
      label: "Ranked Items",
      type: PortType.Json,
      description: "CandidateCollection — all items sorted by score with rank metadata",
    },
  ],

  parameterSchema: [
    {
      key: "mode",
      label: "Selection Mode",
      type: "enum",
      defaultValue: "topK",
      options: [
        { value: "topK", label: "Top K" },
        { value: "threshold", label: "Threshold" },
        { value: "sort", label: "Sort Only" },
      ],
      description: "How to select results: top K by count, threshold by minimum score, or sort only",
    },
    {
      key: "topK",
      label: "Top K",
      type: "number",
      min: 1,
      max: 100,
      step: 1,
      defaultValue: 5,
      description: "Number of top items to select (used in topK mode)",
    },
    {
      key: "threshold",
      label: "Score Threshold",
      type: "number",
      min: 0,
      max: 100,
      step: 1,
      description: "Minimum score to include (used in threshold mode)",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Selection", fields: ["mode", "topK", "threshold"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["scoring", "ranking", "selection", "filter"],
  isAvailable: true,
};

/**
 * Best-of-N node — generates N candidate images, scores them, and selects top K.
 *
 * Provides a complete generation → scoring → selection loop in one node.
 * The generator is mock-backed today; it is designed to be replaced by a
 * real provider (Replicate, Fal, etc.) without changing the output contract.
 *
 * Outputs a canonical CandidateSelection ready for SocialFormat or ExportBundle.
 */
export const bestOfNNode: NodeDefinition = {
  type: NodeType.BestOfN,
  label: "Best of N",
  category: NodeCategory.Generation,
  description: "Generate N image candidates, score them, and select the top K.",
  icon: "sparkles",

  inputs: [
    {
      id: "prompt_in",
      label: "Prompt",
      type: PortType.Text,
      required: false,
      description: "Text prompt used to generate and score candidates",
    },
  ],
  outputs: [
    {
      id: "selection_out",
      label: "Top Candidates",
      type: PortType.Json,
      description: "CandidateSelection — top K images, scored and ranked",
    },
    {
      id: "all_candidates_out",
      label: "All Candidates",
      type: PortType.Json,
      description: "CandidateCollection — all N images with scores and ranks",
    },
  ],

  parameterSchema: [
    {
      key: "n",
      label: "Number of Candidates (N)",
      type: "number",
      required: true,
      min: 1,
      max: 32,
      step: 1,
      defaultValue: 4,
      description: "How many image candidates to generate",
    },
    {
      key: "k",
      label: "Select Top K",
      type: "number",
      required: true,
      min: 1,
      max: 16,
      step: 1,
      defaultValue: 2,
      description: "How many top-scored candidates to include in the selection",
    },
    {
      key: "provider",
      label: "Provider",
      type: "enum",
      defaultValue: "mock",
      options: [
        { value: "mock", label: "Mock (deterministic, no API key)" },
        { value: "fal",  label: "Fal.ai (requires FAL_API_KEY)" },
      ],
      description: "Image generation provider. 'mock' always works; 'fal' requires FAL_API_KEY.",
    },
    {
      key: "model",
      label: "Model",
      type: "enum",
      defaultValue: "mock-sdxl",
      options: [
        { value: "mock-sdxl",           label: "Mock SDXL (deterministic)" },
        { value: "fal-ai/flux/schnell", label: "FLUX Schnell (Fal.ai, fast)" },
        { value: "fal-ai/flux-pro/v1.1", label: "FLUX Pro v1.1 (Fal.ai, quality)" },
      ],
      description: "Generation model. Must be compatible with the selected provider.",
    },
    {
      key: "seed",
      label: "Seed",
      type: "number",
      required: false,
      min: 0,
      step: 1,
      description: "Optional seed for reproducible generation. When omitted the seed is derived from the prompt.",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Generation", fields: ["n", "provider", "model", "seed"] },
      { label: "Selection", fields: ["k"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["generation", "selection", "best-of-n", "image"],
  isAvailable: true,
};

/**
 * ReAct Agent node — autonomous reasoning + acting loop.
 *
 * Implements the ReAct (Reasoning + Acting) pattern: the LLM iterates through
 * Thought → Action → Observation cycles until it produces a Final Answer.
 * Tools are canvas nodes invoked by the agent during execution.
 *
 * Supports Anthropic (Claude), OpenAI (GPT), Grok (xAI), and Ollama (local).
 * The API key is entered directly in the node params (BYO key — never stored
 * platform-side beyond the node's own param field).
 *
 * Live reasoning steps are streamed to the Run Debugger via the `agent:step`
 * RunEvent so you can watch the agent think in real time.
 */
export const reactAgentNode: NodeDefinition = {
  type: "react-agent",
  label: "ReAct Agent",
  category: NodeCategory.Agent,
  description: "Autonomous LLM agent that reasons and acts through Thought/Action/Observation cycles to complete a goal.",
  icon: "bot",

  inputs: [
    {
      id: "goal_in",
      label: "Goal",
      type: PortType.Text,
      required: false,
      description: "Task or goal for the agent (overrides the Goal param when connected)",
    },
  ],
  outputs: [
    {
      id: "answer_out",
      label: "Answer",
      type: PortType.Text,
      description: "The agent's final answer after completing all reasoning steps",
    },
    {
      id: "steps_out",
      label: "Steps",
      type: PortType.Json,
      description: "Array of AgentStep objects (Thought / Action / Observation trace)",
    },
  ],

  parameterSchema: [
    {
      key: "goal",
      label: "Goal",
      type: "string",
      multiline: true,
      placeholder: "Describe what you want the agent to accomplish...",
      description: "The task for the agent. Wire the goal_in port to override this at runtime.",
    },
    {
      key: "provider",
      label: "LLM Provider",
      type: "enum",
      defaultValue: "anthropic",
      options: [
        { value: "anthropic", label: "Anthropic (Claude)" },
        { value: "openai",    label: "OpenAI (GPT)" },
        { value: "grok",      label: "Grok (xAI)" },
        { value: "ollama",    label: "Ollama (Local)" },
      ],
      description: "Which LLM provider to use for the reasoning loop",
    },
    {
      key: "model",
      label: "Model",
      type: "string",
      placeholder: "e.g. claude-3-5-haiku-20241022",
      description: "Model name. Leave blank to use the provider default (haiku / gpt-4o-mini / grok-3-mini / llama3.2).",
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "string",
      placeholder: "sk-ant-... or sk-... or xai-...",
      description: "Your LLM provider API key. Not required for Ollama (local). Never logged or stored by the platform.",
    },
    {
      key: "maxSteps",
      label: "Max Steps",
      type: "number",
      min: 1,
      max: 20,
      step: 1,
      defaultValue: 10,
      description: "Maximum number of Thought/Action/Observation cycles before forcing a final answer",
    },
    {
      key: "tools",
      label: "Tools",
      type: "json",
      defaultValue: [],
      description: "Array of node type strings the agent can use as tools, e.g. [\"prompt-template\"]. Empty = no tools (reasoning only).",
    },
  ],

  uiSchema: {
    groups: [
      { label: "Goal",     fields: ["goal"] },
      { label: "LLM",      fields: ["provider", "model", "apiKey"] },
      { label: "Behavior", fields: ["maxSteps", "tools"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Capability,
  tags: ["agent", "react", "llm", "autonomous", "reasoning"],
  isAvailable: true,
};

export const capabilityNodes: NodeDefinition[] = [
  reactAgentNode,
  bestOfNNode,
  clipScoringNode,
  socialFormatNode,
  exportBundleNode,
  rankingNode,
];
