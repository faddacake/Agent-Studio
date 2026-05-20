"use client";

import { useState, useEffect } from "react";
import { templatePackLoader, type TemplateEntry } from "@aistudio/shared";
import type { WorkflowGraph } from "@aistudio/shared";
import { ensurePacksLoaded } from "@/lib/initTemplatePacks";

export interface WorkflowEmptyStateProps {
  onSelectTemplate: (graph: WorkflowGraph, name: string) => void;
  onOpenGallery: () => void;
  onStartBlank: () => void;
}

export function WorkflowEmptyState({
  onSelectTemplate,
  onOpenGallery,
  onStartBlank,
}: WorkflowEmptyStateProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensurePacksLoaded();
    setReady(true);
  }, []);

  const featured: TemplateEntry[] = ready
    ? templatePackLoader.getFeaturedTemplates(4)
    : [];

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-neutral-700 bg-neutral-900/95 shadow-2xl backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Start from a template
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Pick a template below or build from scratch
            </p>
          </div>
          <button
            type="button"
            onClick={onStartBlank}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
          >
            Start Blank
          </button>
        </div>

        {/* Featured template cards */}
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {!ready && (
            <p className="col-span-2 py-4 text-center text-xs text-neutral-600">
              Loading templates…
            </p>
          )}
          {ready && featured.length === 0 && (
            <p className="col-span-2 py-4 text-center text-xs text-neutral-600">
              No featured templates found.
            </p>
          )}
          {featured.map((entry) => (
            <FeaturedCard
              key={`${entry.packId}/${entry.id}`}
              entry={entry}
              onSelect={onSelectTemplate}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-center border-t border-neutral-800 px-6 py-3">
          <button
            type="button"
            onClick={onOpenGallery}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
          >
            <GridIcon />
            Browse all templates
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Featured card ──

function FeaturedCard({
  entry,
  onSelect,
}: {
  entry: TemplateEntry;
  onSelect: (graph: WorkflowGraph, name: string) => void;
}) {
  const displayName = formatTemplateName(entry.id);
  const nodeCount = entry.graph.nodes.length;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-800/40 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-200">{displayName}</span>
        <span className="shrink-0 text-[10px] text-neutral-600">
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {entry.preview ? (
        <p className="flex-1 text-xs leading-relaxed text-neutral-500">{entry.preview}</p>
      ) : (
        <p className="flex-1 text-xs text-neutral-600">No description.</p>
      )}

      <button
        type="button"
        onClick={() => onSelect(entry.graph, displayName)}
        className="mt-1 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 active:bg-blue-700"
      >
        Use Template
      </button>
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

function GridIcon() {
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
    >
      <rect x="1" y="1" width="4" height="4" rx="0.5" />
      <rect x="7" y="1" width="4" height="4" rx="0.5" />
      <rect x="1" y="7" width="4" height="4" rx="0.5" />
      <rect x="7" y="7" width="4" height="4" rx="0.5" />
    </svg>
  );
}
