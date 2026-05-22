import { useState, useCallback, useRef, useEffect } from "react";
import type { ModelOption } from "@/config/models";

export type ModelRunStatus = "idle" | "queued" | "running" | "completed" | "failed";

export interface ModelRunResult {
  modelId: string;
  modelName: string;
  status: ModelRunStatus;
  outputUrl?: string;
  error?: string;
  cost?: number;
  durationMs?: number;
  score?: number;
  rank?: number;
}

export type OverallStatus = "idle" | "creating" | "running" | "completed" | "error";

interface PromptRunnerState {
  overallStatus: OverallStatus;
  workflowId: string | null;
  runId: string | null;
  results: ModelRunResult[];
  winnerId: string | null;
}

export function usePromptRunner() {
  const [state, setState] = useState<PromptRunnerState>({
    overallStatus: "idle",
    workflowId: null,
    runId: null,
    results: [],
    winnerId: null,
  });

  const [autoSelectBest, setAutoSelectBest] = useState(false);
  const [promptText, setPromptText] = useState("");
  const scoringCalledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Call scoring API after all results complete
  useEffect(() => {
    if (state.overallStatus !== "completed") {
      scoringCalledRef.current = false;
      return;
    }
    if (scoringCalledRef.current) return;

    const completedWithOutput = state.results.filter(
      (r) => r.status === "completed" && r.outputUrl,
    );
    if (completedWithOutput.length === 0) return;

    scoringCalledRef.current = true;

    fetch("/api/scoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptText,
        imageUrls: completedWithOutput.map((r) => r.outputUrl),
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.results?.length) return;
        const scoreMap = new Map<string, { score: number; rank: number }>();
        for (const sr of data.results) {
          scoreMap.set(sr.imageUrl, { score: sr.score, rank: sr.rank });
        }

        setState((s) => {
          const updatedResults = s.results.map((r) => {
            const match = r.outputUrl ? scoreMap.get(r.outputUrl) : undefined;
            return match ? { ...r, score: match.score, rank: match.rank } : r;
          });

          let winnerId = s.winnerId;
          if (autoSelectBest && !winnerId) {
            const best = updatedResults
              .filter((r) => r.score != null && r.score >= 0)
              .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
            if (best) winnerId = best.modelId;
          }

          return { ...s, results: updatedResults, winnerId };
        });
      })
      .catch(() => {
        // Scoring failed — graceful degradation, results remain without scores
      });
  }, [state.overallStatus, state.results, promptText, autoSelectBest]);

  const run = useCallback(async (prompt: string, models: ModelOption[]) => {
    // Abort any existing run subscription
    abortRef.current?.abort();
    setPromptText(prompt);
    scoringCalledRef.current = false;

    const supportedModels = models.filter((m) => m.supported);
    if (supportedModels.length === 0) {
      setState((s) => ({ ...s, overallStatus: "error" }));
      return;
    }

    // Initialize results
    const initialResults: ModelRunResult[] = models.map((m) => ({
      modelId: m.id,
      modelName: m.name,
      status: m.supported ? "queued" : "failed",
      error: m.supported ? undefined : "Provider not yet connected",
    }));

    setState({
      overallStatus: "creating",
      workflowId: null,
      runId: null,
      results: initialResults,
      winnerId: null,
    });

    try {
      // 1. Create workflow via existing API
      const workflowName = `Prompt Studio: ${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}`;
      const wfRes = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workflowName,
          description: `Multi-model comparison across ${supportedModels.map((m) => m.name).join(", ")}`,
        }),
      });

      if (!wfRes.ok) throw new Error("Failed to create workflow");
      const { id: workflowId } = await wfRes.json();

      setState((s) => ({ ...s, workflowId, overallStatus: "running" }));

      // 2. Build the graph programmatically
      const graph = buildComparisonGraph(prompt, supportedModels);

      // 3. Update workflow with the built graph
      const updateRes = await fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph }),
      });

      // If PATCH doesn't exist yet, continue — workflow was created
      if (updateRes.ok) {
        // 4. Start run via run API
        const runRes = await fetch(`/api/workflows/${workflowId}/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (runRes.ok) {
          const { id: runId } = await runRes.json();
          setState((s) => ({ ...s, runId }));

          // 5. Subscribe to SSE for run updates
          subscribeToRun(workflowId, runId, supportedModels, setState, abortRef);
          return;
        }
      }

      // Run API not available yet — mark results as completed without output.
      // The workflow was saved; export can still produce text content.
      setState((s) => ({
        ...s,
        overallStatus: "completed",
        results: s.results.map((r) =>
          r.status === "queued"
            ? {
                ...r,
                status: "completed" as const,
              }
            : r,
        ),
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        overallStatus: "error",
        results: s.results.map((r) =>
          r.status === "queued"
            ? { ...r, status: "failed" as const, error: String(err) }
            : r,
        ),
      }));
    }
  }, []);

  const selectWinner = useCallback((modelId: string) => {
    setState((s) => ({ ...s, winnerId: s.winnerId === modelId ? null : modelId }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      overallStatus: "idle",
      workflowId: null,
      runId: null,
      results: [],
      winnerId: null,
    });
  }, []);

  return { ...state, run, selectWinner, reset, autoSelectBest, setAutoSelectBest };
}

// ── Build DAG for multi-model comparison ──

function buildComparisonGraph(prompt: string, models: ModelOption[]) {
  const nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      providerId: string;
      modelId: string;
      label: string;
      params: Record<string, unknown>;
      retryCount: number;
      timeoutMs: number;
    };
    inputs: Array<{ id: string; name: string; type: string; direction: string }>;
    outputs: Array<{ id: string; name: string; type: string; direction: string }>;
  }> = [];

  const edges: Array<{
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
  }> = [];

  // Prompt template node at top
  const promptNodeId = crypto.randomUUID();
  const promptOutputId = crypto.randomUUID();
  nodes.push({
    id: promptNodeId,
    type: "prompt-template",
    position: { x: 400, y: 50 },
    data: {
      providerId: "",
      modelId: "",
      label: "Prompt",
      params: { template: prompt },
      retryCount: 1,
      timeoutMs: 30000,
    },
    inputs: [],
    outputs: [{ id: promptOutputId, name: "text", type: "text", direction: "output" }],
  });

  // Fan-out: one generation node per model
  models.forEach((model, i) => {
    const nodeId = crypto.randomUUID();
    const inputId = crypto.randomUUID();
    const outputId = crypto.randomUUID();
    const outputType = model.category === "image" ? "image" : model.category === "video" ? "video" : "text";
    const nodeType = model.category === "image" ? "image-generation" : model.category === "video" ? "video-generation" : "prompt-template";

    const xSpacing = 280;
    const startX = 400 - ((models.length - 1) * xSpacing) / 2;

    nodes.push({
      id: nodeId,
      type: nodeType,
      position: { x: startX + i * xSpacing, y: 250 },
      data: {
        providerId: model.providerKey,
        modelId: model.adapterModelId,
        label: model.name,
        params: { ...model.defaultParams, prompt },
        retryCount: 1,
        timeoutMs: 300000,
      },
      inputs: [{ id: inputId, name: "prompt", type: "text", direction: "input" }],
      outputs: [{ id: outputId, name: outputType, type: outputType, direction: "output" }],
    });

    // Edge: prompt → model node
    edges.push({
      id: crypto.randomUUID(),
      source: promptNodeId,
      sourceHandle: promptOutputId,
      target: nodeId,
      targetHandle: inputId,
    });

    // Output node per model
    const outNodeId = crypto.randomUUID();
    const outInputId = crypto.randomUUID();
    nodes.push({
      id: outNodeId,
      type: "output",
      position: { x: startX + i * xSpacing, y: 450 },
      data: {
        providerId: "",
        modelId: "",
        label: `${model.name} Output`,
        params: {},
        retryCount: 1,
        timeoutMs: 30000,
      },
      inputs: [{ id: outInputId, name: outputType, type: outputType, direction: "input" }],
      outputs: [],
    });

    edges.push({
      id: crypto.randomUUID(),
      source: nodeId,
      sourceHandle: outputId,
      target: outNodeId,
      targetHandle: outInputId,
    });
  });

  return { version: 1, nodes, edges };
}

// ── SSE subscription (wired when run API available) ──

function subscribeToRun(
  workflowId: string,
  runId: string,
  models: ModelOption[],
  setState: React.Dispatch<React.SetStateAction<PromptRunnerState>>,
  abortRef: React.MutableRefObject<AbortController | null>,
) {
  const controller = new AbortController();
  abortRef.current = controller;

  // The graph stores adapterModelId (e.g. "fal-ai/flux-pro/v1.1") in node data,
  // but runner.results entries use the catalog ID (e.g. "flux-1.1-pro").
  // Build a reverse-lookup so SSE node_status events can match the right result row.
  const adapterToCatalogId = new Map(models.map((m) => [m.adapterModelId, m.id]));

  const eventSource = new EventSource(`/api/workflows/${workflowId}/runs/${runId}/events`);

  // onmessage fires for unnamed SSE events (no "event:" field).
  // The server emits these alongside named "snapshot" events so both
  // the canvas debugger (addEventListener) and this subscriber (onmessage) work.
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "node_status") {
        const resolvedOutputUrl =
          data.outputUrl ||
          data.output_url ||
          data.imageUrl ||
          data.image_url ||
          data.url ||
          data.result ||
          data.resultUrl;

        // The SSE payload carries data.modelId = adapterModelId; map back to catalog ID.
        const catalogId = adapterToCatalogId.get(data.modelId) ?? data.modelId;

        setState((s) => ({
          ...s,
          results: s.results.map((r) => {
            if (r.modelId === catalogId) {
              return {
                ...r,
                status: data.status as ModelRunStatus,
                outputUrl: resolvedOutputUrl || r.outputUrl,
                error: data.error || r.error,
                cost: data.cost ?? r.cost,
                durationMs: data.durationMs ?? r.durationMs,
              };
            }
            return r;
          }),
        }));
      }

      if (data.type === "run_complete") {
        setState((s) => ({ ...s, overallStatus: "completed" }));
        eventSource.close();
      }

      if (data.type === "run_failed") {
        setState((s) => ({ ...s, overallStatus: "error" }));
        eventSource.close();
      }
    } catch {
      // Ignore parse errors
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    setState((s) => {
      if (s.overallStatus === "running") {
        return { ...s, overallStatus: "completed" };
      }
      return s;
    });
  };

  controller.signal.addEventListener("abort", () => {
    eventSource.close();
  });
}
