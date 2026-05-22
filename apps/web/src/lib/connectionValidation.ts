/**
 * connectionValidation — canvas-side port compatibility check.
 *
 * Used as the `isValidConnection` prop on <ReactFlow>. When it returns false,
 * React Flow refuses to complete the drag and shows a visual rejection
 * (connection line stays red / won't snap to the target handle).
 *
 * Delegates to PORT_COMPATIBILITY from /shared — no parallel logic.
 */
import type { Connection, Edge, Node } from "@xyflow/react";
import { PORT_COMPATIBILITY } from "@iterastudio/shared";
import type { Port } from "@iterastudio/shared";

/**
 * Returns true if the proposed connection is allowed by PORT_COMPATIBILITY.
 *
 * Accepts `Connection | Edge` to match React Flow's IsValidConnection signature.
 * Resolves port types by looking up sourceHandle in the source node's outputs
 * and targetHandle in the target node's inputs. Both are stored as Port[] in
 * node.data.outputs / node.data.inputs by the toFlowNode adapter.
 */
export function isConnectionValid(nodes: Node[], connection: Connection | Edge): boolean {
  const source       = connection.source;
  const sourceHandle = connection.sourceHandle ?? null;
  const target       = connection.target;
  const targetHandle = "targetHandle" in connection ? (connection.targetHandle ?? null) : null;

  if (!source || !sourceHandle || !target || !targetHandle) return false;

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return false;

  const outputs = (sourceNode.data.outputs ?? []) as Port[];
  const inputs  = (targetNode.data.inputs  ?? []) as Port[];

  const sourcePort = outputs.find((p) => p.id === sourceHandle);
  const targetPort = inputs.find((p)  => p.id === targetHandle);
  if (!sourcePort || !targetPort) return false;

  const compat = PORT_COMPATIBILITY[sourcePort.type];
  return compat?.[targetPort.type] === true;
}
