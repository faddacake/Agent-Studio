"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  nodeRegistry,
  NodeCategory,
  type NodeDefinition,
  type WorkflowNode,
  type WorkflowGraph,
} from "@aistudio/shared";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
import { createWorkflowNode } from "./createWorkflowNode";

// ── DB-backed saved template type ──

interface DbTemplate {
  id: string;
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  createdAt: string;
}

// ── Category display metadata ──

const CATEGORY_META: Record<
  NodeCategory,
  { label: string; order: number }
> = {
  [NodeCategory.Agent]:      { label: "Agent",        order: -1 },
  [NodeCategory.Memory]:     { label: "Memory",       order: -0.5 },
  [NodeCategory.Generation]: { label: "Generation",   order: 0 },
  [NodeCategory.Input]:      { label: "Input / Output", order: 1 },
  [NodeCategory.Output]:     { label: "Input / Output", order: 1 },
  [NodeCategory.Transform]:  { label: "Transform",    order: 2 },
  [NodeCategory.Utility]:    { label: "Utility",      order: 3 },
  [NodeCategory.Scoring]:    { label: "Scoring",      order: 4 },
  [NodeCategory.Formatting]: { label: "Formatting",   order: 5 },
  [NodeCategory.Export]:     { label: "Export",       order: 6 },
  [NodeCategory.Annotation]: { label: "Annotation",   order: 7 },
};

/** Merged group key — Input and Output share a group. */
function groupKey(category: NodeCategory): string {
  if (category === NodeCategory.Output) return NodeCategory.Input;
  return category;
}

// ── Runtime kind badge labels ──

const RUNTIME_LABELS: Record<string, string> = {
  provider: "AI Provider",
  local: "Local",
  virtual: "Virtual",
  capability: "Capability",
};

// ── Types ──

interface PaletteGroup {
  key: string;
  label: string;
  order: number;
  nodes: NodeDefinition[];
}

export interface NodePaletteProps {
  /** Called when the user clicks a node to add it to the canvas. */
  onAddNode: (node: WorkflowNode) => void;
  /** Called when the user applies a saved template from the sidebar. */
  onApplyTemplate?: (graph: WorkflowGraph, name: string) => void;
  /** Increment to trigger a template-list re-fetch without remounting. */
  templateRefreshKey?: number;
  /** Default canvas position for new nodes (centered in viewport). */
  defaultPosition?: { x: number; y: number };
  /** Whether the palette panel is open. */
  open?: boolean;
  /** Toggle the palette open/closed. */
  onToggle?: () => void;
}

// ── Component ──

export function NodePalette({
  onAddNode,
  onApplyTemplate,
  templateRefreshKey = 0,
  defaultPosition = { x: 100, y: 100 },
  open = true,
  onToggle,
}: NodePaletteProps) {
  const [filter, setFilter] = useState("");
  const [dbTemplates, setDbTemplates] = useState<DbTemplate[]>([]);

  // Ensure registry is populated on first render
  useEffect(() => {
    initializeNodeRegistry();
  }, []);

  // Fetch user-saved templates from DB; re-runs when templateRefreshKey changes
  useEffect(() => {
    if (!onApplyTemplate) return;
    fetch("/api/templates")
      .then((r) => r.ok ? r.json() : [])
      .then((data: DbTemplate[]) => setDbTemplates(data))
      .catch(() => {/* non-fatal */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApplyTemplate, templateRefreshKey]);

  const handleDeleteDbTemplate = useCallback(async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setDbTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Get all available definitions, filtered and grouped
  const groups = useMemo(() => {
    const allDefs = nodeRegistry.getAvailable();
    const query = filter.toLowerCase().trim();

    // Filter by search query (label, description, type)
    const filtered = query
      ? allDefs.filter(
          (def) =>
            def.label.toLowerCase().includes(query) ||
            def.description.toLowerCase().includes(query) ||
            def.type.toLowerCase().includes(query) ||
            (def.tags ?? []).some((t) => t.toLowerCase().includes(query)),
        )
      : allDefs;

    // Group by category
    const groupMap = new Map<string, PaletteGroup>();

    for (const def of filtered) {
      const key = groupKey(def.category);
      const meta = CATEGORY_META[def.category];

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          label: meta.label,
          order: meta.order,
          nodes: [],
        });
      }

      groupMap.get(key)!.nodes.push(def);
    }

    // Sort groups by order, sort nodes within groups alphabetically
    const sorted = Array.from(groupMap.values()).sort(
      (a, b) => a.order - b.order,
    );
    for (const group of sorted) {
      group.nodes.sort((a, b) => a.label.localeCompare(b.label));
    }

    return sorted;
  }, [filter]);

  const handleAdd = useCallback(
    (def: NodeDefinition) => {
      const node = createWorkflowNode(def, defaultPosition);
      onAddNode(node);
    },
    [onAddNode, defaultPosition],
  );

  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.nodes.length, 0),
    [groups],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="fixed left-4 top-20 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
        title="Open node palette"
      >
        <PlusIcon />
      </button>
    );
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-800 bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-neutral-200">Add Node</h2>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Close palette"
          >
            <XIcon />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search nodes..."
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
        />
        {filter && (
          <p className="mt-1 text-[11px] text-neutral-500">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto px-1 pb-4">
        {groups.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-neutral-600">
            No nodes match &ldquo;{filter}&rdquo;
          </p>
        )}

        {groups.map((group) => (
          <PaletteGroupSection
            key={group.key}
            group={group}
            onAdd={handleAdd}
          />
        ))}
      </div>

      {/* Saved templates section */}
      {onApplyTemplate && dbTemplates.length > 0 && (
        <SavedTemplatesSection
          templates={dbTemplates}
          onApply={onApplyTemplate}
          onDelete={handleDeleteDbTemplate}
        />
      )}
    </aside>
  );
}

