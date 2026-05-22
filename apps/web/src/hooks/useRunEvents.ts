"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RunDebugSnapshot } from "@iterastudio/engine";
import { useWorkflowStore } from "@/stores/workflowStore";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "partial_failure",
  "cancelled",
  "budget_exceeded",
]);

interface UseRunEventsResult {
  connected: boolean;
  error: string | null;
}

/**
 * Subscribe to real-time SSE updates for a workflow run.
 * Automatically updates the workflowStore debugSnapshot.
 */
export function useRunEvents(
  workflowId: string,
  runId: string | null,
): UseRunEventsResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const setDebugSnapshot = useWorkflowStore((s) => s.setDebugSnapshot);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!runId) {
      cleanup();
      return;
    }

    setError(null);

    const url = `/api/workflows/${workflowId}/runs/${runId}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener("snapshot", (e: MessageEvent) => {
      try {
        const snapshot: RunDebugSnapshot = JSON.parse(e.data);
        setDebugSnapshot(snapshot);

        // Auto-close on terminal status
        if (TERMINAL_STATUSES.has(snapshot.status)) {
          es.close();
          esRef.current = null;
          setConnected(false);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    es.addEventListener("error", () => {
      setError("Connection lost");
      setConnected(false);
    });

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [workflowId, runId, setDebugSnapshot, cleanup]);

  return { connected, error };
}
