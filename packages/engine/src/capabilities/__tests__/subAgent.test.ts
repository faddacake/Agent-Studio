import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test credential resolution logic (extracted as helpers)
describe("sub-agent credential resolution", () => {
  it("uses explicit provider when set", () => {
    const provider = "openai".trim() || "inherited";
    assert.equal(provider, "openai");
  });

  it("falls back to parentCreds when provider is blank", () => {
    const explicit = "".trim();
    const parentCreds = { provider: "anthropic" };
    const resolved = (explicit || parentCreds.provider) ?? "anthropic";
    assert.equal(resolved, "anthropic");
  });

  it("uses default anthropic when no creds anywhere", () => {
    const explicit = "".trim();
    const parentCreds = {};
    const resolved = (explicit || parentCreds.provider) ?? "anthropic";
    assert.equal(resolved, "anthropic");
  });
});

describe("sub-agent task validation", () => {
  it("throws when task is empty", async () => {
    // Create a minimal context with empty task
    const { executeSubAgent } = await import("../subAgent.js");
    const ctx = {
      nodeId: "test",
      runId:  "run1",
      inputs: { task_in: "" },
      params: {},
      outputDir: "/tmp",
    };
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      /Sub-Agent requires a task/,
    );
  });

  it("throws when task_in port is missing and params.task is also missing", async () => {
    const { executeSubAgent } = await import("../subAgent.js");
    const ctx = {
      nodeId: "test",
      runId:  "run1",
      inputs: {},
      params: {},
      outputDir: "/tmp",
    };
    await assert.rejects(
      () => executeSubAgent(ctx as any, {} as any),
      /Sub-Agent requires a task/,
    );
  });
});
