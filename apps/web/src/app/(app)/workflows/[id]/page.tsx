"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkflowStore } from "@/stores/workflowStore";
import { WorkflowCanvas } from "@/components/canvas";
import type { WorkflowGraph } from "@iterastudio/shared";

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  graph: string;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  revisionCount: number;
}

export default function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const replayRunId = searchParams.get("replay");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);

  // SSE run events are subscribed inside WorkflowCanvas/CanvasInner — no duplicate needed here.

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/workflows/${id}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Workflow not found" : "Failed to load workflow");
          return;
        }
        const row: WorkflowRow = await res.json();
        const meta = {
          id: row.id,
          name: row.name,
          description: row.description,
          lastRunStatus: row.lastRunStatus ?? null,
          lastRunAt: row.lastRunAt ?? null,
          revisionCount: row.revisionCount ?? 0,
        };

        if (replayRunId) {
          // Load the historical run's graph snapshot for Edit & Replay
          const runRes = await fetch(`/api/workflows/${id}/runs/${replayRunId}/graph`);
          if (!runRes.ok) {
            // Fallback: load current workflow graph if snapshot unavailable
            const graph: WorkflowGraph = JSON.parse(row.graph);
            loadWorkflow(meta, graph);
          } else {
            const replayGraph: WorkflowGraph = await runRes.json();
            loadWorkflow(meta, replayGraph, replayRunId);
          }
        } else {
          const graph: WorkflowGraph = JSON.parse(row.graph);
          loadWorkflow(meta, graph);
        }
      } catch {
        setError("Failed to load workflow");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, replayRunId, loadWorkflow]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-500">Loading workflow...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <WorkflowCanvas />
    </div>
  );
}
