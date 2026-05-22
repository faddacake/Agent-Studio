import type { NodeDefinition, SerializableNodeDefinition } from "./nodeDefinition.js";
import { NodeCategory, toSerializable } from "./nodeDefinition.js";

/**
 * Central registry for all node definitions in Agent Studio.
 *
 * Consumers (inspector, palette, engine, validator) query this registry
 * instead of hardcoding knowledge about node types.
 *
 * Usage:
 *   import { nodeRegistry } from "@aistudio/shared";
 *   nodeRegistry.register(myNodeDef);
 *   const def = nodeRegistry.get("resize");
 */
export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();

  /** Register a node definition. Overwrites if the type already exists. */
  register(definition: NodeDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  /** Register multiple definitions at once. */
  registerAll(definitions: NodeDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /** Get a node definition by type. Returns undefined if not found. */
  get(type: string): NodeDefinition | undefined {
    return this.definitions.get(type);
  }

  /** Get a node definition by type, throwing if not found. */
  getOrThrow(type: string): NodeDefinition {
    const def = this.definitions.get(type);
    if (!def) {
      throw new Error(`Node definition not found: "${type}"`);
    }
    return def;
  }

  /** Get all registered definitions. */
  getAll(): NodeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Get definitions filtered by category. */
  getByCategory(category: NodeCategory): NodeDefinition[] {
    return this.getAll().filter((def) => def.category === category);
  }

  /** Get definitions filtered by a custom predicate. */
  filter(predicate: (def: NodeDefinition) => boolean): NodeDefinition[] {
    return this.getAll().filter(predicate);
  }

  /** Get all available (enabled) definitions. */
  getAvailable(): NodeDefinition[] {
    return this.getAll().filter((def) => def.isAvailable !== false);
  }

  /** Check if a definition exists for the given type. */
  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /** Remove a definition by type. */
  unregister(type: string): boolean {
    return this.definitions.delete(type);
  }

  /** Get all definitions as serializable objects (no functions). */
  getAllSerializable(): SerializableNodeDefinition[] {
    return this.getAll().map(toSerializable);
  }

  /** Get the total number of registered definitions. */
  get size(): number {
    return this.definitions.size;
  }

  /** Clear all registered definitions. Primarily for testing. */
  clear(): void {
    this.definitions.clear();
  }
}

/** Global singleton registry. Import and use directly. */
export const nodeRegistry = new NodeRegistry();
