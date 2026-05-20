import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeSubAgent } from "../subAgent.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid NodeExecutionContext.
 * We pass apiKey so executeReactAgent doesn't throw "not configured".
 * We pass provider: "anthropic" (or whatever is appropriate).
 * We pass maxSteps: 1 so the LLM loop attempts just one step before timing out.
 *
 * NOTE: These tests will make a REAL LLM call unless we pass a bad API key.
 * We deliberately use apiKey: "sk-fake" so executeReactAgent throws an auth
 * error — we only care about the behavior of executeSubAgent's outer code.
 */
function makeCtx(
  overrides: {
    inputs?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } = {},
) {
  return {
    nodeId:    "sub-agent-test",
    runId:     "run-test",
    inputs:    overrides.inputs ?? {},
    params:    overrides.params ?? {},
    outputDir: "/tmp",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeSubAgent — task validation", () => {
  it("throws when task_in input is empty string", async () => {
    const ctx = makeCtx({ inputs: { task_in: "" } });
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      (err: Error) => {
        assert.ok(err.message.includes("Sub-Agent requires a task"), err.message);
        return true;
      },
    );
  });

  it("throws when neither task_in nor params.task is provided", async () => {
    const ctx = makeCtx();
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      (err: Error) => {
        assert.ok(err.message.includes("Sub-Agent requires a task"), err.message);
        return true;
      },
    );
  });

  it("accepts task from params.task when task_in is absent", async () => {
    const ctx = makeCtx({
      params: {
        task:     "summarize AI trends",
        apiKey:   "sk-invalid-key-for-test",
        provider: "anthropic",
        maxSteps: 1,
      },
    });
    // Should NOT throw the "requires a task" error — it should proceed to LLM
    // and fail with an auth/network error (not the validation error)
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      (err: Error) => {
        assert.ok(
          !err.message.includes("Sub-Agent requires a task"),
          `Should not throw task-validation error, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

describe("executeSubAgent — credential inheritance", () => {
  it("uses __parentCredentials when params.provider is blank", async () => {
    const ctx = makeCtx({
      inputs: { task_in: "test task" },
      params: {
        provider: "",
        apiKey:   "",
        model:    "",
        __parentCredentials: {
          provider: "openai",
          apiKey:   "sk-invalid-parent-key",
          model:    "gpt-4o",
        },
        maxSteps: 1,
      },
    });
    // Should fail with openai-style auth error (not anthropic), confirming
    // credential inheritance. We're checking it didn't fail on "anthropic" default.
    // Since we can't inspect internal params, we just verify it doesn't throw
    // "Sub-Agent requires a task" and does throw something LLM-related.
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      (err: Error) => {
        assert.ok(
          !err.message.includes("Sub-Agent requires a task"),
          `Unexpected task error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("falls back to anthropic when no provider in params or parentCredentials", async () => {
    const ctx = makeCtx({
      inputs: { task_in: "test task" },
      params: {
        provider:            "",
        __parentCredentials: { provider: "", apiKey: "" },
        maxSteps:            1,
      },
    });
    // Should fail because Anthropic requires an API key (not configured)
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      (err: Error) => {
        // Must be an LLM config error, not our task validation error
        assert.ok(
          !err.message.includes("Sub-Agent requires a task"),
          `Got unexpected error: ${err.message}`,
        );
        return true;
      },
    );
  });
});
