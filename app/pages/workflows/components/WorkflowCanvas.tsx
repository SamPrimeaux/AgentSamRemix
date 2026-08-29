import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Maximize2, Play, ZoomIn, ZoomOut } from 'lucide-react';
import type { WorkflowGraph } from '../workflowTypes';
import { resolveInitialPositions } from '../lib/workflowLayout';
import { WorkflowNode, type NodeStatus } from './WorkflowNode';

const NW = 202;
const NH = 82;

export type WorkflowCanvasProps = {
  graph: WorkflowGraph | null;
  graphLoading: boolean;
  selectedNodeKey: string | null;
  onSelectNode: (key: string | null) => void;
  connectFrom: string | null;
  onSavePositions: (positions: Record<string, { x: number; y: number }>) => Promise<void>;
  externalStatuses?: Record<string, NodeStatus>;
  externalActiveEdges?: Set<string>;
  liveRunning?: boolean;
  traceMode?: boolean;
  onOpenLibrary?: () => void;
};

type NodePos = { x: number; y: number };
type Drag =
  | { kind: 'node'; id: string; ox: number; oy: number }
  | { kind: 'pan'; sx: number; sy: number };

function edgePath(src: NodePos, tgt: NodePos): string {
  const sx = src.x + NW;
  const sy = src.y + NH / 2;
  const tx = tgt.x;
  const ty = tgt.y + NH / 2;
  const cx = (sx + tx) / 2;
  return `M${sx},${sy} C${cx},${sy} ${cx},${ty} ${tx},${ty}`;
}

