"use client";

import type { NodeDefinition, WorkflowNode } from "@iterastudio/shared";
import { getDefaultParams, toWorkflowPorts } from "@iterastudio/shared";

/**
 * Create a WorkflowNode from a NodeDefinition.
 *
 * This is the single bridge between "user picks node from palette"
 * and "node exists on the canvas." All default params, ports, and
 * metadata come from the registry definition — nothing is hardcoded.
 */
export function createWorkflowNode(
  definition: NodeDefinition,
  position: { x: number; y: number },
): WorkflowNode {
  return {
    id: crypto.randomUUID(),
    type: definition.type,
    position,
    data: {
      label: definition.label,
      params: getDefaultParams(definition),
      retryCount: definition.runtimeKind === "provider" ? 1 : 0,
      timeoutMs: definition.runtimeKind === "provider" ? 300_000 : 60_000,
      ...(definition.provider
        ? {
            providerId: definition.provider.providerId,
            modelId: definition.provider.modelId,
          }
        : {}),
    },
    inputs: toWorkflowPorts(definition.inputs, "input"),
    outputs: toWorkflowPorts(definition.outputs, "output"),
  };
}