// ── Group section ──

function PaletteGroupSection({
  group,
  onAdd,
}: {
  group: PaletteGroup;
  onAdd: (def: NodeDefinition) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
      >
        <ChevronIcon collapsed={collapsed} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {group.label}
        </span>
        <span className="text-[10px] text-neutral-600">
          ({group.nodes.length})
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-0.5 px-1">
          {group.nodes.map((def) => (
            <PaletteNodeItem key={def.type} definition={def} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Node item ──

function PaletteNodeItem({
  definition,
  onAdd,
}: {
  definition: NodeDefinition;
  onAdd: (def: NodeDefinition) => void;
}) {
  const inCount = definition.inputs.length;
  const outCount = definition.outputs.length;
  const runtimeLabel = RUNTIME_LABELS[definition.runtimeKind] ?? definition.runtimeKind;

  return (
    <button
      type="button"
      onClick={() => onAdd(definition)}
      className="group flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-neutral-800/60"
      title={definition.description}
    >
      {/* Top row: label + runtime badge */}
      <div className="flex items-center gap-1.5">
        <span className="flex-1 truncate text-sm text-neutral-200 group-hover:text-neutral-50">
          {definition.label}
        </span>
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 group-hover:bg-neutral-700 group-hover:text-neutral-400">
          {runtimeLabel}
        </span>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
        {definition.description}
      </p>

      {/* Port summary */}
      {(inCount > 0 || outCount > 0) && (
        <div className="flex items-center gap-2 text-[10px] text-neutral-600">
          {inCount > 0 && (
            <span>
              {inCount} in
            </span>
          )}
          {outCount > 0 && (
            <span>
              {outCount} out
            </span>
          )}
          {definition.provider && (
            <span className="text-blue-500/70">
              {definition.provider.providerId}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ── Saved templates section ──

function SavedTemplatesSection({
  templates,
  onApply,
  onDelete,
}: {
  templates: DbTemplate[];
  onApply: (graph: WorkflowGraph, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="border-t border-neutral-800">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        <ChevronIcon collapsed={collapsed} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          My Templates
        </span>
        <span className="rounded-full bg-neutral-800 px-1.5 py-px text-[10px] font-medium tabular-nums text-neutral-400">
          {templates.length}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {templates.map((t) => {
            const nodeCount = t.graph.nodes?.length ?? 0;
            const nodeTypes = (t.graph.nodes ?? []).map((n) => n.type).join(" → ");
            const isConfirming = confirmingId === t.id;
            return (
              <div
                key={t.id}
                className="group flex items-center rounded-md hover:bg-neutral-800/60"
              >
                {/* Apply button — takes up most of the row */}
                <button
                  type="button"
                  onClick={() => { if (!isConfirming) onApply(t.graph, t.name); }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left"
                  title={`Apply template: ${t.name}`}
                >
                  <span className="truncate text-sm text-neutral-200 group-hover:text-neutral-50">
                    {t.name}
                  </span>
                  <span className="truncate text-[11px] text-neutral-500">
                    {nodeCount} node{nodeCount !== 1 ? "s" : ""}
                    {nodeTypes ? ` · ${nodeTypes}` : ""}
                  </span>
                </button>

                {/* Delete affordance */}
                {isConfirming ? (
                  <div className="flex shrink-0 items-center gap-1 pr-1.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmingId(null); onDelete(t.id); }}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmingId(null); }}
                      className="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConfirmingId(t.id); }}
                    title="Delete template"
                    className="mr-1.5 shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-300 group-hover:opacity-100"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Inline SVG icons (avoids additional dependencies) ──

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h8" />
      <path d="M4 3V2h4v1" />
      <path d="M3 3l.6 7h4.8L9 3" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}