export function WorkflowCanvas({
  graph,
  graphLoading,
  selectedNodeKey,
  onSelectNode,
  connectFrom,
  onSavePositions,
  externalStatuses,
  externalActiveEdges,
  liveRunning = false,
  traceMode = false,
  onOpenLibrary,
}: WorkflowCanvasProps) {
  const [nodePos, setNodePos] = useState<Record<string, NodePos>>({});
  const [pan, setPan] = useState({ x: 48, y: 48 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [localStatuses, setLocalStatuses] = useState<Record<string, NodeStatus>>({});
  const [localActiveEdges, setLocalActiveEdges] = useState<Set<string>>(new Set());

  const canvasRef = useRef<HTMLDivElement>(null);
  const simGen = useRef(0);
  const layoutDirty = useRef(false);

  const displayStatuses = externalStatuses ?? localStatuses;
  const displayActiveEdges = externalActiveEdges ?? localActiveEdges;
  const running = liveRunning || previewRunning;

  useEffect(() => {
    if (!graph) {
      setNodePos({});
      return;
    }
    const pos = resolveInitialPositions(graph.nodes, graph.edges);
    graph.nodes.forEach((n) => {
      const p = pos[n.node_key];
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    });
    setNodePos(pos);
    layoutDirty.current = false;
  }, [graph?.registryId, graph?.nodes.length]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(2.5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (cx - r.left) / zoom - pan.x, y: (cy - r.top) / zoom - pan.y };
    },
    [zoom, pan],
  );

  const persistLayout = useCallback(async () => {
    if (!graph || !layoutDirty.current) return;
    setSaveBusy(true);
    try {
      const positions: Record<string, { x: number; y: number }> = {};
      graph.nodes.forEach((n) => {
        const p = nodePos[n.node_key];
        if (p) positions[n.node_key] = { x: Math.round(p.x), y: Math.round(p.y) };
      });
      await onSavePositions(positions);
      layoutDirty.current = false;
    } finally {
      setSaveBusy(false);
    }
  }, [graph, nodePos, onSavePositions]);

  const onNodeDown = useCallback(
    (e: React.MouseEvent, nid: string) => {
      e.stopPropagation();
      onSelectNode(nid);
      const w = toWorld(e.clientX, e.clientY);
      const p = nodePos[nid] ?? { x: 0, y: 0 };
      setDrag({ kind: 'node', id: nid, ox: w.x - p.x, oy: w.y - p.y });
    },
    [toWorld, nodePos, onSelectNode],
  );

  const onCanvasDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).dataset?.canvasBg === '1') onSelectNode(null);
      setDrag({ kind: 'pan', sx: e.clientX - pan.x, sy: e.clientY - pan.y });
    },
    [pan, onSelectNode],
  );

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drag) return;
      if (drag.kind === 'node') {
        const w = toWorld(e.clientX, e.clientY);
        layoutDirty.current = true;
        setNodePos((p) => ({
          ...p,
          [drag.id]: { x: w.x - drag.ox, y: w.y - drag.oy },
        }));
      } else {
        setPan({ x: e.clientX - drag.sx, y: e.clientY - drag.sy });
      }
    },
    [drag, toWorld],
  );

  const onUp = useCallback(() => {
    if (drag?.kind === 'node') void persistLayout();
    setDrag(null);
  }, [drag, persistLayout]);

  const runPreviewTrace = useCallback(async () => {
    if (!graph?.nodes.length || running) return;
    const order = graph.executionOrder.length
      ? graph.executionOrder
      : graph.nodes.map((n) => n.node_key);
    const gen = ++simGen.current;
    setPreviewRunning(true);
    setLocalStatuses({});
    setLocalActiveEdges(new Set());
    for (const nid of order) {
      if (simGen.current !== gen) return;
      setLocalStatuses((p) => ({ ...p, [nid]: 'running' }));
      const inc = graph.edges.filter((e) => e.to === nid).map((e) => e.id);
      setLocalActiveEdges((p) => {
        const s = new Set(p);
        inc.forEach((id) => s.add(id));
        return s;
      });
      await new Promise<void>((r) => setTimeout(r, 650));
      if (simGen.current !== gen) return;
      setLocalStatuses((p) => ({ ...p, [nid]: 'completed' }));
    }
    setPreviewRunning(false);
  }, [graph, running]);

  const gs = 24 * zoom;

  return (
    <div className="wf-canvas-wrap" ref={canvasRef} data-canvas-bg="1" onMouseDown={onCanvasDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
      {graphLoading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--wf-canvas) 75%, transparent)' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--wf-accent)' }} />
        </div>
      )}

      {!graphLoading && !graph && (
        <div className="wf-canvas-empty">
          <p className="wf-canvas-empty-title">Workflow Studio</p>
          <p className="wf-empty" style={{ maxWidth: 300 }}>
            Pick a workflow from the Library to inspect or edit. Platform spines like{' '}
            <code>agent_chat_plan</code> are advanced — start with a simpler automation or create new.
          </p>
          <button type="button" className="wf-btn primary" style={{ marginTop: 12 }} onClick={onOpenLibrary}>
            Open Library
          </button>
        </div>
      )}

      {!graphLoading && graph && !graph.nodes.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--wf-muted)', gap: 8 }}>
          <p style={{ fontSize: 13 }}>No nodes in this workflow</p>
          <p className="wf-empty" style={{ maxWidth: 280, textAlign: 'center' }}>
            Open Workflow Blocks to add stages, or pick a workflow from the library.
          </p>
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <div className="wf-canvas-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" style={{ width: 3200, height: 2200 }}>
            <defs>
              <marker id="wf-arr" markerWidth="7" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 Z" fill="var(--wf-border)" />
              </marker>
              <marker id="wf-arr-active" markerWidth="7" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 Z" fill="var(--wf-accent)" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const src = nodePos[edge.from];
              const tgt = nodePos[edge.to];
              if (!src || !tgt) return null;
              const d = edgePath(src, tgt);
              const on = displayActiveEdges.has(edge.id);
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={on ? 'var(--wf-accent)' : 'var(--wf-border)'}
                    strokeWidth={on ? 2.5 : 1.75}
                    markerEnd={on ? 'url(#wf-arr-active)' : 'url(#wf-arr)'}
                  />
                  {on && (
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--wf-accent)"
                      strokeWidth={2}
                      strokeDasharray="8 6"
                      className="animate-pulse"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const p = nodePos[node.node_key] ?? { x: node.x, y: node.y };
            const n = { ...node, x: p.x, y: p.y };
            return (
              <WorkflowNode
                key={node.node_key}
                node={n}
                status={displayStatuses[node.node_key] ?? 'idle'}
                selected={selectedNodeKey === node.node_key}
                connectSource={connectFrom === node.node_key}
                onMouseDown={(e) => onNodeDown(e, node.node_key)}
              />
            );
          })}
        </div>
      )}

      <div className="wf-floating-controls">
        {saveBusy && (
          <span style={{ fontSize: 10, color: 'var(--wf-accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Loader2 size={10} className="animate-spin" /> Saving
          </span>
        )}
        <span style={{ fontFamily: 'var(--wf-font-mono)', fontSize: 10, color: 'var(--wf-muted)', padding: '0 4px' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="wf-btn icon" onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))} title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button type="button" className="wf-btn icon" onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          className="wf-btn icon"
          onClick={() => {
            setPan({ x: 48, y: 48 });
            setZoom(1);
          }}
          title="Reset view"
        >
          <Maximize2 size={14} />
        </button>
        {traceMode && (
          <button
            type="button"
            className="wf-btn"
            disabled={running || !graph?.nodes.length}
            onClick={() => void runPreviewTrace()}
          >
            <Play size={12} />
            Preview trace
          </button>
        )}
      </div>
    </div>
  );
}

export type { NodeStatus };
