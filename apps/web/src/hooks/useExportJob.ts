"use client";

/**
 * useExportJob — trigger and observe a single export job execution.
 *
 * Flow (with polling):
 *   1. trigger(opts?) → POST /api/editor-projects/[projectId]/export → { jobId }
 *      Pass { preview: true } to request a fast low-resolution proxy render.
 *   2. GET /api/export-jobs/[jobId] → ExportJobStatusResponse
 *   3a. If terminal (completed/failed) → surface status; state becomes "done".
 *   3b. If non-terminal (pending/running) → schedule another GET after
 *       pollIntervalMs and repeat from step 2.
 *
 * Errors at either step are surfaced via `error`; the hook resets via `reset()`.
 * Polling is cleaned up on unmount and cancelled when trigger() is called again.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ExportJobStatusResponse } from "@/lib/exportJobStatus";

const TERMINAL_STATUSES = new Set<ExportJobStatusResponse["status"]>([
  "completed",
  "failed",
]);

export type ExportJobHookState =
  | "idle"       // nothing triggered yet
  | "triggering" // POST in flight
  | "fetching"   // GET status in flight (includes polling interval wait + re-fetch)
  | "done"       // job reached a terminal state (completed or failed)
  | "error";     // network/server error

/** Whether the active job is a fast proxy render or a full-quality export. */
export type ExportMode = "preview" | "full";

export interface UseExportJobResult {
  /** Current lifecycle state of the trigger+fetch flow. */
  state: ExportJobHookState;
  /** Fetched status response; non-null only when state is "done". */
  jobStatus: ExportJobStatusResponse | null;
  /** Error message when state is "error". */
  error: string | null;
  /** Whether the active/last job was a preview or full export. Null when idle. */
  exportMode: ExportMode | null;
  /** Unix timestamp (ms) when trigger() was called. Used for ETR estimation. */
  startedAt: number | null;
  /** Trigger the export: POST to create, then poll until terminal. */
  trigger: (opts?: { preview?: boolean }) => Promise<void>;
  /** Reset to idle so the user can trigger again. */
  reset: () => void;
}

export function useExportJob(
  projectId: string,
  /** Milliseconds between status polls. Exposed for testing; default is 2000. */
  pollIntervalMs = 2_000,
): UseExportJobResult {
  const [state, setState] = useState<ExportJobHookState>("idle");
  const [jobStatus, setJobStatus] = useState<ExportJobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<ExportMode | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Holds the id of any pending poll timeout so it can be cancelled.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Cancel any in-flight poll on unmount so stale state updates are avoided.
  useEffect(() => () => stopPolling(), [stopPolling]);

  const trigger = useCallback(async (opts?: { preview?: boolean }) => {
    // Cancel any polling loop left over from a previous trigger call.
    stopPolling();
    setState("triggering");
    setError(null);
    setJobStatus(null);

    const mode: ExportMode = opts?.preview ? "preview" : "full";
    setExportMode(mode);
    setStartedAt(Date.now());

    // ── Step 1: create the export job ────────────────────────────────────────
    const endpoint = opts?.preview
      ? `/api/editor-projects/${projectId}/export?preview=true`
      : `/api/editor-projects/${projectId}/export`;

    let jobId: string;
    try {
      const createRes = await fetch(endpoint, {
        method: "POST",
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `export request failed (${createRes.status})`);
      }
      ({ jobId } = (await createRes.json()) as { jobId: string });
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setState("error");
      return;
    }

    // ── Step 2+: poll status until terminal ───────────────────────────────────
    setState("fetching");

    const poll = async () => {
      try {
        const statusRes = await fetch(`/api/export-jobs/${jobId}`);
        if (!statusRes.ok) {
          throw new Error(`status read failed (${statusRes.status})`);
        }
        const status = (await statusRes.json()) as ExportJobStatusResponse;
        setJobStatus(status);

        if (TERMINAL_STATUSES.has(status.status)) {
          setState("done");
          // pollTimerRef is already null here; no cleanup needed.
        } else {
          // Schedule next poll; store the id for potential cancellation.
          pollTimerRef.current = setTimeout(poll, pollIntervalMs);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown error");
        setState("error");
      }
    };

    await poll();
  }, [projectId, pollIntervalMs, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState("idle");
    setJobStatus(null);
    setError(null);
    setExportMode(null);
    setStartedAt(null);
  }, [stopPolling]);

  return { state, jobStatus, error, exportMode, startedAt, trigger, reset };
}
