"use client";

/**
 * Standalone SSE snapshot hook — no workflowStore dependency.
 *
 * Opens an EventSource to /api/workflows/:workflowId/runs/:runId/events
 * and accumulates snapshot events, exposing the latest RunDebugSnapshot.
 * Closes automatically when the run reaches a terminal status.
 */
import { useState, useEffect, useRef } from "react";
import type { RunDebugSnapshot } from "@iterastudio/engine";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "partial_failure",
  "cancelled",
  "budget_exceeded",
]);

export interface SseSnapshotState {
  snapshot: RunDebugSnapshot | null;
  connected: boolean;
  error: string | null;
}

export function useSseSnapshot(
  workflowId: string | null,
  runId: string | null,
): SseSnapshotState {
  const [state, setState] = useState<SseSnapshotState>({
    snapshot: null,
    connected: false,
    error: null,
  });

  const esRef = useRef<EventSource | null>(null);
  // Set to true when the server sends a "done" event or the client closes after
  // a terminal snapshot — prevents the subsequent EventSource "error" event
  // (fired on connection drop) from showing a spurious error to the user.
  const closedNormallyRef = useRef(false);

  useEffect(() => {
    // Clean up any previous connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!workflowId || !runId) {
      setState({ snapshot: null, connected: false, error: null });
      return;
    }

    closedNormallyRef.current = false;

    const url = `/api/workflows/${workflowId}/runs/${runId}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("open", () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    });

    es.addEventListener("snapshot", (event: MessageEvent) => {
      try {
        const snapshot = JSON.parse(event.data) as RunDebugSnapshot;
        setState((prev) => ({ ...prev, snapshot }));

        // Auto-close on terminal status
        if (TERMINAL_STATUSES.has(snapshot.status)) {
          closedNormallyRef.current = true;
          es.close();
          esRef.current = null;
          setState((prev) => ({ ...prev, connected: false }));
        }
      } catch {
        // Malformed snapshot — ignore
      }
    });

    // Server sends "done" before closing the stream on terminal status.
    // Mark the close as intentional so the subsequent "error" event is suppressed.
    es.addEventListener("done", () => {
      closedNormallyRef.current = true;
      es.close();
      esRef.current = null;
      setState((prev) => ({ ...prev, connected: false }));
    });

    es.addEventListener("error", () => {
      // Suppress spurious errors that fire when the SSE stream closes normally
      // (server closes connection after terminal status or "done" event).
      if (closedNormallyRef.current) return;

      setState((prev) => ({
        ...prev,
        connected: false,
        error: "SSE connection error — could not reach the run stream. Check that the server is running.",
      }));
      es.close();
      esRef.current = null;
    });

    return () => {
      closedNormallyRef.current = true; // Treat cleanup as intentional
      es.close();
      esRef.current = null;
    };
  }, [workflowId, runId]);

  return state;
}
