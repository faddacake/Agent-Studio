"use client";

/**
 * useRunOutputs — fetches completed node outputs for a run once it finishes.
 *
 * When isComplete becomes true it hits GET /api/workflows/:id/runs/:runId/outputs
 * and returns:
 *   - items     — top-K selected candidates from selection_out
 *   - allItems  — all N ranked candidates from all_candidates_out
 *
 * Used by the Generate page to render selected + all generated images.
 */
import { useState, useEffect } from "react";
import type { CandidateItem } from "@iterastudio/shared";

export interface RunOutputsState {
  /** Top-K selected candidates (from selection_out) */
  items: CandidateItem[] | null;
  /** All N ranked candidates (from all_candidates_out) */
  allItems: CandidateItem[] | null;
  loading: boolean;
  error: string | null;
}

export function useRunOutputs(
  workflowId: string | null,
  runId: string | null,
  isComplete: boolean,
): RunOutputsState {
  const [state, setState] = useState<RunOutputsState>({
    items: null,
    allItems: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    // Reset when run changes
    setState({ items: null, allItems: null, loading: false, error: null });
  }, [workflowId, runId]);

  useEffect(() => {
    if (!workflowId || !runId || !isComplete) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(`/api/workflows/${workflowId}/runs/${runId}/outputs`)
      .then((r) => {
        if (!r.ok) throw new Error(`Outputs fetch failed: ${r.status}`);
        return r.json() as Promise<{
          outputs: Array<{ nodeId: string; outputs: Record<string, unknown> }>;
        }>;
      })
      .then((data) => {
        let items: CandidateItem[] = [];
        let allItems: CandidateItem[] = [];

        for (const node of data.outputs ?? []) {
          // Top-K selected candidates
          const sel = node.outputs.selection_out as
            | { items?: CandidateItem[] }
            | undefined;
          if (sel?.items && sel.items.length > 0) {
            items = sel.items;
          }

          // All N ranked candidates
          const all = node.outputs.all_candidates_out as
            | { items?: CandidateItem[] }
            | undefined;
          if (all?.items && all.items.length > 0) {
            allItems = all.items;
          }
        }

        setState({ items, allItems, loading: false, error: null });
      })
      .catch((err: unknown) => {
        setState({
          items: null,
          allItems: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [workflowId, runId, isComplete]);

  return state;
}
