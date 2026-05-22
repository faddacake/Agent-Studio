/**
 * Unit tests for workflowStore – replayRunId lifecycle.
 *
 * Run: pnpm --filter /web test:store
 */

import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

// Dynamic import deferred to first test to allow fetch mock to be in place.
import { useWorkflowStore } from "./workflowStore";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPLAY_RUN_ID = "run-abc-0000-1111-2222";
const NEW_RUN_ID = "run-xyz-3333-4444-5555";

const meta = {
  id: "wf-test-1",
  name: "Test Workflow",
  description: "",
  lastRunStatus: null,
  lastRunAt: null,
  revisionCount: 0,
};

const graph = { version: 1 as const, nodes: [], edges: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const s = () => useWorkflowStore.getState();

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("workflowStore – replayRunId lifecycle", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    // Reset to a known replay-loaded state before each test.
    // Also reset fields that loadWorkflow intentionally leaves untouched so
    // there is no state leakage between tests (Zustand store is a singleton).
    s().loadWorkflow(meta, graph, REPLAY_RUN_ID);
    useWorkflowStore.setState({ currentRunId: null, debuggerOpen: false });
  });

  test("loadWorkflow sets replayRunId when provided", () => {
    assert.equal(s().replayRunId, REPLAY_RUN_ID);
  });

  test("loadWorkflow without replayRunId leaves it null", () => {
    s().loadWorkflow(meta, graph);
    assert.equal(s().replayRunId, null);
  });

  test("loadWorkflow with explicit null clears replayRunId", () => {
    s().loadWorkflow(meta, graph, null);
    assert.equal(s().replayRunId, null);
  });

  test("runWorkflow clears replayRunId after successful 202 dispatch", async () => {
    mockFetch(202, { id: NEW_RUN_ID });

    // Banner is still visible before the run starts.
    assert.equal(s().replayRunId, REPLAY_RUN_ID);

    await s().runWorkflow();

    assert.equal(s().replayRunId, null);
    assert.equal(s().currentRunId, NEW_RUN_ID);
    assert.equal(s().debuggerOpen, true);
  });

  test("runWorkflow preserves replayRunId when dispatch fails (500)", async () => {
    mockFetch(500, { error: "internal server error" });

    await s().runWorkflow();

    // Banner must remain — user should still be able to retry.
    assert.equal(s().replayRunId, REPLAY_RUN_ID);
    // currentRunId must not change to a stale/wrong value.
    assert.equal(s().currentRunId, null);
  });

  test("setReplayRunId(null) manually dismisses the banner", () => {
    assert.equal(s().replayRunId, REPLAY_RUN_ID);
    s().setReplayRunId(null);
    assert.equal(s().replayRunId, null);
  });

  test("loadWorkflow resets latestOutputsByNode to null", () => {
    // Simulate outputs having been populated by a previous run.
    useWorkflowStore.setState({
      latestOutputsByNode: {
        "node-1": { nodeId: "node-1", runId: "run-old", workflowId: "wf-test-1", outputType: "text", textSnippet: "hi" },
      },
    });
    s().loadWorkflow(meta, graph, REPLAY_RUN_ID);
    assert.equal(s().latestOutputsByNode, null);
  });

  test("loadWorkflow resets staleNodeIds to empty", () => {
    useWorkflowStore.setState({ staleNodeIds: { "node-1": true } });
    s().loadWorkflow(meta, graph, REPLAY_RUN_ID);
    assert.deepEqual(s().staleNodeIds, {});
  });

  test("loadWorkflow resets nodeRunStatesById and latestExecutionByNodeId", () => {
    useWorkflowStore.setState({
      nodeRunStatesById: { "node-1": "failed" },
      latestExecutionByNodeId: { "node-1": { nodeId: "node-1", runId: "run-old", status: "failed" } },
    });
    s().loadWorkflow(meta, graph, REPLAY_RUN_ID);
    assert.deepEqual(s().nodeRunStatesById, {});
    assert.deepEqual(s().latestExecutionByNodeId, {});
  });

  test("isRunning returns to false after successful dispatch", async () => {
    mockFetch(202, { id: NEW_RUN_ID });
    await s().runWorkflow();
    assert.equal(s().isRunning, false);
  });

  test("isRunning returns to false after failed dispatch", async () => {
    mockFetch(500, {});
    await s().runWorkflow();
    assert.equal(s().isRunning, false);
  });
});
