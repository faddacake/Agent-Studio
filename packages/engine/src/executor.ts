import {
  nodeRegistry,
  NodeRuntimeKind,
  type NodeDefinition,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "@iterastudio/shared";

// ── Executor handler types ──

/**
 * Handler for provider node execution.
 * Injected at startup — the engine never imports provider-specific code.
 */
export type ProviderExecutor = (
  context: NodeExecutionContext,
  definition: NodeDefinition,
) => Promise<NodeExecutionResult>;

/**
 * Handler for local node execution (utility transforms).
 * Keyed by node type — each utility registers its own handler.
 */
export type LocalExecutor = (
  context: NodeExecutionContext,
  definition: NodeDefinition,
) => Promise<NodeExecutionResult>;

/**
 * Handler for capability node execution (scoring, formatting, export).
 * Keyed by node type.
 */
export type CapabilityExecutor = (
  context: NodeExecutionContext,
  definition: NodeDefinition,
) => Promise<NodeExecutionResult>;

// ── Executor Registry ──

/**
 * Central execution dispatcher that routes node execution by runtimeKind.
 *
 * Resolves node definitions from the NodeRegistry and dispatches to
 * the appropriate executor handler. The engine never hardcodes model
 * types — all routing is driven by the registry.
 *
 * Handlers are registered at startup by the worker/host process.
 */
export class NodeExecutor {
  private providerExecutor: ProviderExecutor | null = null;
  private localExecutors = new Map<string, LocalExecutor>();
  private capabilityExecutors = new Map<string, CapabilityExecutor>();

  /**
   * Register the provider execution handler.
   * There is one handler for all provider nodes — it uses the
   * NodeDefinition.provider field to route to the correct adapter.
   */
  setProviderExecutor(executor: ProviderExecutor): void {
    this.providerExecutor = executor;
  }

  /**
   * Register a local executor for a specific node type.
   * E.g., registerLocal("resize", resizeExecutor)
   */
  registerLocal(nodeType: string, executor: LocalExecutor): void {
    this.localExecutors.set(nodeType, executor);
  }

  /**
   * Register a capability executor for a specific node type.
   * E.g., registerCapability("clip-scoring", clipScoringExecutor)
   */
  registerCapability(nodeType: string, executor: CapabilityExecutor): void {
    this.capabilityExecutors.set(nodeType, executor);
  }

  /**
   * Execute a node.
   *
   * 1. Looks up the NodeDefinition from the registry
   * 2. Routes by runtimeKind to the appropriate handler
   * 3. Returns the execution result
   *
   * Throws if the node type is not registered or no handler is available.
   */
  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    // Determine node type from context — resolve from registry
    const nodeType = this.resolveNodeType(context);
    const definition = nodeRegistry.get(nodeType);

    if (!definition) {
      throw new Error(
        `No NodeDefinition found for type "${nodeType}". ` +
        `Ensure the node is registered before execution.`,
      );
    }

    // Run custom validation if defined
    if (definition.validate) {
      const validationError = definition.validate(context.params, context.inputs);
      if (validationError) {
        throw new Error(`Validation failed for node "${nodeType}": ${validationError}`);
      }
    }

    const startTime = Date.now();

    let result: NodeExecutionResult;

    switch (definition.runtimeKind) {
      case NodeRuntimeKind.Provider:
        result = await this.executeProvider(context, definition);
        break;

      case NodeRuntimeKind.Local:
        result = await this.executeLocal(context, definition);
        break;

      case NodeRuntimeKind.Capability:
        result = await this.executeCapability(context, definition);
        break;

      case NodeRuntimeKind.Virtual:
        result = this.executeVirtual(context, definition);
        break;

      default:
        throw new Error(
          `Unknown runtimeKind "${definition.runtimeKind}" for node type "${nodeType}"`,
        );
    }

    // Attach duration if not already set
    if (result.durationMs === undefined) {
      result.durationMs = Date.now() - startTime;
    }

    return result;
  }

  // ── Private dispatch methods ──

  private async executeProvider(
    context: NodeExecutionContext,
    definition: NodeDefinition,
  ): Promise<NodeExecutionResult> {
    if (!this.providerExecutor) {
      throw new Error(
        `No provider executor registered. Cannot execute provider node "${definition.type}". ` +
        `Call NodeExecutor.setProviderExecutor() at startup.`,
      );
    }

    if (!definition.provider) {
      throw new Error(
        `Provider node "${definition.type}" has no provider configuration. ` +
        `Ensure provider.providerId and provider.modelId are set in the NodeDefinition.`,
      );
    }

    // Enrich context with provider info from the definition
    const enrichedContext: NodeExecutionContext = {
      ...context,
      providerId: context.providerId ?? definition.provider.providerId,
      modelId: context.modelId ?? definition.provider.modelId,
    };

    return this.providerExecutor(enrichedContext, definition);
  }

  private async executeLocal(
    context: NodeExecutionContext,
    definition: NodeDefinition,
  ): Promise<NodeExecutionResult> {
    const handler = this.localExecutors.get(definition.type);
    if (!handler) {
      throw new Error(
        `No local executor registered for node type "${definition.type}". ` +
        `Call NodeExecutor.registerLocal("${definition.type}", handler) at startup.`,
      );
    }

    return handler(context, definition);
  }

  private async executeCapability(
    context: NodeExecutionContext,
    definition: NodeDefinition,
  ): Promise<NodeExecutionResult> {
    const handler = this.capabilityExecutors.get(definition.type);
    if (!handler) {
      throw new Error(
        `No capability executor registered for node type "${definition.type}". ` +
        `Call NodeExecutor.registerCapability("${definition.type}", handler) at startup.`,
      );
    }

    return handler(context, definition);
  }

  private executeVirtual(
    _context: NodeExecutionContext,
    _definition: NodeDefinition,
  ): NodeExecutionResult {
    // Virtual nodes pass through — no execution, no cost
    return {
      outputs: {},
      cost: 0,
      durationMs: 0,
    };
  }

  /**
   * Resolve the node type string from the execution context.
   * The context may have providerId/modelId overrides from the workflow
   * node data, but the canonical type comes from the node itself.
   */
  private resolveNodeType(context: NodeExecutionContext): string {
    // The context must carry the node type — this is set by the coordinator
    // when dispatching. We use a convention: the params contain __nodeType,
    // or it's inferred from providerId/modelId.
    const explicit = context.params.__nodeType as string | undefined;
    if (explicit) return explicit;

    // Fallback: construct provider node type from providerId/modelId
    if (context.providerId && context.modelId) {
      // Check if a specific provider node is registered
      const providerType = `${context.providerId}/${context.modelId}`;
      if (nodeRegistry.has(providerType)) return providerType;
    }

    throw new Error(
      `Cannot resolve node type from execution context. ` +
      `Ensure __nodeType is set in params or providerId/modelId map to a registered definition.`,
    );
  }
}

/**
 * Global singleton executor instance.
 * Handlers are registered at startup by the worker process.
 */
export const nodeExecutor = new NodeExecutor();
