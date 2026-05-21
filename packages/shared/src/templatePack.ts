/**
 * Template Pack types and loader for Agent Studio.
 *
 * Template packs are bundles of pre-built workflow templates that can be
 * installed without a hosted marketplace. Supported sources:
 * - builtin: shipped with Agent Studio
 * - user: created by the current user
 * - imported: loaded from a JSON file or URL
 * - premium: gated by license tier (future)
 *
 * Each pack contains a manifest (metadata) and a map of template IDs
 * to WorkflowGraph objects. The loader manages registration, lookup,
 * and availability checking against the node registry.
 */

import { z } from "zod";
import { WorkflowGraphSchema, type WorkflowGraph } from "./workflowSchema.js";
import { nodeRegistry } from "./nodeRegistry.js";

// ── Types ──

export type TemplatePackSource = "builtin" | "user" | "imported" | "premium";

export const TemplatePackManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  author: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  templates: z.array(z.string()),
  previews: z.record(z.string()).optional(),
  /** Per-template example prompts injected into the prompt-template node at load time. */
  defaultPrompts: z.record(z.string()).optional(),
  /** Ordered list of template IDs to surface in the featured/empty-state panel. */
  featuredTemplates: z.array(z.string()).optional(),
  requiredProviders: z.array(z.string()).optional(),
  requiredNodeTypes: z.array(z.string()).optional(),
  source: z.enum(["builtin", "user", "imported", "premium"]),
});

export type TemplatePackManifest = z.infer<typeof TemplatePackManifestSchema>;

export interface TemplatePack {
  manifest: TemplatePackManifest;
  templates: Record<string, WorkflowGraph>;
}

export interface TemplateEntry {
  id: string;
  packId: string;
  name: string;
  graph: WorkflowGraph;
  preview?: string;
}

// ── Availability check result ──

export interface PackAvailability {
  available: boolean;
  missingNodeTypes: string[];
  missingProviders: string[];
}

// ── Loader ──

/**
 * Manages registration and lookup of template packs.
 *
 * Usage:
 *   const loader = new TemplatePackLoader();
 *   loader.register(myPack);
 *   const templates = loader.getAllTemplates();
 */
export class TemplatePackLoader {
  private packs = new Map<string, TemplatePack>();

  /** Register a template pack. Overwrites if pack ID already exists. */
  register(pack: TemplatePack): void {
    this.packs.set(pack.manifest.id, pack);
  }

  /** Register multiple packs at once. */
  registerAll(packs: TemplatePack[]): void {
    for (const pack of packs) {
      this.register(pack);
    }
  }

  /** Unregister a pack by ID. */
  unregister(packId: string): boolean {
    return this.packs.delete(packId);
  }

  /** Get a pack by ID. */
  getPack(packId: string): TemplatePack | undefined {
    return this.packs.get(packId);
  }

  /** Check if a pack is registered. */
  has(packId: string): boolean {
    return this.packs.has(packId);
  }

  /** Get all registered packs. */
  getAllPacks(): TemplatePack[] {
    return Array.from(this.packs.values());
  }

  /** Get packs filtered by source. */
  getBySource(source: TemplatePackSource): TemplatePack[] {
    return this.getAllPacks().filter((p) => p.manifest.source === source);
  }

  /** Get packs filtered by category. */
  getByCategory(category: string): TemplatePack[] {
    return this.getAllPacks().filter((p) => p.manifest.category === category);
  }

  /**
   * Get a specific template by pack ID and template ID.
   * Returns a TemplateEntry with metadata, or undefined if not found.
   */
  getTemplate(packId: string, templateId: string): TemplateEntry | undefined {
    const pack = this.packs.get(packId);
    if (!pack) return undefined;

    const graph = pack.templates[templateId];
    if (!graph) return undefined;

    return {
      id: templateId,
      packId,
      name: templateId,
      graph,
      preview: pack.manifest.previews?.[templateId],
    };
  }

  /**
   * Get all templates across all registered packs.
   * Returns a flat array of TemplateEntry objects.
   */
  getAllTemplates(): TemplateEntry[] {
    const entries: TemplateEntry[] = [];

    for (const pack of this.packs.values()) {
      for (const templateId of pack.manifest.templates) {
        const graph = pack.templates[templateId];
        if (!graph) continue;

        entries.push({
          id: templateId,
          packId: pack.manifest.id,
          name: templateId,
          graph,
          preview: pack.manifest.previews?.[templateId],
        });
      }
    }

    return entries;
  }

  /**
   * Get featured templates across all registered packs, in pack-registration
   * order then per-pack declaration order, up to `limit` entries.
   * Template IDs not present in the pack's templates map are silently skipped.
   */
  getFeaturedTemplates(limit = 4): TemplateEntry[] {
    const result: TemplateEntry[] = [];
    for (const pack of this.packs.values()) {
      for (const templateId of pack.manifest.featuredTemplates ?? []) {
        const graph = pack.templates[templateId];
        if (!graph) continue;
        result.push({
          id: templateId,
          packId: pack.manifest.id,
          name: templateId,
          graph,
          preview: pack.manifest.previews?.[templateId],
        });
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  /**
   * Check whether a pack's required node types and providers
   * are available in the current node registry.
   */
  checkAvailability(packId: string): PackAvailability {
    const pack = this.packs.get(packId);
    if (!pack) {
      return { available: false, missingNodeTypes: [], missingProviders: [] };
    }

    const missingNodeTypes = (pack.manifest.requiredNodeTypes ?? []).filter(
      (type) => !nodeRegistry.has(type),
    );

    // Provider availability is checked via registry — provider nodes
    // are registered as `providerId/modelId` type strings
    const missingProviders = (pack.manifest.requiredProviders ?? []).filter((providerId) => {
      const providerNodes = nodeRegistry.filter(
        (def) => def.provider?.providerId === providerId,
      );
      return providerNodes.length === 0;
    });

    return {
      available: missingNodeTypes.length === 0 && missingProviders.length === 0,
      missingNodeTypes,
      missingProviders,
    };
  }

  /** Total number of registered packs. */
  get size(): number {
    return this.packs.size;
  }

  /** Clear all registered packs. Primarily for testing. */
  clear(): void {
    this.packs.clear();
  }
}

// ── Singleton ──

/** Global singleton loader. Import and use directly. */
export const templatePackLoader = new TemplatePackLoader();

// ── Import helper ──

/**
 * Parse and validate a raw JSON object as a TemplatePack.
 * Validates manifest schema and each template's WorkflowGraph schema.
 * Returns the validated pack or throws on invalid input.
 */
export function parseTemplatePack(raw: unknown): TemplatePack {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid template pack: expected an object");
  }

  const obj = raw as Record<string, unknown>;

  // Validate manifest
  const manifest = TemplatePackManifestSchema.parse(obj.manifest);

  // Validate templates
  const rawTemplates = obj.templates;
  if (!rawTemplates || typeof rawTemplates !== "object") {
    throw new Error("Invalid template pack: missing templates object");
  }

  const templates: Record<string, WorkflowGraph> = {};
  for (const [id, graphRaw] of Object.entries(rawTemplates as Record<string, unknown>)) {
    templates[id] = WorkflowGraphSchema.parse(graphRaw);
  }

  // Ensure all manifest template IDs exist in the templates map
  for (const templateId of manifest.templates) {
    if (!(templateId in templates)) {
      throw new Error(
        `Template pack "${manifest.id}": manifest lists template "${templateId}" but it is not in the templates map`,
      );
    }
  }

  return { manifest, templates };
}
