export const runtime = "nodejs";

import { buildDebugSnapshot } from "@iterastudio/engine";
import type { RunEvent } from "@iterastudio/engine";
import { isArtifactRef } from "@iterastudio/shared";
import { getRunCoordinator } from "@/lib/runCoordinator";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "partial_failure",
  "cancelled",
  "budget_exceeded",
]);

// Named event — received by addEventListener("snapshot"|"done"|...) listeners (canvas debugger).
function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Unnamed event — received by eventSource.onmessage (Prompt Studio subscribeToRun).
function sseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Extract the first image or video artifact URL from a node's output map.
 * Returns a /api/artifacts?path=... URL, or undefined if no artifact is found.
 */
function resolveOutputUrl(outputs: Record<string, unknown>): string | undefined {
  for (const value of Object.values(outputs)) {
    if (isArtifactRef(value)) {
      return `/api/artifacts?path=${encodeURIComponent(value.path)}`;
    }
  }
  return undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;

  // Ensure node registry is populated so buildDebugSnapshot can resolve runtimeKind.
  // In dev mode, this route may run in a fresh module context that hasn't registered
  // built-in nodes yet (unlike runs/route.ts which calls ensureEngineBootstrapped).
  initializeNodeRegistry();

  const coordinator = getRunCoordinator();

  if (!coordinator.hasRun(runId)) {
    return new Response(JSON.stringify({ error: "Run not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Named event — canvas debugger (addEventListener("snapshot" | "done"))
      function send(event: string, data: unknown) {
        try {
          controller.enqueue(encoder.encode(sseMessage(event, data)));
        } catch {
          // Stream already closed
        }
      }

      // Unnamed event — Prompt Studio subscribeToRun (onmessage)
      function sendData(data: unknown) {
        try {
          controller.enqueue(encoder.encode(sseData(data)));
        } catch {
          // Stream already closed
        }
      }

      // Send initial snapshot (canvas debugger)
      const run = coordinator.getRun(runId);
      const snapshot = buildDebugSnapshot(run);
      send("snapshot", snapshot);

      // Replay completed/failed nodes from the initial snapshot so that
      // Prompt Studio subscribers who connect after node completion still
      // receive per-node status events via onmessage.
      for (const node of snapshot.nodes) {
        if (node.status === "completed" || node.status === "failed") {
          const nodeState = run.nodeStates.get(node.nodeId);
          sendData({
            type: "node_status",
            nodeId: node.nodeId,
            modelId: node.modelId ?? node.nodeId,
            status: node.status,
            outputUrl: node.status === "completed"
              ? resolveOutputUrl(nodeState?.outputs ?? {})
              : undefined,
            error: node.status === "failed" ? nodeState?.error : undefined,
            cost: node.cost,
            durationMs: node.durationMs,
          });
        }
      }

      // If run is already terminal, send done and close immediately
      if (TERMINAL_STATUSES.has(run.status)) {
        send("done", { status: run.status });
        sendData({
          type: run.status === "completed" ? "run_complete" : "run_failed",
          status: run.status,
        });
        controller.close();
        return;
      }

      // Subscribe to future events
      const unsubscribe = coordinator.on((event: RunEvent) => {
        if (event.runId !== runId) return;

        // Rebuild full snapshot on every event (canvas debugger)
        const currentRun = coordinator.getRun(runId);
        const updated = buildDebugSnapshot(currentRun);
        send("snapshot", updated);

        // Emit per-node unnamed events for Prompt Studio subscriber (onmessage)
        if (event.type === "node:completed") {
          const execNode = currentRun.graph.nodes.get(event.nodeId);
          const nodeState = currentRun.nodeStates.get(event.nodeId);
          sendData({
            type: "node_status",
            nodeId: event.nodeId,
            modelId: (execNode?.data?.modelId as string | undefined) ?? event.nodeId,
            status: "completed",
            outputUrl: resolveOutputUrl(event.outputs),
            cost: event.cost ?? nodeState?.cost,
            durationMs: nodeState?.durationMs,
          });
        } else if (event.type === "node:failed") {
          const execNode = currentRun.graph.nodes.get(event.nodeId);
          sendData({
            type: "node_status",
            nodeId: event.nodeId,
            modelId: (execNode?.data?.modelId as string | undefined) ?? event.nodeId,
            status: "failed",
            error: event.error,
          });
        }

        // Close stream on terminal status — send done before closing so the
        // client can distinguish a normal stream end from a network error.
        if (TERMINAL_STATUSES.has(currentRun.status)) {
          send("done", { status: currentRun.status });
          sendData({
            type: currentRun.status === "completed" ? "run_complete" : "run_failed",
            status: currentRun.status,
          });
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 15_000);

      // Cleanup when client disconnects
      _req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
