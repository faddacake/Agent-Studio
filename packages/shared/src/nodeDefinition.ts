import { z } from "zod";
import { PortType } from "./portTypes.js";

// ── Runtime Kind ──

/**
 * Discriminates how a node executes at runtime.
 * - provider:   calls an external AI provider via adapter (e.g. Replicate, Fal)
 * - local:      executes locally without network calls (e.g. resize, crop)
 * - virtual:    no execution — passthrough or annotation (e.g. comment, group)
 * - capability: reusable pipeline step that may involve local or remote processing
 *               but is not a direct provider model call (e.g. scoring, formatting, export)
 */
export enum NodeRuntimeKind {
  Provider = "provider",
  Local = "local",
  Virtual = "virtual",
  Capability = "capability",
}

// ── Node Categories ──

export enum NodeCategory {
  Agent = "agent",
  Generation = "generation",
  Input = "input",
  Output = "output",
  Transform = "transform",
  Utility = "utility",
  Scoring = "scoring",
  Formatting = "formatting",
  Export = "export",
  Annotation = "annotation",
}

// ── Port Definition ──

export interface PortDefinition {
  /** Unique port identifier within the node (e.g. "image_in", "text_out") */
  id: string;
  /** Human-readable label */
  label: string;
  /** Data type flowing through the port */
  type: PortType;
  /** Whether this port is required (default: true) */
  required?: boolean;
  /** Whether this port accepts multiple connections (arrays) */
  isArray?: boolean;
  /** Default value for input ports (optional) */
  defaultValue?: unknown;
  /** Description shown in tooltips */
  description?: string;
}

// ── Parameter Schema ──

/**
 * Describes a single parameter that a node accepts.
 * This is a portable representation that can drive form rendering
 * and be converted to/from Zod schemas.
 */
export interface NodeParameterField {
  /** Parameter key used in node data.params */
  key: string;
  /** Human-readable label */
  label: string;
  /** Parameter data type */
  type: "string" | "number" | "boolean" | "enum" | "image" | "json";
  /** Whether the parameter is required (default: false) */
  required?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Description / help text */
  description?: string;
  /** For number: minimum value */
  min?: number;
  /** For number: maximum value */
  max?: number;
  /** For number: step increment */
  step?: number;
  /** For enum: allowed values */
  options?: Array<{ value: string; label: string }>;
  /** For string: placeholder text */
  placeholder?: string;
  /** For string: render as multiline textarea */
  multiline?: boolean;
}

/**
 * The full parameter schema for a node.
 * An ordered array of fields — order determines rendering order.
 */
export type NodeParameterSchema = NodeParameterField[];

// ── UI Schema ──

/**
 * Optional hints for how the inspector should render this node's config.
 * Kept separate from the parameter schema so the same params can be
 * rendered differently in different contexts.
 */
export interface UISchema {
  /** Group fields into collapsible sections */
  groups?: Array<{
    label: string;
    fields: string[];
    collapsed?: boolean;
  }>;
  /** Fields to hide from the inspector (still functional, just not shown) */
  hidden?: string[];
  /** Override the default widget for a field */
  widgets?: Record<string, "slider" | "color" | "textarea" | "toggle" | "dropdown" | "upload">;
  /** Custom width for the inspector panel when this node is selected */
  panelWidth?: number;
}

// ── Cost Estimation ──

export interface CostEstimate {
  /** Estimated cost in USD */
  estimated: number;
  /** Whether this is an approximation */
  isApproximate: boolean;
  /** Human-readable breakdown */
  breakdown?: string;
}

// ── Agent Step (ReAct pattern) ──

/**
 * A single Thought → Action → Observation step emitted by a ReAct Agent node.
 * Stored on NodeState.agentSteps and streamed via the SSE snapshot so the
 * Run Debugger can display live reasoning traces.
 */
export interface AgentStep {
  /** Step index (0-based) */
  index: number;
  /** LLM reasoning text */
  thought: string;
  /** Tool the agent chose to call (absent on final-answer steps) */
  action?: {
    tool: string;
    params: Record<string, unknown>;
  };
  /** Result returned by the tool invocation */
  observation?: string;
  /** True if this is the "Final Answer" step — no further actions follow */
  isFinal: boolean;
  /** Final answer text, set only when isFinal is true */
  answer?: string;
  /** Unix timestamp (ms) when this step was emitted */
  timestamp: number;
}

// ── Execution Context & Result ──

