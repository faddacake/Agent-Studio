"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  templatePackLoader,
  parseTemplatePack,
  type TemplateEntry,
  type TemplatePack,
  type PackAvailability,
  type TemplatePackSource,
} from "@aistudio/shared";
import type { WorkflowGraph } from "@aistudio/shared";
import { MiniGraphPreview } from "./MiniGraphPreview";
import { persistPack } from "@/lib/templatePackStorage";
import { ensurePacksLoaded } from "@/lib/initTemplatePacks";

// ── DB template row shape returned by GET /api/templates ──

interface DbTemplateRow {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  tags: string[];
  updatedAt: string;
}

// Per-template DB metadata (tags + updatedAt) — stored out-of-band from the pack system
interface DbTemplateMeta {
  tags: string[];
  updatedAt: string;
}

// ── Load built-in packs + rehydrate persisted packs on first import ──
// Initialization is handled by initTemplatePacks.ts (shared with WorkflowEmptyState).

// ── Filter types ──

type FilterMode = "all" | "builtin" | "imported" | "my-templates" | "packs";

interface FilterTab {
  value: FilterMode;
  label: string;
  /** Returns true if a template matches this filter */
  match: (t: EnrichedTemplate) => boolean;
}

const FILTER_TABS: FilterTab[] = [
  { value: "all", label: "All", match: () => true },
  { value: "builtin", label: "Built-in", match: (t) => t.pack.manifest.source === "builtin" },
  { value: "imported", label: "Imported", match: (t) => t.pack.manifest.source === "imported" },
  { value: "my-templates", label: "My Templates", match: (t) => t.pack.manifest.source === "user" },
  { value: "packs", label: "Packs", match: (t) => t.pack.manifest.templates.length > 1 },
];

// ── Enriched template entry with pack metadata ──

interface EnrichedTemplate {
  entry: TemplateEntry;
  pack: TemplatePack;
  availability: PackAvailability;
  /** Only present for DB-saved user templates */
  dbMeta?: DbTemplateMeta;
}

// ── Props ──

export interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (graph: WorkflowGraph, name: string) => void;
  /** Increment to trigger a re-fetch of user-saved DB templates */
  refreshKey?: number;
}

// ── Component ──

