"use client";

import { useCallback, useMemo } from "react";
import type { WorkflowNode } from "@iterastudio/shared";
import { nodeRegistry, validateParams } from "@iterastudio/shared";
import { initializeNodeRegistry } from "@/lib/nodeRegistryInit";
import { SchemaForm } from "./SchemaForm";

// Ensure registry is populated on first import
initializeNodeRegistry();

interface NodeConfigProps {
  /** The selected workflow node */
  node: WorkflowNode;
  /** Called when a parameter value changes */
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
}

/**
 * Schema-driven node configuration panel.
 *
 * Queries the NodeRegistry for the selected node's definition,
 * then renders a form from its parameterSchema and uiSchema.
 * Adding a new NodeDefinition requires zero UI code.
 */
export function NodeConfig({ node, onParamChange }: NodeConfigProps) {
  const nodeDef = nodeRegistry.get(node.type);

  const handleChange = useCallback(
    (key: string, value: unknown) => {
      onParamChange(node.id, key, value);
    },
    [node.id, onParamChange],
  );

  // Validate current params against schema
  const errors = useMemo(() => {
    if (!nodeDef) return {};
    const errorList = validateParams(nodeDef, node.data.params);
    const errorMap: Record<string, string> = {};
    for (const msg of errorList) {
      // validateParams returns "<Label> ..." messages, extract the field key
      const field = nodeDef.parameterSchema.find((f) => msg.startsWith(f.label));
      if (field) errorMap[field.key] = msg;
    }
    return errorMap;
  }, [nodeDef, node.data.params]);

  // Unrecognized node type — fallback to raw JSON editor
  if (!nodeDef) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-200">{node.data.label}</span>
          <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-400">
            unknown type
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          No definition found for node type &quot;{node.type}&quot;.
          Parameters shown as raw JSON.
        </p>
        <textarea
          value={JSON.stringify(node.data.params, null, 2)}
          rows={8}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (typeof parsed === "object" && parsed !== null) {
                for (const [k, v] of Object.entries(parsed)) {
                  onParamChange(node.id, k, v);
                }
              }
            } catch {
              // Invalid JSON — ignore until valid
            }
          }}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 font-mono focus:border-blue-500 focus:outline-none resize-y"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Node header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-200">{nodeDef.label}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
            {nodeDef.category}
          </span>
        </div>
        <p className="text-[11px] text-neutral-500">{nodeDef.description}</p>
      </div>

      {/* Provider info for provider nodes */}
      {nodeDef.provider && (
        <div className="flex items-center gap-2 rounded bg-neutral-800/50 px-2 py-1.5">
          <span className="text-[11px] text-neutral-400">
            Provider: <span className="text-neutral-300">{nodeDef.provider.providerId}</span>
          </span>
          <span className="text-neutral-700">|</span>
          <span className="text-[11px] text-neutral-400">
            Model: <span className="text-neutral-300">{nodeDef.provider.modelId}</span>
          </span>
        </div>
      )}

      {/* Port summary */}
      {(nodeDef.inputs.length > 0 || nodeDef.outputs.length > 0) && (
        <div className="flex gap-4 text-[11px] text-neutral-500">
          {nodeDef.inputs.length > 0 && (
            <span>
              {nodeDef.inputs.length} input{nodeDef.inputs.length !== 1 && "s"}:{" "}
              {nodeDef.inputs.map((p) => p.label).join(", ")}
            </span>
          )}
          {nodeDef.outputs.length > 0 && (
            <span>
              {nodeDef.outputs.length} output{nodeDef.outputs.length !== 1 && "s"}:{" "}
              {nodeDef.outputs.map((p) => p.label).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Divider */}
      <hr className="border-neutral-800" />

      {/* Schema-driven form */}
      <SchemaForm
        parameterSchema={nodeDef.parameterSchema}
        uiSchema={nodeDef.uiSchema}
        values={node.data.params}
        onChange={handleChange}
        errors={errors}
      />

      {/* Cost estimate */}
      {nodeDef.estimateCost && (
        <CostBadge params={node.data.params} estimateCost={nodeDef.estimateCost} />
      )}
    </div>
  );
}

// ── Cost badge ──

function CostBadge({
  params,
  estimateCost,
}: {
  params: Record<string, unknown>;
  estimateCost: (params: Record<string, unknown>) => { estimated: number; isApproximate: boolean; breakdown?: string };
}) {
  const estimate = estimateCost(params);
  return (
    <div className="flex items-center gap-2 rounded bg-neutral-800/50 px-2 py-1.5 mt-1">
      <span className="text-[11px] text-neutral-400">
        Est. cost:{" "}
        <span className="text-neutral-200">
          {estimate.isApproximate && "~"}${estimate.estimated.toFixed(2)}
        </span>
      </span>
      {estimate.breakdown && (
        <span className="text-[11px] text-neutral-500">({estimate.breakdown})</span>
      )}
    </div>
  );
}