export interface NodeExecutionContext {
  /** The node instance ID within the workflow */
  nodeId: string;
  /** The run ID this execution belongs to */
  runId: string;
  /** Resolved input values (port id → value) */
  inputs: Record<string, unknown>;
  /** Resolved parameter values */
  params: Record<string, unknown>;
  /** Provider ID (for provider nodes) */
  providerId?: string;
  /** Model ID (for provider nodes) */
  modelId?: string;
  /** Directory for writing output assets */
  outputDir: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Streaming callback for ReAct Agent nodes.
   * Called once per Thought/Action/Observation cycle so the Run Debugger
   * can display a live reasoning trace. Optional — ignored by all other nodes.
   */
  onAgentStep?: (step: AgentStep) => void;
}

export interface NodeExecutionResult {
  /** Output values (port id → value) */
  outputs: Record<string, unknown>;
  /** Actual cost incurred (USD) */
  cost?: number;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Additional metadata (provider response, debug info, etc.) */
  metadata?: Record<string, unknown>;
}

// ── Node Definition ──

/**
 * The core type that fully describes a node's identity, capabilities,
 * ports, parameters, and runtime behavior. Every executable capability
 * in AI Studio is represented as a NodeDefinition.
 */
export interface NodeDefinition {
  /** Unique type identifier (e.g. "image-generation", "resize", "clip-scoring") */
  type: string;
  /** Human-readable label */
  label: string;
  /** Category for grouping in the palette */
  category: NodeCategory;
  /** Short description shown in tooltips and palette */
  description: string;
  /** Icon identifier (provider icon, utility icon, etc.) */
  icon?: string;

  /** Input port definitions */
  inputs: PortDefinition[];
  /** Output port definitions */
  outputs: PortDefinition[];

  /** Parameter schema — drives inspector form rendering */
  parameterSchema: NodeParameterSchema;
  /** Optional UI rendering hints */
  uiSchema?: UISchema;

  /** How this node executes at runtime */
  runtimeKind: NodeRuntimeKind;

  /**
   * For provider nodes: which provider and model this node targets.
   * Omitted for local/virtual/capability nodes.
   */
  provider?: {
    providerId: string;
    modelId: string;
  };

  /**
   * Optional function to estimate cost before execution.
   * For provider nodes, this is typically derived from model pricing.
   */
  estimateCost?: (params: Record<string, unknown>) => CostEstimate;

  /**
   * Optional validation hooks beyond parameter schema validation.
   * Return null if valid, or a string error message.
   */
  validate?: (params: Record<string, unknown>, inputs: Record<string, unknown>) => string | null;

  /** Tags for filtering and search (e.g. "recommended", "fast", "experimental") */
  tags?: string[];

  /** Whether this node type is currently available for use */
  isAvailable?: boolean;
}

// ── Zod schemas for serialization ──

export const PortDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.nativeEnum(PortType),
  required: z.boolean().optional(),
  isArray: z.boolean().optional(),
  description: z.string().optional(),
});

export const NodeParameterFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["string", "number", "boolean", "enum", "image", "json"]),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
  multiline: z.boolean().optional(),
});

/**
 * Serializable subset of NodeDefinition — everything except functions.
 * Used to transmit definitions over the wire (API responses, SSR).
 */
export const SerializableNodeDefinitionSchema = z.object({
  type: z.string(),
  label: z.string(),
  category: z.nativeEnum(NodeCategory),
  description: z.string(),
  icon: z.string().optional(),
  inputs: z.array(PortDefinitionSchema),
  outputs: z.array(PortDefinitionSchema),
  parameterSchema: z.array(NodeParameterFieldSchema),
  runtimeKind: z.nativeEnum(NodeRuntimeKind),
  provider: z.object({
    providerId: z.string(),
    modelId: z.string(),
  }).optional(),
  tags: z.array(z.string()).optional(),
  isAvailable: z.boolean().optional(),
});

export type SerializableNodeDefinition = z.infer<typeof SerializableNodeDefinitionSchema>;

/**
 * Extract the serializable subset from a full NodeDefinition.
 */
export function toSerializable(def: NodeDefinition): SerializableNodeDefinition {
  return {
    type: def.type,
    label: def.label,
    category: def.category,
    description: def.description,
    icon: def.icon,
    inputs: def.inputs,
    outputs: def.outputs,
    parameterSchema: def.parameterSchema,
    runtimeKind: def.runtimeKind,
    provider: def.provider,
    tags: def.tags,
    isAvailable: def.isAvailable,
  };
}