export function TemplatePicker({ open, onClose, onSelect, refreshKey = 0 }: TemplatePickerProps) {
  const [activeTab, setActiveTab] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [importCount, setImportCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-template metadata for DB templates — keyed by template name.
  // Stored in a ref so it doesn't trigger re-renders independently of importCount.
  const dbMetaRef = useRef<Map<string, DbTemplateMeta>>(new Map());

  useEffect(() => {
    ensurePacksLoaded();
  }, []);

  // Fetch user-saved DB templates and register them as a synthetic "user" pack
  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.ok ? (r.json() as Promise<DbTemplateRow[]>) : Promise.resolve([]))
      .then((rows) => {
        const DB_PACK_ID = "__db-user-templates__";
        if (rows.length === 0) {
          if (templatePackLoader.has(DB_PACK_ID)) {
            templatePackLoader.unregister(DB_PACK_ID);
            dbMetaRef.current.clear();
            setImportCount((c) => c + 1);
          }
          return;
        }
        // Deduplicate by name (last write wins for same name)
        const unique = rows.filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i);

        // Store per-template metadata in the ref before triggering re-render
        const meta = new Map<string, DbTemplateMeta>();
        for (const r of unique) {
          meta.set(r.name, { tags: r.tags ?? [], updatedAt: r.updatedAt });
        }
        dbMetaRef.current = meta;

        const pack: TemplatePack = {
          manifest: {
            id: DB_PACK_ID,
            name: "My Templates",
            version: "1.0.0",
            source: "user",
            category: "my-templates",
            templates: unique.map((r) => r.name),
            previews: Object.fromEntries(
              unique.filter((r) => r.description).map((r) => [r.name, r.description]),
            ),
          },
          templates: Object.fromEntries(unique.map((r) => [r.name, r.graph])),
        };
        templatePackLoader.register(pack);
        setImportCount((c) => c + 1);
      })
      .catch(() => {});
  }, [refreshKey]);

  // Auto-dismiss success message after 4 seconds
  useEffect(() => {
    if (!importSuccess) return;
    const timer = setTimeout(() => setImportSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [importSuccess]);

  // Handle file import
  const handleImportClick = useCallback(() => {
    setImportError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset the input so the same file can be re-selected
      e.target.value = "";

      setImportError(null);
      setImportSuccess(null);

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(reader.result as string);

          // Force source to "imported" for user-imported packs
          if (raw && typeof raw === "object" && raw.manifest) {
            raw.manifest.source = "imported";
          }

          const pack = parseTemplatePack(raw);

          // Check for duplicate pack ID
          if (templatePackLoader.has(pack.manifest.id)) {
            // Overwrite — re-register
            templatePackLoader.unregister(pack.manifest.id);
          }

          templatePackLoader.register(pack);
          persistPack(pack);
          setImportCount((c) => c + 1);
          setActiveTab("imported");
          setImportSuccess(
            `Imported "${pack.manifest.name}" with ${pack.manifest.templates.length} template${pack.manifest.templates.length !== 1 ? "s" : ""}`,
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Invalid template pack file";
          setImportError(message);
        }
      };
      reader.onerror = () => {
        setImportError("Failed to read file");
      };
      reader.readAsText(file);
    },
    [],
  );

  // Build enriched template list
  const enriched = useMemo((): EnrichedTemplate[] => {
    const packs = templatePackLoader.getAllPacks();
    const result: EnrichedTemplate[] = [];

    for (const pack of packs) {
      const availability = templatePackLoader.checkAvailability(pack.manifest.id);
      const isUserPack = pack.manifest.source === "user";

      for (const templateId of pack.manifest.templates) {
        const graph = pack.templates[templateId];
        if (!graph) continue;

        result.push({
          entry: {
            id: templateId,
            packId: pack.manifest.id,
            name: templateId,
            graph,
            preview: pack.manifest.previews?.[templateId],
          },
          pack,
          availability,
          dbMeta: isUserPack ? dbMetaRef.current.get(templateId) : undefined,
        });
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importCount]);

  // Compute per-tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<FilterMode, number> = {
      all: 0,
      builtin: 0,
      imported: 0,
      "my-templates": 0,
      packs: 0,
    };
    for (const tab of FILTER_TABS) {
      counts[tab.value] = enriched.filter(tab.match).length;
    }
    return counts;
  }, [enriched]);

  // Apply tab filter + text search
  const filtered = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.value === activeTab) ?? FILTER_TABS[0];
    let items = enriched.filter(tab.match);

    const query = search.toLowerCase().trim();
    if (query) {
      items = items.filter(
        (t) =>
          t.entry.name.toLowerCase().includes(query) ||
          (t.entry.preview ?? "").toLowerCase().includes(query) ||
          t.pack.manifest.name.toLowerCase().includes(query) ||
          (t.pack.manifest.description ?? "").toLowerCase().includes(query) ||
          (t.pack.manifest.category ?? "").toLowerCase().includes(query) ||
          (t.pack.manifest.tags ?? []).some((tag) =>
            tag.toLowerCase().includes(query),
          ),
      );
    }

    return items;
  }, [enriched, activeTab, search]);

  // Group by category
  const groups = useMemo(() => {
    const map = new Map<string, EnrichedTemplate[]>();

    for (const item of filtered) {
      const category = item.pack.manifest.category ?? "uncategorized";
      if (!map.has(category)) map.set(category, []);
      map.get(category)!.push(item);
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleSelect = useCallback(
    (item: EnrichedTemplate) => {
      const displayName = formatTemplateName(item.entry.name);
      const defaultPrompt = item.pack.manifest.defaultPrompts?.[item.entry.id];

      // Inject the default example prompt into the first prompt-template node so
      // the workflow is immediately runnable without the user needing to edit any node.
      let graph = item.entry.graph;
      if (defaultPrompt) {
        const promptNodeIndex = graph.nodes.findIndex((n) => n.type === "prompt-template");
        if (promptNodeIndex !== -1) {
          graph = {
            ...graph,
            nodes: graph.nodes.map((n, i) =>
              i === promptNodeIndex
                ? { ...n, data: { ...n.data, params: { ...n.data.params, template: defaultPrompt } } }
                : n,
            ),
          };
        }
      }

      onSelect(graph, displayName);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!open) return null;

  return (
    // Backdrop
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      {/* Modal */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Template Gallery
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Start from a pre-built workflow
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleImportClick}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
            >
              <ImportIcon />
              Import Pack
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* Import error banner */}
        {importError && (
          <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-5 py-2.5">
            <WarningIcon />
            <p className="flex-1 text-xs text-red-400">{importError}</p>
            <button
              type="button"
              onClick={() => setImportError(null)}
              className="text-red-500/60 hover:text-red-400"
            >
              <XIcon />
            </button>
          </div>
        )}

        {/* Import success banner */}
        {importSuccess && (
          <div className="flex items-center gap-2 border-b border-green-500/20 bg-green-500/5 px-5 py-2.5">
            <CheckIcon />
            <p className="flex-1 text-xs text-green-400">{importSuccess}</p>
            <button
              type="button"
              onClick={() => setImportSuccess(null)}
              className="text-green-500/60 hover:text-green-400"
            >
              <XIcon />
            </button>
          </div>
        )}

        {/* Tab row */}
        <div className="flex items-center gap-0 border-b border-neutral-800 px-5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.value
                  ? "text-blue-400"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.label}
              {tabCounts[tab.value] > 0 && (
                <span
                  className={`ml-1 text-[10px] ${
                    activeTab === tab.value ? "text-blue-500/70" : "text-neutral-600"
                  }`}
                >
                  {tabCounts[tab.value]}
                </span>
              )}
              {/* Active indicator */}
              {activeTab === tab.value && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-5 py-3">
          <div className="relative">
            <SearchIcon />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 py-1.5 pl-8 pr-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          {groups.length === 0 && (
            <div className="flex flex-col items-center py-12">
              <EmptyIcon />
              <p className="mt-3 text-sm text-neutral-500">No templates found</p>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  Clear search
                </button>
              )}
            </div>
          )}

          {groups.map(([category, items]) => (
            <div key={category} className="mb-5">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {formatCategoryName(category)}
              </h3>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <TemplateCard
                    key={`${item.entry.packId}/${item.entry.id}`}
                    item={item}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-800 px-5 py-2.5">
          <p className="text-[11px] text-neutral-600">
            {filtered.length} template{filtered.length !== 1 ? "s" : ""} from{" "}
            {templatePackLoader.size} pack{templatePackLoader.size !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3">
            <AvailabilityLegend />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Template card ──

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function TemplateCard({
  item,
  onSelect,
}: {
  item: EnrichedTemplate;
  onSelect: (item: EnrichedTemplate) => void;
}) {
  const { entry, pack, availability, dbMeta } = item;
  const nodeCount = entry.graph.nodes.length;
  const edgeCount = entry.graph.edges.length;
  const isPack = pack.manifest.templates.length > 1;
  // For user templates, prefer per-template tags from DB over pack-level tags
  const tags = dbMeta?.tags?.length ? dbMeta.tags : (pack.manifest.tags ?? []);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
      className="group flex w-full flex-col gap-1.5 rounded-lg border border-neutral-800 px-4 py-3 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-800/40"
    >
      {/* Row 1: name + badges */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-neutral-200 group-hover:text-neutral-50">
          {formatTemplateName(entry.name)}
        </span>

        {/* Source badge */}
        <SourceBadge source={pack.manifest.source} />

        {/* Pack badge (only if multi-template pack) */}
        {isPack && <PackBadge name={pack.manifest.name} />}

        {/* Availability dot */}
        <AvailabilityIndicator availability={availability} />
      </div>

      {/* Row 2: preview description */}
      {entry.preview && (
        <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500 group-hover:text-neutral-400">
          {entry.preview}
        </p>
      )}

      {/* Row 3: metadata row */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-600">
        <span className="flex items-center gap-1">
          <NodeCountIcon />
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
        <span className="text-neutral-700">|</span>
        <span className="flex items-center gap-1">
          <EdgeCountIcon />
          {edgeCount} edge{edgeCount !== 1 ? "s" : ""}
        </span>

        {/* Updated-at for user templates */}
        {dbMeta?.updatedAt && (
          <>
            <span className="text-neutral-700">|</span>
            <span
              className="text-neutral-500"
              title={new Date(dbMeta.updatedAt).toLocaleString()}
            >
              Updated {formatRelativeTime(dbMeta.updatedAt)}
            </span>
          </>
        )}

        {/* Tags (show first 3) */}
        {tags.length > 0 && (
          <>
            <span className="text-neutral-700">|</span>
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-neutral-800/80 px-1.5 py-px text-neutral-500 group-hover:bg-neutral-700/80"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-neutral-600">+{tags.length - 3}</span>
            )}
          </>
        )}
      </div>

      {/* Row 4: missing deps warning */}
      {!availability.available && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-500/80">
          <WarningIcon />
          <span>
            Missing:{" "}
            {[...availability.missingNodeTypes, ...availability.missingProviders].join(", ")}
          </span>
        </div>
      )}

      {/* Row 5: graph topology preview (hover only) */}
      {showPreview && nodeCount > 0 && (
        <div
          className="mt-0.5 h-24 w-full overflow-hidden rounded border border-neutral-700/50"
          style={{ pointerEvents: "none" }}
        >
          <MiniGraphPreview graph={entry.graph} />
        </div>
      )}
    </button>
  );
}

// ── Source badge ──

function SourceBadge({ source }: { source: TemplatePackSource }) {
  const config: Record<TemplatePackSource, { bg: string; text: string; label: string }> = {
    builtin: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Built-in" },
    user: { bg: "bg-violet-500/15", text: "text-violet-400", label: "My Template" },
    imported: { bg: "bg-cyan-500/15", text: "text-cyan-400", label: "Imported" },
    premium: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Premium" },
  };

  const c = config[source];

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

// ── Pack badge ──

function PackBadge({ name }: { name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
      <PackIcon />
      {name}
    </span>
  );
}

// ── Availability indicator ──

function AvailabilityIndicator({ availability }: { availability: PackAvailability }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        availability.available ? "bg-green-500" : "bg-amber-500"
      }`}
      title={availability.available ? "All dependencies available" : "Some dependencies missing"}
    />
  );
}

// ── Availability legend ──

function AvailabilityLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-neutral-600">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Ready
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Missing deps
      </span>
    </div>
  );
}

// ── Helpers ──

function formatTemplateName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatCategoryName(category: string): string {
  return category
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Inline SVG icons ──

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M9.5 9.5L12.5 12.5" />
    </svg>
  );
}

function PackIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="8" height="6" rx="1" />
      <path d="M3.5 2V1.5a1 1 0 011-1h1a1 1 0 011 1V2" />
    </svg>
  );
}

function NodeCountIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function EdgeCountIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2 8L8 2" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 1L9.5 8.5H0.5L5 1z" />
      <path d="M5 4v2" />
      <circle cx="5" cy="7.2" r="0.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v6" />
      <path d="M3.5 5.5L6 8l2.5-2.5" />
      <path d="M2 10h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5L5 9l4.5-6" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-neutral-700">
      <rect x="6" y="10" width="28" height="20" rx="3" />
      <path d="M14 20h12M14 24h8" />
      <path d="M20 4v6" />
      <path d="M16 6l4-2 4 2" />
    </svg>
  );
}
