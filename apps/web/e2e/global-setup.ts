/**
 * Playwright global setup — seeds workflow + historical run for E2E tests.
 *
 * Strategy:
 *   1. Create a workflow via the live API (exercises the real POST handler).
 *   2. Insert a historical run record directly into SQLite, bypassing the
 *      engine and worker infrastructure so no AI provider keys or Redis are
 *      required for test setup.
 *   3. Write { workflowId, runId } to a temp seed file that test files read.
 *
 * Auth bypass: the middleware skips JWT verification when MASTER_KEY is
 * absent; any non-empty aistudio_session cookie value passes through.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import type { FullConfig } from "@playwright/test";
import { E2E_DATA_DIR, SEED_FILE } from "./constants";

const BASE_URL = `http://localhost:3001`;
const SESSION_COOKIE = "aistudio_session=e2e-bypass";

/**
 * A minimal graph that passes WorkflowGraphSchema validation:
 *   - node.id must be a UUID
 *   - port.type must be one of "image"|"video"|"text"|"number"|"json"
 *   - port.direction must be "input"|"output"
 *   - data.retryCount in [0,3]; data.timeoutMs in [10_000, 1_800_000]
 */
function buildSeedGraph() {
  const nodeId = randomUUID();
  return {
    nodeId,
    graph: {
      version: 1 as const,
      nodes: [
        {
          id: nodeId,
          type: "text_input",
          position: { x: 200, y: 200 },
          data: {
            label: "E2E Seed Input",
            params: { text: "" },
            retryCount: 1,
            timeoutMs: 30_000,
          },
          inputs: [] as [],
          outputs: [
            { id: "out", name: "Text", type: "text" as const, direction: "output" as const },
          ],
        },
      ],
      edges: [] as [],
    },
  };
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const { graph } = buildSeedGraph();

  // ── 1. Create workflow via live API ─────────────────────────────────────────
  const wfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: SESSION_COOKIE },
    body: JSON.stringify({
      name: "E2E Replay Banner Test",
      description: "Seeded by Playwright global setup — safe to delete",
      graph,
    }),
  });

  if (!wfRes.ok) {
    throw new Error(
      `[global-setup] Workflow seed failed: ${wfRes.status} ${await wfRes.text()}`,
    );
  }

  const { id: workflowId } = (await wfRes.json()) as { id: string };

  // ── 2. Insert historical run directly into SQLite ────────────────────────────
  // Direct insertion avoids triggering the engine's async dispatch loop, which
  // would require Redis + provider credentials for anything beyond an empty graph.
  // The graphSnapshot is all the replay route needs.
  const dbPath = `${E2E_DATA_DIR}/db/agentstudio.db`;
  const db = new Database(dbPath);
  const runId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO runs
       (id, workflow_id, status, graph_snapshot, graph_version, total_cost,
        started_at, completed_at, created_at)
     VALUES
       (?, ?, 'completed', ?, 1, 0, ?, ?, ?)`,
  ).run(runId, workflowId, JSON.stringify(graph), now, now, now);

  db.close();

  // ── 3. Write seed fixture ────────────────────────────────────────────────────
  writeFileSync(SEED_FILE, JSON.stringify({ workflowId, runId }, null, 2));

  console.log(`[global-setup] Seeded workflowId=${workflowId} runId=${runId}`);
}
