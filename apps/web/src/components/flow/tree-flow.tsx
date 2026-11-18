'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export type FlowItem = {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  color: string;
};

type CardData = { title: string; subtitle: string; color: string };
type CardNode = Node<CardData, 'card'>;
type Point = { x: number; y: number };

const NW = 220;
const NH = 68;

function layoutKey(label: string) {
  return `af-flow-layout:${label}`;
}

function readLayout(label: string): Record<string, Point> {
  try {
    const raw = localStorage.getItem(layoutKey(label));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { x?: number; y?: number }>;
    const saved: Record<string, Point> = {};
    for (const [id, point] of Object.entries(parsed)) {
      const x = point?.x;
      const y = point?.y;
      if (
        typeof x === 'number' &&
        typeof y === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      )
        saved[id] = { x, y };
    }
    return saved;
  } catch {
    return {};
  }
}

function writeLayout(label: string, positions: Record<string, Point>) {
  localStorage.setItem(layoutKey(label), JSON.stringify(positions));
}

function Card({ data }: NodeProps<CardNode>) {
  return (
    <div className="w-[13.75rem] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: data.color, width: 8, height: 8, border: '2px solid white' }}
      />
      <div className="h-1.5" style={{ background: data.color }} />
      <div className="px-3 py-2.5">
        <div className="truncate text-[11px] font-medium" style={{ color: data.color }}>
          {data.subtitle}
        </div>
        <div className="truncate text-sm font-semibold text-slate-900">{data.title}</div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: data.color,
          width: 8,
          height: 8,
          border: '2px solid white',
          left: 18,
        }}
      />
    </div>
  );
}

