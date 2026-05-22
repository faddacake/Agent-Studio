import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  CandidateItem,
  CandidateCollection,
} from "@iterastudio/shared";
import {
  ensureCollection,
  getScore,
  toCollection,
} from "@iterastudio/shared";

// ── Export manifest types ──

interface ExportAsset {
  candidateId: string;
  type: string;
  assetRef: unknown;
  rank?: number;
  scores?: Array<{ metric: string; value: number; normalized?: number }>;
}

interface ExportSocialEntry {
  candidateId: string;
  platform: string;
  caption: string;
  hashtags: string[];
  hook: string;
  cta: string;
  title: string;
}

interface ExportManifest {
  bundleName: string;
  format: string;
  createdAt: string;
  candidateCount: number;
  assets: ExportAsset[];
  socialEntries: ExportSocialEntry[];
  summary: {
    totalCandidates: number;
    topScore?: number;
    topRank?: number;
    platforms: string[];
    hasScores: boolean;
    hasSocialData: boolean;
  };
  metadata: Record<string, unknown>;
}

// ── Helpers ──

function buildAsset(item: CandidateItem, includeScores: boolean): ExportAsset {
  return {
    candidateId: item.id,
    type: item.type,
    assetRef: item.value,
    rank: item.rank,
    scores: includeScores
      ? item.scores?.map((s) => ({ metric: s.metric, value: s.value, normalized: s.normalized }))
      : undefined,
  };
}

function extractSocialEntries(item: CandidateItem): ExportSocialEntry[] {
  const socialVariants = item.metadata?.socialVariants as
    | Record<string, { caption: string; hashtags: string[]; hook: string; cta: string; title: string }>
    | undefined;

  if (!socialVariants) return [];

  return Object.entries(socialVariants).map(([platform, variant]) => ({
    candidateId: item.id,
    platform,
    caption: variant.caption,
    hashtags: variant.hashtags,
    hook: variant.hook,
    cta: variant.cta,
    title: variant.title,
  }));
}

// ── Executor ──

/**
 * ExportBundle capability executor.
 *
 * Takes a CandidateCollection/Selection (typically from SocialFormat or Ranking)
 * and produces a structured export manifest ready for zip/folder generation.
 *
 * Preserves all upstream metadata: scores, ranks, social variants.
 * The manifest is a structured JSON object that a real file bundling
 * service can consume to produce downloadable archives.
 *
 * Currently produces a manifest-only output. Real zip/folder creation
 * will be added when file system integration is ready.
 */
export async function executeExportBundle(
  context: NodeExecutionContext,
  _definition: NodeDefinition,
): Promise<NodeExecutionResult> {
  const { inputs, params } = context;

  // Normalize input
  const collection = ensureCollection(inputs.candidates_in, "image", context.nodeId);

  if (collection.items.length === 0) {
    throw new Error("ExportBundle: no candidates provided in candidates_in port");
  }

  // Resolve params
  const bundleName = (params.bundleName as string) || `export-${Date.now()}`;
  const includeImages = (params.includeImages as boolean) ?? true;
  const includeMetadata = (params.includeMetadata as boolean) ?? true;
  const includeSocialText = (params.includeSocialText as boolean) ?? true;
  const includeScores = (params.includeScores as boolean) ?? true;
  const format = (params.format as string) ?? "manifest-only";

  // Build assets list
  const assets: ExportAsset[] = includeImages
    ? collection.items.map((item) => buildAsset(item, includeScores))
    : [];

  // Extract social entries from candidate metadata
  const socialEntries: ExportSocialEntry[] = includeSocialText
    ? collection.items.flatMap(extractSocialEntries)
    : [];

  // Detect platforms from social data
  const platforms = [...new Set(socialEntries.map((e) => e.platform))];

  // Find top score across all candidates
  const allScores = collection.items
    .flatMap((item) => item.scores ?? [])
    .map((s) => s.normalized ?? s.value);
  const topScore = allScores.length > 0 ? Math.max(...allScores) : undefined;

  // Find top rank
  const ranks = collection.items
    .map((item) => item.rank)
    .filter((r): r is number => r !== undefined);
  const topRank = ranks.length > 0 ? Math.min(...ranks) : undefined;

  // Build manifest
  const manifest: ExportManifest = {
    bundleName,
    format,
    createdAt: new Date().toISOString(),
    candidateCount: collection.items.length,
    assets,
    socialEntries,
    summary: {
      totalCandidates: collection.items.length,
      topScore,
      topRank,
      platforms,
      hasScores: allScores.length > 0,
      hasSocialData: socialEntries.length > 0,
    },
    metadata: includeMetadata
      ? { producedByNodeId: context.nodeId, collectionType: collection.collectionType }
      : {},
  };

  // Attach export metadata to candidates for downstream consumption
  const exportedCollection = toCollection(
    collection.items.map((item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        exportBundleName: bundleName,
        exportFormat: format,
        exportedAt: manifest.createdAt,
      },
    })),
    "formatted",
    context.nodeId,
  );

  return {
    outputs: {
      bundle_out: manifest,
      candidates_out: exportedCollection,
    },
    cost: 0,
    metadata: {
      bundleName,
      format,
      candidateCount: collection.items.length,
      assetCount: assets.length,
      socialEntryCount: socialEntries.length,
      mock: format === "manifest-only",
    },
  };
}
