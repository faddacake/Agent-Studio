import type { NodeDefinition, NodeParameterSchema } from "../nodeDefinition.js";
import { NodeCategory, NodeRuntimeKind } from "../nodeDefinition.js";
import { PortType } from "../portTypes.js";
import { NodeType } from "../nodeTypes.js";

/**
 * Common parameter schema for image generation models.
 * Individual provider models can extend or override these defaults.
 */
const baseImageGenParams: NodeParameterSchema = [
  {
    key: "prompt",
    label: "Prompt",
    type: "string",
    required: true,
    multiline: true,
    placeholder: "Describe the image you want to generate...",
    description: "Text prompt for image generation",
  },
  {
    key: "negative_prompt",
    label: "Negative Prompt",
    type: "string",
    multiline: true,
    placeholder: "What to avoid in the image...",
    description: "Things to exclude from the generated image",
  },
  {
    key: "width",
    label: "Width",
    type: "number",
    min: 256,
    max: 4096,
    step: 64,
    defaultValue: 1024,
  },
  {
    key: "height",
    label: "Height",
    type: "number",
    min: 256,
    max: 4096,
    step: 64,
    defaultValue: 1024,
  },
  {
    key: "num_inference_steps",
    label: "Steps",
    type: "number",
    min: 1,
    max: 150,
    step: 1,
    defaultValue: 28,
    description: "Number of inference steps — higher = better quality, slower",
  },
  {
    key: "guidance_scale",
    label: "Guidance Scale",
    type: "number",
    min: 1,
    max: 30,
    step: 0.5,
    defaultValue: 7.5,
    description: "How closely to follow the prompt",
  },
  {
    key: "seed",
    label: "Seed",
    type: "number",
    min: -1,
    max: 2147483647,
    step: 1,
    defaultValue: -1,
    description: "Random seed (-1 for random)",
  },
];

const baseVideoGenParams: NodeParameterSchema = [
  {
    key: "prompt",
    label: "Prompt",
    type: "string",
    required: true,
    multiline: true,
    placeholder: "Describe the video you want to generate...",
  },
  {
    key: "duration",
    label: "Duration (seconds)",
    type: "number",
    min: 1,
    max: 30,
    step: 1,
    defaultValue: 5,
  },
  {
    key: "resolution",
    label: "Resolution",
    type: "enum",
    defaultValue: "720p",
    options: [
      { value: "480p", label: "480p" },
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
    ],
  },
  {
    key: "seed",
    label: "Seed",
    type: "number",
    min: -1,
    max: 2147483647,
    step: 1,
    defaultValue: -1,
  },
];

/**
 * Base image generation node definition.
 * This serves as the template — provider-specific nodes are created
 * by combining this with model metadata from the adapter.
 */
export const imageGenerationNode: NodeDefinition = {
  type: NodeType.ImageGeneration,
  label: "Image Generation",
  category: NodeCategory.Generation,
  description: "Generate an image using an AI model. Select a provider and model in the inspector.",
  icon: "image",

  inputs: [
    {
      id: "image_in",
      label: "Reference Image",
      type: PortType.Image,
      required: false,
      description: "Optional reference image for img2img generation",
    },
    {
      id: "prompt_in",
      label: "Prompt",
      type: PortType.Text,
      required: false,
      description: "Prompt from an upstream prompt-template node (overrides the prompt parameter)",
    },
  ],
  outputs: [
    { id: "image_out", label: "Generated Image", type: PortType.Image },
  ],

  parameterSchema: baseImageGenParams,

  uiSchema: {
    groups: [
      { label: "Prompt", fields: ["prompt", "negative_prompt"] },
      { label: "Dimensions", fields: ["width", "height"] },
      { label: "Advanced", fields: ["num_inference_steps", "guidance_scale", "seed"], collapsed: true },
    ],
  },

  runtimeKind: NodeRuntimeKind.Provider,
  // Default provider — used when a workflow node has the generic "image-generation"
  // type rather than a model-specific type (e.g. nodes created from starter graphs).
  provider: {
    providerId: "fal",
    modelId: "fal-ai/flux-pro/v1.1",
  },
  tags: ["generation", "image"],
  isAvailable: true,
};

/**
 * Base video generation node definition.
 */
export const videoGenerationNode: NodeDefinition = {
  type: NodeType.VideoGeneration,
  label: "Video Generation",
  category: NodeCategory.Generation,
  description: "Generate a video using an AI model.",
  icon: "video",

  inputs: [
    {
      id: "image_in",
      label: "Reference Image",
      type: PortType.Image,
      required: false,
      description: "Optional reference image for image-to-video generation",
    },
    {
      id: "prompt_in",
      label: "Prompt",
      type: PortType.Text,
      required: false,
      description: "Prompt from an upstream prompt-template node",
    },
  ],
  outputs: [
    { id: "video_out", label: "Generated Video", type: PortType.Video },
  ],

  parameterSchema: baseVideoGenParams,

  uiSchema: {
    groups: [
      { label: "Prompt", fields: ["prompt"] },
      { label: "Settings", fields: ["duration", "resolution", "seed"] },
    ],
  },

  runtimeKind: NodeRuntimeKind.Provider,
  // Default provider — used when a workflow node has the generic "video-generation"
  // type rather than a model-specific type.
  provider: {
    providerId: "fal",
    modelId: "fal-ai/kling-video/v1.6/standard/text-to-video",
  },
  tags: ["generation", "video"],
  isAvailable: true,
};

/**
 * Create a provider-specific node definition by merging model metadata
 * with the base generation node template.
 *
 * This is the bridge between the model catalog (config/models.ts)
 * and the node registry. It allows each model to appear as a
 * distinct, fully-described node definition.
 */
export function createProviderNodeDefinition(opts: {
  type: string;
  label: string;
  description: string;
  providerId: string;
  modelId: string;
  category: "image" | "video";
  parameterOverrides?: NodeParameterSchema;
  tags?: string[];
  isAvailable?: boolean;
  estimatedCost?: number;
}): NodeDefinition {
  const base = opts.category === "image" ? imageGenerationNode : videoGenerationNode;
  const costPerRun = opts.estimatedCost;

  return {
    ...base,
    type: opts.type,
    label: opts.label,
    description: opts.description,
    provider: {
      providerId: opts.providerId,
      modelId: opts.modelId,
    },
    parameterSchema: opts.parameterOverrides ?? base.parameterSchema,
    tags: opts.tags ?? base.tags,
    isAvailable: opts.isAvailable ?? true,
    estimateCost: costPerRun != null
      ? () => ({ estimated: costPerRun, isApproximate: true, breakdown: `~$${costPerRun.toFixed(2)} per generation` })
      : undefined,
  };
}

export const providerNodes: NodeDefinition[] = [imageGenerationNode, videoGenerationNode];
