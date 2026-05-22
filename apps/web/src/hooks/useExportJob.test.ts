/**
 * Tests for useExportJob — polling lifecycle.
 *
 * Covers:
 *   - immediate completion: job already "completed" on first fetch → state "done"
 *   - polling starts: job is "pending" on first fetch → re-polls until "completed"
 *   - polling stops: job reaches terminal state → no further fetches
 *   - failed job: "failed" status is terminal → state "done", no more polls
 *   - reset cancels polling: reset() while polling prevents further state updates
 *   - unmount cancels polling: unmounting while pending stops the poll loop
 *   - re-trigger cancels old loop: calling trigger() twice abandons the first loop
 *   - POST error: trigger surfaces error, moves to "error" state
 *   - status fetch error: poll error surfaces via error field
 *
 * Run: pnpm --filter /web test:hooks
 *
 * The hook is rendered in a real React tree via a minimal renderHook helper
 * backed by jsdom. A very short poll interval (10 ms) avoids needing fake
 * timers while keeping tests deterministic through fetch-response ordering.
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ── jsdom bootstrap (must precede React imports) ──────────────────────────────

// Tell React's act() that this is a test environment so it doesn't warn.
// @ts-expect-error — global injected for React act() support
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost" });
// @ts-expect-error — polyfill browser globals for React/DOM
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

// React and react-dom/client resolve against the Node.js module graph; they
// use globalThis.document once it is set above.
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;

// Hook under test — imported after globals are in place.
const { useExportJob } = await import("./useExportJob.js");
type HookResult = Awaited<ReturnType<typeof useExportJob>>;

// ── Minimal renderHook utility ────────────────────────────────────────────────

/**
 * Renders a React hook inside a real React tree backed by jsdom.
 * Returns a `result` ref whose `.current` is kept in sync via a wrapper
 * component that re-renders on every state change.
 */
function renderHook<R>(
  hookFn: () => R,
): { result: { current: R }; unmount: () => void } {
  const snapshot: { current: R } = { current: undefined as unknown as R };

  function Wrapper() {
    snapshot.current = hookFn();
    return null;
  }

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  // createRoot requires a synchronous paint triggered inside act().
  let root: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(container);
    root!.render(React.createElement(Wrapper));
  });

  return {
    result: snapshot,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Wait for all pending microtasks + one macro-task tick. */
function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Wait at least `ms` ms so that real setTimeout fires. */
function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── Fetch mock helpers ────────────────────────────────────────────────────────

type FetchHandler = (url: string, init?: RequestInit) => Response;

function mockFetch(handler: FetchHandler) {
  globalThis.fetch = async (url, init) => handler(String(url), init);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeStatus(
  status: "pending" | "running" | "completed" | "failed",
  withArtifact = false,
) {
  return {
    id: "job-1",
    projectId: "proj-1",
    status,
    totalDurationMs: 5000,
    sceneCount: 1,
    renderResult:
      status === "completed"
        ? {
            sceneCount: 1,
            totalDurationMs: 5000,
            artifacts: withArtifact
              ? [{ path: "/data/export.mp4", mimeType: "video/mp4" }]
              : [],
          }
        : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-1";
const JOB_ID = "job-1";
/** Short poll interval so tests don't need fake timers. */
const POLL_MS = 10;

// ── Restore fetch after each test ─────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;
before(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useExportJob — immediate completion", () => {
  it("surfaces 'done' state when first status fetch returns 'completed'", async () => {
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      return jsonResponse(makeStatus("completed", true));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    assert.equal(result.current.state, "done");
    assert.ok(result.current.jobStatus !== null);
    assert.equal(result.current.jobStatus!.status, "completed");
    assert.equal(result.current.error, null);

    unmount();
  });

  it("exposes renderResult artifacts when job is completed", async () => {
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      return jsonResponse(makeStatus("completed", true));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    assert.ok(result.current.jobStatus?.renderResult !== null);
    assert.equal(
      result.current.jobStatus?.renderResult?.artifacts.length,
      1,
    );

    unmount();
  });
});

describe("useExportJob — polling for pending/running jobs", () => {
  it("keeps fetching while status is 'pending', resolves on 'completed'", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      // First two polls return non-terminal, third returns completed.
      if (callCount <= 2) return jsonResponse(makeStatus("pending"));
      return jsonResponse(makeStatus("completed", true));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    // Kick off trigger and wait long enough for multiple poll cycles.
    await act(async () => {
      const triggerPromise = result.current.trigger();
      await wait(POLL_MS * 10);
      await triggerPromise;
    });

    assert.equal(result.current.state, "done");
    assert.equal(result.current.jobStatus!.status, "completed");
    assert.ok(callCount >= 3, `expected ≥3 status fetches, got ${callCount}`);

    unmount();
  });

  it("keeps fetching while status is 'running', resolves on 'completed'", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      return callCount < 2
        ? jsonResponse(makeStatus("running"))
        : jsonResponse(makeStatus("completed", true));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => {
      const triggerPromise = result.current.trigger();
      await wait(POLL_MS * 8);
      await triggerPromise;
    });

    assert.equal(result.current.state, "done");
    unmount();
  });
});