function SpineEdge({ id, sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const radius = 12;
  const drop = Math.max(targetY - sourceY, 0);
  const turn = Math.min(radius, drop / 2, Math.max(targetX - sourceX, 0) / 2);
  const path =
    turn < 2
      ? `M ${sourceX} ${sourceY} L ${sourceX} ${targetY} L ${targetX} ${targetY}`
      : `M ${sourceX} ${sourceY} L ${sourceX} ${targetY - turn} Q ${sourceX} ${targetY} ${sourceX + turn} ${targetY} L ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <path
        d={path}
        fill="none"
        className="react-flow__edge-path"
        style={{ ...style, strokeDasharray: 6 }}
      />
    </>
  );
}

const nodeTypes = { card: Card };
const edgeTypes = { spine: SpineEdge };

function arrange(items: FlowItem[], width: number, height: number) {
  const ids = new Set(items.map((n) => n.id));
  const kids = new Map<string, FlowItem[]>();
  for (const n of items) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : '';
    kids.set(parent, [...(kids.get(parent) ?? []), n]);
  }
  const rowsOf = (id: string): number => {
    const children = kids.get(id) ?? [];
    if (!children.length) return 1;
    return 1 + children.reduce((sum, child) => sum + rowsOf(child.id), 0);
  };
  const depthOf = (id: string): number => {
    const children = kids.get(id) ?? [];
    if (!children.length) return 0;
    return 1 + Math.max(...children.map((child) => depthOf(child.id)));
  };
  const roots = kids.get('') ?? [];
  const totalRows = roots.reduce((sum, root) => sum + rowsOf(root.id), 0) || 1;
  const maxDepth = roots.reduce((max, root) => Math.max(max, depthOf(root.id)), 0);
  const row = Math.max(NH + 24, (height - 36) / totalRows);
  const col = Math.max(NW + 56, Math.min(NW + 200, (width - 36 - NW) / Math.max(maxDepth, 1)));
  const pos = new Map<string, Point>();
  const place = (id: string, depth: number, top: number): number => {
    pos.set(id, { x: 20 + depth * col, y: top });
    let y = top + row;
    for (const child of kids.get(id) ?? []) y = place(child.id, depth + 1, y);
    return y;
  };
  let top = 16;
  for (const root of roots) top = place(root.id, 0, top);
  const nodes: CardNode[] = items.map((n) => ({
    id: n.id,
    type: 'card',
    position: pos.get(n.id) ?? { x: 20, y: 16 },
    data: { title: n.title, subtitle: n.subtitle, color: n.color },
    style: { padding: 0, border: 'none', background: 'transparent', width: NW },
  }));
  const edges: Edge[] = [];
  for (const n of items) {
    for (const child of kids.get(n.id) ?? []) {
      edges.push({
        id: `${n.id}-${child.id}`,
        source: n.id,
        target: child.id,
        type: 'spine',
        animated: true,
        style: { stroke: child.color, strokeWidth: 1.75 },
      });
    }
  }
  return { nodes, edges, pos };
}

function Canvas({
  items,
  onMenu,
  label,
}: {
  items: FlowItem[];
  onMenu?: (id: string, x: number, y: number) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const placed = useRef('');
  const limits = useRef<{ minY: number; maxY: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [extent, setExtent] = useState<[[number, number], [number, number]]>([
    [-1e6, -1e6],
    [1e6, 1e6],
  ]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const flow = useReactFlow();
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const signature = useMemo(
    () => items.map((n) => `${n.id}:${n.parentId ?? ''}:${n.title}:${n.color}`).join('|'),
    [items],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size.w < 40 || size.h < 40 || placed.current === signature) return;
    placed.current = signature;
    const { nodes: next, edges: nextEdges, pos } = arrange(items, size.w, size.h);
    const saved = readLayout(label);
    for (const node of next) {
      const point = saved[node.id];
      if (!point) continue;
      node.position = point;
      pos.set(node.id, point);
    }
    const ys = [...pos.values()].map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + NH;
    limits.current = { minY, maxY };
    setExtent([
      [-1e6, minY],
      [1e6, maxY],
    ]);
    setNodes(next);
    setEdges(nextEdges);
    const minX = Math.min(...[...pos.values()].map((p) => p.x));
    const maxX = Math.max(...[...pos.values()].map((p) => p.x)) + NW;
    const zoom = Math.min((size.w - 24) / Math.max(maxX - minX, 1), 1);
    void flowRef.current.setViewport({ x: 8 - minX * zoom, y: 8, zoom });
  }, [signature, items, size.w, size.h, setEdges, setNodes]);

  const clampY = (y: number, zoom: number) => {
    const limit = limits.current;
    const el = box.current;
    if (!limit || !el) return y;
    const top = 8 - limit.minY * zoom;
    const bottom = el.clientHeight - 8 - limit.maxY * zoom;
    if (bottom > top) return top;
    return Math.min(top, Math.max(bottom, y));
  };

  const onNodeDragStop: OnNodeDrag<CardNode> = (_, node) => {
    const saved = readLayout(label);
    saved[node.id] = { x: node.position.x, y: node.position.y };
    writeLayout(label, saved);
    const limit = limits.current;
    if (!limit) return;
    const minY = Math.min(limit.minY, node.position.y);
    const maxY = Math.max(limit.maxY, node.position.y + NH);
    limits.current = { minY, maxY };
    setExtent([
      [-1e6, minY],
      [1e6, maxY],
    ]);
  };

  const onMove = (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
    const y = clampY(viewport.y, viewport.zoom);
    if (Math.abs(y - viewport.y) > 0.5) void flowRef.current.setViewport({ ...viewport, y });
  };

  return (
    <div ref={box} className="org-flow h-full min-h-0 w-full bg-black" aria-label={label}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onMove={onMove}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          onMenu?.(node.id, event.clientX, event.clientY);
        }}
        onPaneClick={() => onMenu?.('', -1, -1)}
        nodesConnectable={false}
        forceColorMode="dark"
        panOnScroll
        zoomOnScroll={false}
        panOnScrollMode={PanOnScrollMode.Vertical}
        translateExtent={extent}
        nodeExtent={[
          [extent[0][0], extent[0][1]],
          [extent[1][0], extent[1][1] - NH],
        ]}
        minZoom={0.15}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        style={{ width: '100%', height: '100%', background: '#000000' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          bgColor="#000000"
          color="#3f3f46"
          gap={22}
          size={1.5}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function TreeFlow({
  nodes,
  onMenu,
  label,
}: {
  nodes: FlowItem[];
  onMenu?: (id: string, x: number, y: number) => void;
  label: string;
}) {
  return (
    <ReactFlowProvider>
      <Canvas items={nodes} onMenu={onMenu} label={label} />
    </ReactFlowProvider>
  );
}
