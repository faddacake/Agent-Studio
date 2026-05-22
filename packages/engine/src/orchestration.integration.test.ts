/**
 * Graph-driven orchestration integration test.
 *
 * Verifies the full engine orchestration path:
 *
 *   WorkflowGraph → buildExecutionGraph() → RunCoordinator → NodeExecutor → capability executors
 *
 * Pipeline: Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle
 *
 * The first two stages (Prompt, ImageGen) are mock virtual/provider nodes with
 * deterministic output. The remaining four are real capability executors.
 *
 * This test closes the gap between "executors work in isolation" (Session 10)
 * and "the full engine orchestration works end-to-end".
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  nodeRegistry,
  registerBuiltInNodes,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowEdge,
  type CandidateCollection,
  type CandidateSelection,
  type NodeExecutionContext,
  type NodeExecutionResult,
  NodeRuntimeKind,
  NodeCategory,
} from "@iterastudio/shared";

import { RunCoordinator, type RunEvent, type DispatchJob, type RunState } from "./runCoordinator.js";
import { NodeExecutor } from "./executor.js";
import { executeClipScoring } from "./capabilities/clipScoring.js";
import { executeRanking } from "./capabilities/ranking.js";
import { executeSocialFormat } from "./capabilities/socialFormat.js";
import { executeExportBundle } from "./capabilities/exportBundle.js";

// ── Constants ──

const MOCK_PROMPT = "a futuristic city skyline at sunset";
const MOCK_IMAGE_URLS = [
  "https://cdn.example.com/img-001.png",
  "https://cdn.example.com/img-002.png",
  "https://cdn.example.com/img-003.png",
  "https://cdn.example.com/img-004.png",
  "https://cdn.example.com/img-005.png",
];
const TOP_K = 2;
const PLATFORMS = ["instagram", "x"];

// ── Node IDs ──

const NODE_PROMPT = crypto.randomUUID();
const NODE_IMAGEGEN = crypto.randomUUID();
const NODE_CLIP = crypto.randomUUID();
const NODE_RANKING = crypto.randomUUID();
const NODE_SOCIAL = crypto.randomUUID();
const NODE_EXPORT = crypto.randomUUID();

// ── Workflow graph builder ──

function buildTestWorkflowGraph(): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: NODE_PROMPT,
      type: "prompt-template",
      position: { x: 0, y: 0 },
      data: {
        label: "Prompt",
        params: { __nodeType: "prompt-template" },
        retryCount: 0,
        timeoutMs: 30000,
      },
      inputs: [],
      outputs: [{ id: "text_out", name: "Text", type: "text", direction: "output" }],
    },
    {
      id: NODE_IMAGEGEN,
      type: "image-generation",
      position: { x: 200, y: 0 },
      data: {
        label: "ImageGen",
        params: { __nodeType: "image-generation" },
        retryCount: 1,
        timeoutMs: 300000,
      },
      inputs: [{ id: "prompt_in", name: "Prompt", type: "text", direction: "input" }],
      outputs: [{ id: "image_out", name: "Images", type: "image", direction: "output" }],
    },
    {
      id: NODE_CLIP,
      type: "clip-scoring",
      position: { x: 400, y: 0 },
      data: {
        label: "ClipScoring",
        params: {
          __nodeType: "clip-scoring",
          model: "open_clip",
          normalizeScores: true,
        },
        retryCount: 0,
        timeoutMs: 60000,
      },
      inputs: [
        { id: "images_in", name: "Images", type: "image", direction: "input", isArray: true },
        { id: "prompt_in", name: "Prompt", type: "text", direction: "input" },
      ],
      outputs: [
        { id: "scores_out", name: "Scores", type: "json", direction: "output" },
        { id: "scored_images_out", name: "Scored Images", type: "json", direction: "output" },
      ],
    },
    {
      id: NODE_RANKING,
      type: "ranking",
      position: { x: 600, y: 0 },
      data: {
        label: "Ranking",
        params: {
          __nodeType: "ranking",
          mode: "topK",
          topK: TOP_K,
        },
        retryCount: 0,
        timeoutMs: 30000,
      },
      inputs: [
        { id: "items_in", name: "Items", type: "json", direction: "input", isArray: true },
      ],
      outputs: [
        { id: "top_items_out", name: "Top Items", type: "json", direction: "output" },
        { id: "ranked_items_out", name: "Ranked Items", type: "json", direction: "output" },
      ],
    },
    {
      id: NODE_SOCIAL,
      type: "social-format",
      position: { x: 800, y: 0 },
      data: {
        label: "SocialFormat",
        params: {
          __nodeType: "social-format",
          platforms: PLATFORMS,
          tone: "professional",
          topic: "AI art",
          includeHashtags: true,
          includeCTA: true,
        },
        retryCount: 0,
        timeoutMs: 30000,
      },
      inputs: [
        { id: "candidates_in", name: "Candidates", type: "json", direction: "input" },
      ],
      outputs: [
        { id: "formatted_out", name: "Formatted", type: "json", direction: "output" },
      ],
    },
    {
      id: NODE_EXPORT,
      type: "export-bundle",
      position: { x: 1000, y: 0 },
      data: {
        label: "ExportBundle",
        params: {
          __nodeType: "export-bundle",
          bundleName: "test-campaign",
          format: "manifest-only",
          includeImages: true,
          includeMetadata: true,
          includeSocialText: true,
          includeScores: true,
        },
        retryCount: 0,
        timeoutMs: 30000,
      },
      inputs: [
        { id: "candidates_in", name: "Candidates", type: "json", direction: "input" },
      ],
      outputs: [
        { id: "bundle_out", name: "Bundle", type: "json", direction: "output" },
        { id: "candidates_out", name: "Candidates", type: "json", direction: "output" },
      ],
    },
  ];

  const edges: WorkflowEdge[] = [
    // Prompt → ImageGen
    { id: crypto.randomUUID(), source: NODE_PROMPT, sourceHandle: "text_out", target: NODE_IMAGEGEN, targetHandle: "prompt_in" },
    // Prompt → ClipScoring (prompt context)
    { id: crypto.randomUUID(), source: NODE_PROMPT, sourceHandle: "text_out", target: NODE_CLIP, targetHandle: "prompt_in" },
    // ImageGen → ClipScoring (images)
    { id: crypto.randomUUID(), source: NODE_IMAGEGEN, sourceHandle: "image_out", target: NODE_CLIP, targetHandle: "images_in" },
    // ClipScoring → Ranking (scored candidates)
    { id: crypto.randomUUID(), source: NODE_CLIP, sourceHandle: "scored_images_out", target: NODE_RANKING, targetHandle: "items_in" },
    // Ranking → SocialFormat (top items)
    { id: crypto.randomUUID(), source: NODE_RANKING, sourceHandle: "top_items_out", target: NODE_SOCIAL, targetHandle: "candidates_in" },
    // SocialFormat → ExportBundle (formatted candidates)
    { id: crypto.randomUUID(), source: NODE_SOCIAL, sourceHandle: "formatted_out", target: NODE_EXPORT, targetHandle: "candidates_in" },
  ];

  return { version: 1, nodes, edges };
}

// ── Test suite ──

describe("Graph-driven orchestration: WorkflowGraph → RunCoordinator → NodeExecutor", () => {
  let executor: NodeExecutor;
  let coordinator: RunCoordinator;
  let events: RunEvent[];
  let executionOrder: string[];
  let run: RunState;

  before(() => {
    // Register all built-in node definitions
    nodeRegistry.clear();
    registerBuiltInNodes();

    // Create a fresh executor and register capability handlers
    executor = new NodeExecutor();
    executor.registerCapability("clip-scoring", executeClipScoring);
    executor.registerCapability("ranking", executeRanking);
    executor.registerCapability("social-format", executeSocialFormat);
    executor.registerCapability("export-bundle", executeExportBundle);

    // Register mock local handlers for Prompt and ImageGen.
    // In production these would be a virtual passthrough and a provider call,
    // but for testing we use local executors with deterministic output.
    executor.registerLocal("prompt-template", async () => ({
      outputs: { text_out: MOCK_PROMPT },
      cost: 0,
    }));

    executor.registerLocal("image-generation", async () => ({
      outputs: { image_out: MOCK_IMAGE_URLS },
      cost: 0.05,
    }));

    // Patch definitions to use Local runtimeKind so the executor routes correctly
    for (const nodeType of ["prompt-template", "image-generation"]) {
      const def = nodeRegistry.get(nodeType);
      if (def) {
        nodeRegistry.register({ ...def, runtimeKind: NodeRuntimeKind.Local });
      }
    }

    // Track events and execution order
    events = [];
    executionOrder = [];
    coordinator = new RunCoordinator();
  });

  after(() => {
    nodeRegistry.clear();
  });

  it("builds execution graph with correct tiers and topological order", () => {
    const workflow = buildTestWorkflowGraph();
    run = coordinator.createRun({
      runId: "test-run-001",
      workflowId: "test-workflow-001",
      workflow,
    });

    const graph = run.graph;

    // 6 nodes parsed
    assert.equal(graph.nodes.size, 6, "graph should contain 6 nodes");

    // Topological order should list all 6 nodes
    assert.equal(graph.sortedIds.length, 6, "topological sort should include all 6 nodes");

    // Prompt should come first (no dependencies)
    assert.equal(graph.sortedIds[0], NODE_PROMPT, "prompt should be first in topological order");

    // ExportBundle should come last (depends on everything upstream)
    assert.equal(graph.sortedIds[graph.sortedIds.length - 1], NODE_EXPORT, "export should be last in topological order");

    // Verify tier structure
    assert.ok(graph.tiers.length >= 5, `should have at least 5 tiers (got ${graph.tiers.length})`);

    // Tier 0: Prompt (no deps)
    assert.ok(graph.tiers[0].includes(NODE_PROMPT), "tier 0 should contain Prompt node");

    // ImageGen depends on Prompt, ClipScoring depends on Prompt+ImageGen, etc.
    // Verify each node appears in a tier after all its dependencies
    for (const [nodeId, node] of graph.nodes) {
      const nodeTier = graph.tiers.findIndex((tier) => tier.includes(nodeId));
      assert.ok(nodeTier >= 0, `${nodeId} should be in some tier`);
      for (const depId of node.dependencies) {
        const depTier = graph.tiers.findIndex((tier) => tier.includes(depId));
        assert.ok(depTier < nodeTier, `dependency ${depId} (tier ${depTier}) should be in an earlier tier than ${nodeId} (tier ${nodeTier})`);
      }
    }
  });

  it("runs full pipeline via coordinator dispatch loop", async () => {
    // Subscribe to events
    const unsubscribe = coordinator.on((event) => {
      events.push(event);
    });

    // Build a dispatch function that executes nodes inline
    // This simulates the worker loop: coordinator dispatches → executor runs → reports back
    const dispatch: DispatchJob = async (job) => {
      executionOrder.push(job.nodeId);

      // Mark node as started
      const nodeState = run.nodeStates.get(job.nodeId)!;
      nodeState.status = "running";
      nodeState.startedAt = Date.now();

      try {
        const context: NodeExecutionContext = {
          nodeId: job.nodeId,
          runId: job.runId,
          inputs: job.inputs,
          params: job.params,
          providerId: job.providerId,
          modelId: job.modelId,
          outputDir: "/tmp/aistudio-test",
        };

        const result = await executor.execute(context);

        // Report success back to coordinator
        await coordinator.onNodeCompleted(
          job.runId,
          job.nodeId,
          result.outputs,
          result.cost,
          dispatch,
        );
      } catch (err) {
        await coordinator.onNodeFailed(
          job.runId,
          job.nodeId,
          err instanceof Error ? err.message : String(err),
          dispatch,
        );
      }
    };

    // Start the run — this kicks off the dispatch loop
    await coordinator.startRun("test-run-001", dispatch);

    // Verify run completed
    assert.equal(run.status, "completed", `run should be completed (got: ${run.status})`);

    unsubscribe();
  });

  it("dispatches nodes only when dependencies are satisfied", () => {
    // Verify execution order respects the DAG
    const orderIndex = (nodeId: string) => executionOrder.indexOf(nodeId);

    // Prompt must execute before ImageGen
    assert.ok(orderIndex(NODE_PROMPT) < orderIndex(NODE_IMAGEGEN),
      "Prompt should execute before ImageGen");

    // ImageGen must execute before ClipScoring
    assert.ok(orderIndex(NODE_IMAGEGEN) < orderIndex(NODE_CLIP),
      "ImageGen should execute before ClipScoring");

    // ClipScoring must execute before Ranking
    assert.ok(orderIndex(NODE_CLIP) < orderIndex(NODE_RANKING),
      "ClipScoring should execute before Ranking");

    // Ranking must execute before SocialFormat
    assert.ok(orderIndex(NODE_RANKING) < orderIndex(NODE_SOCIAL),
      "Ranking should execute before SocialFormat");

    // SocialFormat must execute before ExportBundle
    assert.ok(orderIndex(NODE_SOCIAL) < orderIndex(NODE_EXPORT),
      "SocialFormat should execute before ExportBundle");
  });

  it("records expected node status transitions via events", () => {
    // Verify run:started
    assert.ok(events.some((e) => e.type === "run:started"), "should emit run:started");

    // Verify run:completed
    assert.ok(events.some((e) => e.type === "run:completed"), "should emit run:completed");

    // Every node should have been queued then completed
    const nodeIds = [NODE_PROMPT, NODE_IMAGEGEN, NODE_CLIP, NODE_RANKING, NODE_SOCIAL, NODE_EXPORT];
    for (const nodeId of nodeIds) {
      const queued = events.find((e) => e.type === "node:queued" && e.nodeId === nodeId);
      const completed = events.find((e) => e.type === "node:completed" && e.nodeId === nodeId);
      assert.ok(queued, `node ${nodeId} should have been queued`);
      assert.ok(completed, `node ${nodeId} should have been completed`);

      // Queued should appear before completed in the event stream
      assert.ok(events.indexOf(queued!) < events.indexOf(completed!),
        `node ${nodeId}: queued event should precede completed event`);
    }

    // No node:failed events
    const failures = events.filter((e) => e.type === "node:failed");
    assert.equal(failures.length, 0, "no nodes should have failed");
  });

  it("no node executes twice", () => {
    const nodeIds = [NODE_PROMPT, NODE_IMAGEGEN, NODE_CLIP, NODE_RANKING, NODE_SOCIAL, NODE_EXPORT];
    for (const nodeId of nodeIds) {
      const count = executionOrder.filter((id) => id === nodeId).length;
      assert.equal(count, 1, `node ${nodeId} should execute exactly once (got ${count})`);
    }
    assert.equal(executionOrder.length, 6, "exactly 6 nodes should execute");
  });

  it("all nodes reach completed status", () => {
    for (const [nodeId, state] of run.nodeStates) {
      assert.equal(state.status, "completed", `node ${nodeId} should be completed (got: ${state.status})`);
      assert.ok(state.completedAt, `node ${nodeId} should have completedAt timestamp`);
      assert.equal(state.attempt, 1, `node ${nodeId} should have attempt = 1`);
    }
  });

  it("final export output exists and preserves upstream metadata", () => {
    const exportState = run.nodeStates.get(NODE_EXPORT)!;
    assert.ok(exportState.outputs, "export node should have outputs");

    const manifest = exportState.outputs.bundle_out as Record<string, unknown>;
    const exportedCandidates = exportState.outputs.candidates_out as CandidateCollection;

    // ── Manifest structure ──
    assert.equal(manifest.bundleName, "test-campaign", "manifest bundleName");
    assert.equal(manifest.format, "manifest-only", "manifest format");
    assert.equal(manifest.candidateCount, TOP_K, "manifest candidateCount should match top-K");

    // ── Assets ──
    const assets = manifest.assets as Array<Record<string, unknown>>;
    assert.equal(assets.length, TOP_K, "should have one asset per selected candidate");
    for (const asset of assets) {
      assert.ok(asset.candidateId, "asset should have candidateId");
      assert.ok(asset.assetRef, "asset should have assetRef (image URL)");
      assert.ok(asset.rank, "asset should preserve rank from Ranking");
      assert.ok(Array.isArray(asset.scores), "asset should preserve scores from ClipScoring");
      const clipScore = (asset.scores as Array<Record<string, unknown>>).find(
        (s) => s.metric === "clip_similarity",
      );
      assert.ok(clipScore, "asset scores should include clip_similarity");
    }

    // ── Social entries ──
    const socialEntries = manifest.socialEntries as Array<Record<string, unknown>>;
    assert.equal(
      socialEntries.length,
      TOP_K * PLATFORMS.length,
      `should have ${TOP_K} x ${PLATFORMS.length} social entries`,
    );
    for (const entry of socialEntries) {
      assert.ok(entry.candidateId, "social entry should have candidateId");
      assert.ok(PLATFORMS.includes(entry.platform as string), "social entry platform should be valid");
      assert.equal(typeof entry.caption, "string", "social entry should have caption");
      assert.ok(Array.isArray(entry.hashtags), "social entry should have hashtags");
    }

    // ── Summary ──
    const summary = manifest.summary as Record<string, unknown>;
    assert.equal(summary.totalCandidates, TOP_K, "summary totalCandidates");
    assert.equal(summary.hasScores, true, "summary hasScores");
    assert.equal(summary.hasSocialData, true, "summary hasSocialData");

    // ── Exported candidates preserve all upstream metadata ──
    assert.equal(exportedCandidates.items.length, TOP_K, "exported candidate count");
    for (const item of exportedCandidates.items) {
      // Scores from ClipScoring (stage 3)
      const clipScore = item.scores?.find((s) => s.metric === "clip_similarity");
      assert.ok(clipScore, "exported candidate preserves clip_similarity score");
      assert.equal(clipScore!.model, "open_clip", "score model preserved");

      // Rank from Ranking (stage 4)
      assert.ok(typeof item.rank === "number" && item.rank >= 1, "exported candidate preserves rank");

      // Social variants from SocialFormat (stage 5)
      const socialVariants = item.metadata?.socialVariants as Record<string, unknown>;
      assert.ok(socialVariants, "exported candidate preserves socialVariants");
      for (const platform of PLATFORMS) {
        assert.ok(socialVariants[platform], `exported candidate preserves ${platform} variant`);
      }

      // Export metadata from ExportBundle (stage 6)
      assert.equal(item.metadata?.exportBundleName, "test-campaign", "exported candidate has exportBundleName");
      assert.ok(item.metadata?.exportedAt, "exported candidate has exportedAt");
    }
  });

  it("coordinator input resolution correctly wires upstream outputs to downstream inputs", () => {
    // Verify that ClipScoring received the images from ImageGen
    const clipState = run.nodeStates.get(NODE_CLIP)!;
    const scoredOut = clipState.outputs.scored_images_out as CandidateCollection;
    assert.equal(scoredOut.items.length, MOCK_IMAGE_URLS.length,
      "ClipScoring should have received all mock images from ImageGen");

    // Verify that Ranking received the scored collection from ClipScoring
    const rankState = run.nodeStates.get(NODE_RANKING)!;
    const rankedOut = rankState.outputs.ranked_items_out as CandidateCollection;
    assert.equal(rankedOut.items.length, MOCK_IMAGE_URLS.length,
      "Ranking should have received all scored items from ClipScoring");

    // Verify that SocialFormat received only top-K from Ranking
    const socialState = run.nodeStates.get(NODE_SOCIAL)!;
    const formattedOut = socialState.outputs.formatted_out as CandidateCollection;
    assert.equal(formattedOut.items.length, TOP_K,
      "SocialFormat should have received top-K items from Ranking");

    // Verify that ExportBundle received formatted candidates from SocialFormat
    const exportState = run.nodeStates.get(NODE_EXPORT)!;
    const exportedOut = exportState.outputs.candidates_out as CandidateCollection;
    assert.equal(exportedOut.items.length, TOP_K,
      "ExportBundle should have received formatted candidates from SocialFormat");
  });

  it("coordinator tracks total cost across nodes", () => {
    // Our mock provider costs 0.05, capability nodes cost 0
    assert.equal(run.totalCost, 0.05, "run should accumulate total cost from provider node");
  });
});
