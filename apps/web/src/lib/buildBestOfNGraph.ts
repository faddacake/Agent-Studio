/**
 * Builds a minimal single-node WorkflowGraph for a best-of-n run.
 *
 * The resulting graph contains one "best-of-n" capability node with all
 * run parameters encoded in node.data.params. No edges are needed because
 * there is only one node; the prompt is passed via params.prompt so that
 * executeBestOfN can find it even without an upstream prompt node.
 */
import type { WorkflowGraph } from "@aistudio/shared";

export interface BestOfNConfig {
  prompt: string;
  n: number;
  k: number;
  provider: "mock" | "fal";
  model?: string;
  seed?: number;
}

export function buildBestOfNGraph(config: BestOfNConfig): WorkflowGraph {
  const nodeId = crypto.randomUUID();

  const params: Record<string, unknown> = {
    __nodeType: "best-of-n",
    prompt: config.prompt,
    n: config.n,
    k: config.k,
    provider: config.provider,
  };
  if (config.model !== undefined) params.model = config.model;
  if (config.seed !== undefined) params.seed = config.seed;

  return {
    version: 1,
    nodes: [
      {
        id: nodeId,
        type: "best-of-n",
        position: { x: 0, y: 0 },
        data: {
          label: "Best of N",
          params,
          retryCount: 1,
          timeoutMs: 300_000,
        },
        inputs: [
          { id: "prompt_in", name: "Prompt", type: "text", direction: "input" },
        ],
        outputs: [
          { id: "selection_out",      name: "Top Candidates", type: "json", direction: "output" },
          { id: "all_candidates_out", name: "All Candidates", type: "json", direction: "output" },
        ],
      },
    ],
    edges: [],
  };
}
