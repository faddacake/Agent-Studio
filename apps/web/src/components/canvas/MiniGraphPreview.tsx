"use client";

/**
 * MiniGraphPreview — a lightweight, read-only ReactFlow visualization of a
 * WorkflowGraph. Used to preview a template's topology in the Template Gallery
 * before inserting it into the canvas.
 *
 * All interactivity is disabled. Pointer events on the container should be
 * suppressed by the caller (style={{ pointerEvents: "none" }}) so the preview
 * does not interfere with surrounding UI controls.
 */

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import type { WorkflowGraph } from "@iterastudio/shared";

// ── Mini node renderer ─────────────────────────────────────────────────────

function MiniNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded border border-neutral-600 bg-neutral-800 px-1.5 py-0.5 text-[8px] font-medium leading-tight text-neutral-300 select-none whitespace-nowrap">
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: "none", width: 4, height: 4, minWidth: 0, minHeight: 0 }}
      />
      {data.label}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: "none", width: 4, height: 4, minWidth: 0, minHeight: 0 }}
      />
    </div>
  );
}

const MINI_NODE_TYPES = { mini: MiniNode };

// ── Preview ────────────────────────────────────────────────────────────────

export interface MiniGraphPreviewProps {
  graph: WorkflowGraph;
  className?: string;
}

function MiniGraphPreviewInner({ graph, className }: MiniGraphPreviewProps) {
  const nodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "mini" as const,
        position: n.position,
        data: { label: n.data.label },
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    // graph reference changes when the template changes; fine to re-derive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        // omit sourceHandle/targetHandle — mini nodes expose generic handles
        style: { stroke: "#525252", strokeWidth: 1 },
        animated: false,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={MINI_NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
      className={className ?? "bg-neutral-900/60"}
    />
  );
}

export function MiniGraphPreview({ graph, className }: MiniGraphPreviewProps) {
  if (graph.nodes.length === 0) return null;

  return (
    <ReactFlowProvider>
      <MiniGraphPreviewInner graph={graph} className={className} />
    </ReactFlowProvider>
  );
}