describe("useExportJob — terminal states stop polling", () => {
  it("'failed' is terminal: state becomes 'done', no further fetches", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      return jsonResponse(makeStatus("failed"));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    const countAfterFirstPoll = callCount;
    // Wait longer than two poll cycles to confirm no further fetches occur.
    await wait(POLL_MS * 4);

    assert.equal(result.current.state, "done");
    assert.equal(result.current.jobStatus!.status, "failed");
    assert.equal(callCount, countAfterFirstPoll, "no additional fetches after terminal state");

    unmount();
  });

  it("'completed' is terminal: no further fetches after resolution", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      return jsonResponse(makeStatus("completed"));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    const countAtDone = callCount;
    await wait(POLL_MS * 4);

    assert.equal(callCount, countAtDone, "no further fetches after 'completed'");
    unmount();
  });
});

describe("useExportJob — cleanup", () => {
  it("reset() while polling stops further fetch calls", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      return jsonResponse(makeStatus("pending"));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    // Start trigger (don't await — let it poll in background).
    act(() => { void result.current.trigger(); });
    await wait(POLL_MS * 3);

    const countBeforeReset = callCount;
    await act(async () => { result.current.reset(); });

    // Wait another few cycles to confirm polling stopped.
    await wait(POLL_MS * 4);

    assert.equal(result.current.state, "idle");
    assert.equal(
      callCount,
      countBeforeReset,
      "no fetches after reset()",
    );

    unmount();
  });

  it("unmount cancels in-flight polling loop", async () => {
    let callCount = 0;
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      callCount++;
      return jsonResponse(makeStatus("pending"));
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    act(() => { void result.current.trigger(); });
    await wait(POLL_MS * 3);

    const countBeforeUnmount = callCount;
    unmount();

    // After unmount no new fetches should be scheduled.
    await wait(POLL_MS * 4);

    assert.ok(
      callCount <= countBeforeUnmount + 1,
      `expected at most one in-flight fetch after unmount, got ${callCount - countBeforeUnmount} extra`,
    );
  });

  it("re-trigger cancels previous polling loop", async () => {
    const firstJobCalls: string[] = [];
    const secondJobCalls: string[] = [];
    let triggerCount = 0;

    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        triggerCount++;
        return jsonResponse({ jobId: `job-${triggerCount}` });
      }
      if (url.includes("job-1")) firstJobCalls.push(url);
      if (url.includes("job-2")) secondJobCalls.push(url);
      // First job keeps returning pending; second job returns completed.
      if (url.includes("job-2")) return jsonResponse({ ...makeStatus("completed"), id: "job-2" });
      return jsonResponse({ ...makeStatus("pending"), id: "job-1" });
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    // Start first trigger and let it poll briefly.
    act(() => { void result.current.trigger(); });
    await wait(POLL_MS * 3);

    // Start second trigger — should cancel the first.
    await act(async () => { await result.current.trigger(); });

    assert.equal(result.current.state, "done");
    assert.equal(result.current.jobStatus!.status, "completed");

    // Wait to confirm job-1 is no longer polled.
    const firstJobCallsAtSwitch = firstJobCalls.length;
    await wait(POLL_MS * 4);
    assert.equal(
      firstJobCalls.length,
      firstJobCallsAtSwitch,
      "old job no longer polled after re-trigger",
    );

    unmount();
  });
});

describe("useExportJob — error handling", () => {
  it("POST failure surfaces error and sets state to 'error'", async () => {
    mockFetch(() => jsonResponse({ error: "not found" }, 404));

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    assert.equal(result.current.state, "error");
    assert.ok(result.current.error !== null);
    assert.ok(result.current.error!.includes("404") || result.current.error!.includes("not found"));

    unmount();
  });

  it("status fetch failure surfaces error and sets state to 'error'", async () => {
    mockFetch((url) => {
      if (url.includes("/export") && !url.includes("/export-jobs")) {
        return jsonResponse({ jobId: JOB_ID });
      }
      return jsonResponse({ error: "server error" }, 500);
    });

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });

    assert.equal(result.current.state, "error");
    assert.ok(result.current.error !== null);

    unmount();
  });
});

describe("useExportJob — reset from error", () => {
  it("reset() after error returns to idle", async () => {
    mockFetch(() => jsonResponse({ error: "boom" }, 500));

    const { result, unmount } = renderHook(() =>
      useExportJob(PROJECT_ID, POLL_MS),
    );

    await act(async () => { await result.current.trigger(); });
    assert.equal(result.current.state, "error");

    await act(async () => { result.current.reset(); });

    assert.equal(result.current.state, "idle");
    assert.equal(result.current.error, null);
    assert.equal(result.current.jobStatus, null);

    unmount();
  });
});
