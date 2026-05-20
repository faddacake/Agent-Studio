/**
 * Tests for the ReAct Agent reflection helpers:
 *   - parseReflectionResponse
 *   - buildReflectionPrompt
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReflectionResponse,
  buildReflectionPrompt,
} from "../reactAgent.js";

describe("parseReflectionResponse", () => {
  it("returns noRevisionNeeded: true on 'No Revision Needed' path", () => {
    const text = `Critique: The answer is complete and addresses all aspects of the goal.
No Revision Needed`;
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, true);
    assert.equal(result.revisedAnswer, undefined);
    assert.ok(result.critique.length > 0);
  });

  it("extracts critique text from 'No Revision Needed' response", () => {
    const text = `Critique: The answer covers all key points accurately.
No Revision Needed`;
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, true);
    assert.match(result.critique, /covers all key points/);
  });

  it("returns revisedAnswer on 'Revised Answer:' path", () => {
    const text = `Critique: The answer is missing an important detail about error handling.
Revised Answer: Here is the improved answer with error handling included.`;
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, false);
    assert.equal(result.revisedAnswer, "Here is the improved answer with error handling included.");
    assert.match(result.critique, /missing an important detail/);
  });

  it("handles multiline revised answers", () => {
    const text = `Critique: Several gaps identified.
Revised Answer: Line one of the answer.
Line two of the answer.
Line three of the answer.`;
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, false);
    assert.ok(result.revisedAnswer?.includes("Line one"));
    assert.ok(result.revisedAnswer?.includes("Line three"));
  });

  it("falls back to noRevisionNeeded: true for unrecognized format", () => {
    const text = "This response does not follow the expected format at all.";
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, true);
    assert.equal(result.revisedAnswer, undefined);
    assert.ok(result.critique.length > 0);
  });

  it("is case-insensitive for 'No Revision Needed'", () => {
    const text = `Critique: Looks good.
no revision needed`;
    const result = parseReflectionResponse(text);
    assert.equal(result.noRevisionNeeded, true);
  });
});

describe("buildReflectionPrompt", () => {
  it("includes the goal in the output", () => {
    const prompt = buildReflectionPrompt("Summarize quantum computing", "Quantum computing uses qubits.", 1);
    assert.ok(prompt.includes("Summarize quantum computing"));
  });

  it("includes the answer in the output", () => {
    const prompt = buildReflectionPrompt("Some goal", "This is my answer.", 1);
    assert.ok(prompt.includes("This is my answer."));
  });

  it("includes the round number in the output", () => {
    const prompt = buildReflectionPrompt("Some goal", "Some answer", 1);
    assert.ok(prompt.includes("reflection round 1"));
  });

  it("round 1 and round 2 produce different round number text", () => {
    const prompt1 = buildReflectionPrompt("goal", "answer", 1);
    const prompt2 = buildReflectionPrompt("goal", "answer", 2);
    assert.ok(prompt1.includes("round 1"));
    assert.ok(prompt2.includes("round 2"));
    assert.notEqual(prompt1, prompt2);
  });

  it("includes instructions about critique and revision", () => {
    const prompt = buildReflectionPrompt("goal", "answer", 1);
    assert.ok(prompt.includes("Critique:"));
    assert.ok(prompt.includes("Revised Answer:"));
    assert.ok(prompt.includes("No Revision Needed"));
  });
});
