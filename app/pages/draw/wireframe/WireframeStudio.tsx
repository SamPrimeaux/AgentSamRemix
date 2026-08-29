/**
 * WireframeStudio — Figma-like lo-fi UI canvas (Draw engine companion to Excalidraw).
 * Design ref: app/dashboard/design-refs/wireframe_canvas_editor.html
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2,
  Square,
  RectangleHorizontal,
  Type,
  Minus,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  LayoutTemplate,
  Image as ImageIcon,
  Trash2,
  PanelTop,
  PanelBottom,
  PanelLeft,
  CreditCard,
  AlignLeft,
  List,
  FormInput,
  CheckSquare,
  ToggleLeft,
  ChevronDown,
  Tag,
  Table2,
  BarChart3,
} from 'lucide-react';
import './wireframe-studio.css';

export type WfCompType =
  | 'navbar'
  | 'hero'
  | 'footer'
  | 'sidebar'
  | 'card'
  | 'image'
  | 'text-block'
  | 'list'
  | 'button'
  | 'input'
  | 'checkbox'
  | 'toggle'
  | 'dropdown'
  | 'badge'
  | 'table'
  | 'chart'
  | 'rect'
  | 'text'
  | 'frame'
  | 'line';

export type WfElement = {
  id: string;
  type: WfCompType;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  opacity: number;
  radius: number;
  label: string;
};

export type WfTool = 'select' | 'frame' | 'rect' | 'text' | 'line';
type Tool = WfTool;
type Fidelity = 'lo' | 'med' | 'hi';

const COMP_DEFAULTS: Record<string, Partial<WfElement> & { w: number; h: number }> = {
  navbar: { w: 520, h: 40, fill: '#f8f8f8', stroke: '#e0e0e0', label: 'Navbar' },
  hero: { w: 520, h: 160, fill: '#f5f5f5', stroke: '#e0e0e0', label: 'Hero' },
  footer: { w: 520, h: 60, fill: '#f0f0f0', stroke: '#e0e0e0', label: 'Footer' },
  sidebar: { w: 180, h: 300, fill: '#f5f5f5', stroke: '#e0e0e0', label: 'Sidebar' },
  card: { w: 160, h: 120, fill: '#ffffff', stroke: '#e0e0e0', label: 'Card', radius: 8 },
  image: { w: 140, h: 100, fill: '#e0e0e0', stroke: '#cccccc', label: 'Image' },
  'text-block': { w: 200, h: 60, fill: 'transparent', stroke: 'none', label: 'Text block' },
  list: { w: 180, h: 120, fill: 'transparent', stroke: 'none', label: 'List' },
  button: { w: 100, h: 36, fill: '#222222', stroke: 'none', label: 'Button', radius: 6 },
  input: { w: 200, h: 36, fill: '#ffffff', stroke: '#cccccc', label: 'Input', radius: 6 },
  checkbox: { w: 120, h: 24, fill: 'transparent', stroke: 'none', label: 'Checkbox' },
  toggle: { w: 80, h: 28, fill: 'transparent', stroke: 'none', label: 'Toggle' },
  dropdown: { w: 160, h: 36, fill: '#ffffff', stroke: '#cccccc', label: 'Dropdown', radius: 6 },
  badge: { w: 70, h: 24, fill: '#e8e8e8', stroke: 'none', label: 'Badge', radius: 12 },
  table: { w: 280, h: 180, fill: '#ffffff', stroke: '#e0e0e0', label: 'Table' },
  chart: { w: 240, h: 160, fill: '#f8f8f8', stroke: '#e0e0e0', label: 'Chart' },
};

const PALETTE: {
  section: string;
  items: { type: WfCompType; label: string; Icon: React.ElementType }[];
}[] = [
  {
    section: 'Layout',
    items: [
      { type: 'navbar', label: 'Navbar', Icon: PanelTop },
      { type: 'hero', label: 'Hero', Icon: LayoutTemplate },
      { type: 'footer', label: 'Footer', Icon: PanelBottom },
      { type: 'sidebar', label: 'Sidebar', Icon: PanelLeft },
    ],
  },
  {
    section: 'Content',
    items: [
      { type: 'card', label: 'Card', Icon: CreditCard },
      { type: 'image', label: 'Image', Icon: ImageIcon },
      { type: 'text-block', label: 'Text block', Icon: AlignLeft },
      { type: 'list', label: 'List', Icon: List },
    ],
  },
  {
    section: 'Controls',
    items: [
      { type: 'button', label: 'Button', Icon: Square },
      { type: 'input', label: 'Input', Icon: FormInput },
      { type: 'checkbox', label: 'Checkbox', Icon: CheckSquare },
      { type: 'toggle', label: 'Toggle', Icon: ToggleLeft },
      { type: 'dropdown', label: 'Dropdown', Icon: ChevronDown },
      { type: 'badge', label: 'Badge', Icon: Tag },
    ],
  },
  {
    section: 'Data',
    items: [
      { type: 'table', label: 'Table', Icon: Table2 },
      { type: 'chart', label: 'Chart', Icon: BarChart3 },
    ],
  },
];

const FILLS = ['#ffffff', '#f5f5f5', '#e0e0e0', '#c0c0c0', '#333333', 'transparent'];
const STROKES = ['#cccccc', '#999999', '#333333', 'none'];

function nextId(n: number) {
  return `el-${n}`;
}

function ElementPreview({ el }: { el: WfElement }) {
  const sketch = { fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#888' } as const;
  switch (el.type) {
    case 'navbar':
      return (
        <div style={{ ...sketch, display: 'flex', alignItems: 'center', height: '100%', padding: '0 12px', gap: 12 }}>
          <div style={{ width: 20, height: 14, background: '#ccc', borderRadius: 2 }} />
          <div style={{ flex: 1, display: 'flex', gap: 12 }}>
            {['Link 1', 'Link 2', 'Link 3'].map((l) => (
              <span key={l} style={{ color: '#666', fontSize: 10 }}>{l}</span>
            ))}
          </div>
          <div style={{ background: '#333', color: '#fff', padding: '3px 8px', borderRadius: 3, fontSize: 10 }}>Button</div>
        </div>
      );
    case 'hero':
      return (
        <div style={{ ...sketch, padding: 16, display: 'flex', gap: 10, height: '100%', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 4 }}>Main Header</div>
            <div style={{ fontSize: 10, color: '#888', marginBottom: 8, lineHeight: 1.4 }}>Supporting subheader text goes here.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ background: '#222', color: '#fff', padding: '4px 10px', borderRadius: 3, fontSize: 10 }}>Primary</div>
              <div style={{ border: '1px solid #ccc', padding: '4px 10px', borderRadius: 3, fontSize: 10, color: '#555' }}>Secondary</div>
            </div>
          </div>
          <div style={{ width: 100, height: 80, background: '#ddd', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ImageIcon size={20} color="#bbb" />
          </div>
        </div>
      );
    case 'card':
      return (
        <div style={{ ...sketch, padding: 10, height: '100%' }}>
          <div style={{ background: '#e8e8e8', height: 50, borderRadius: 3, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={16} color="#bbb" />
          </div>
          <div style={{ height: 8, background: '#e0e0e0', borderRadius: 2, marginBottom: 4 }} />
          <div style={{ height: 7, background: '#ebebeb', borderRadius: 2, width: '70%' }} />
        </div>
      );
    case 'image':
      return (
        <div style={{ width: '100%', height: '100%', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
          <ImageIcon size={22} color="#bbb" />
          <span style={{ fontSize: 10, color: '#bbb' }}>Image</span>
        </div>
      );
    case 'button':
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: el.fill === '#ffffff' || el.fill === 'transparent' ? '#333' : '#fff' }}>
          {el.label}
        </div>
      );
    case 'input':
      return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 11, color: '#aaa' }}>{el.label}…</div>;
    case 'table':
      return (
        <div style={{ ...sketch, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#f0f0f0', borderBottom: '1px solid #ddd' }}>
            {['Col A', 'Col B', 'Col C'].map((c) => (
              <div key={c} style={{ padding: '5px 8px', fontSize: 10, fontWeight: 600, color: '#555' }}>{c}</div>
            ))}
          </div>
          {[1, 2, 3, 4].map((r) => (
            <div key={r} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #eee' }}>
              {[0, 1, 2].map((c) => (
                <div key={c} style={{ padding: '4px 8px' }}><div style={{ height: 7, background: '#eee', borderRadius: 2 }} /></div>
              ))}
            </div>
          ))}
        </div>
      );
    case 'chart':
      return (
        <div style={{ ...sketch, padding: 10, height: '100%' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#555', marginBottom: 6 }}>Chart</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 'calc(100% - 30px)' }}>
            {[60, 85, 45, 90, 70, 55].map((h, i) => (
              <div key={i} style={{ flex: 1, background: '#d0d0d0', borderRadius: '2px 2px 0 0', height: `${h}%` }} />
            ))}
          </div>
        </div>
      );
    case 'text-block':
      return (
        <div style={{ ...sketch, padding: 4 }}>
          {[100, 90, 100, 75, 85, 60].map((w, i) => (
            <div key={i} style={{ height: 7, background: '#e0e0e0', borderRadius: 2, marginBottom: 4, width: `${w}%` }} />
          ))}
        </div>
      );
    case 'footer':
      return (
        <div style={{ ...sketch, display: 'flex', alignItems: 'center', height: '100%', padding: '0 12px', gap: 16 }}>
          <div style={{ width: 20, height: 14, background: '#bbb', borderRadius: 2 }} />
          {['Link', 'Link', 'Link'].map((l, i) => (
            <span key={i} style={{ fontSize: 10, color: '#888' }}>{l}</span>
          ))}
        </div>
      );
    case 'sidebar':
      return (
        <div style={{ ...sketch, padding: 10, height: '100%' }}>
          {['Menu item', 'Menu item', 'Menu item', 'Menu item'].map((m, i) => (
            <div key={i} style={{ padding: '6px 8px', borderRadius: 4, marginBottom: 2, background: i === 0 ? '#e8e8e8' : 'transparent', fontSize: 11, color: i === 0 ? '#333' : '#777' }}>{m}</div>
          ))}
        </div>
      );
    case 'badge':
      return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#666', fontWeight: 500 }}>Label</div>;
    case 'checkbox':
      return (
        <div style={{ ...sketch, display: 'flex', alignItems: 'center', gap: 6, padding: 4 }}>
          <div style={{ width: 14, height: 14, border: '1.5px solid #ccc', borderRadius: 3, flexShrink: 0 }} />
          <div style={{ height: 7, background: '#e0e0e0', borderRadius: 2, flex: 1 }} />
        </div>
      );
    case 'toggle':
      return (
        <div style={{ ...sketch, display: 'flex', alignItems: 'center', gap: 8, padding: 4, height: '100%' }}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: '#d0d0d0', position: 'relative' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: 3 }} />
          </div>
        </div>
      );
    case 'dropdown':
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', fontSize: 11, color: '#aaa' }}>
          <span>Select…</span>
          <ChevronDown size={12} />
        </div>
      );
    case 'list':
      return (
        <div style={{ ...sketch, padding: 6 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ccc', flexShrink: 0 }} />
              <div style={{ height: 7, background: '#e8e8e8', borderRadius: 2, flex: 1 }} />
            </div>
          ))}
        </div>
      );
    case 'text':
      return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '4px 8px', fontSize: 12, color: '#666' }}>Text…</div>;
    case 'line':
      return <div style={{ width: '100%', height: 2, background: '#ccc', position: 'absolute', top: '50%', transform: 'translateY(-50%)' }} />;
    default:
      return null;
  }
}

function mkEl(n: number, type: WfCompType, x: number, y: number): WfElement {
  const d = COMP_DEFAULTS[type] || { w: 120, h: 60, fill: '#fff', stroke: '#ccc', label: type };
  return {
    id: nextId(n),
    type,
    x: x - d.w / 2,
    y: y - d.h / 2,
    w: d.w,
    h: d.h,
    fill: d.fill ?? '#fff',
    stroke: d.stroke ?? '#ccc',
    opacity: 1,
    radius: d.radius ?? 0,
    label: d.label ?? type,
  };
}

function buildLanding(): WfElement[] {
  return [
    mkEl(1, 'navbar', 260, 40),
    mkEl(2, 'hero', 260, 140),
    mkEl(3, 'card', 120, 310),
    mkEl(4, 'card', 260, 310),
    mkEl(5, 'card', 400, 310),
    mkEl(6, 'footer', 260, 450),
  ];
}

export type WireframeStudioHandle = {
  getElements: () => WfElement[];
  setElements: (els: WfElement[]) => void;
  loadTemplate: (kind: 'landing' | 'dashboard') => void;
  addComponent: (type: WfCompType, x: number, y: number) => void;
  setTool: (tool: WfTool) => void;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
};

export type WireframeStudioProps = {
  /** When true, only render canvas (Sketch shell provides chrome). */
  embedMode?: boolean;
  /** Visual mode for grid styling. */
  studioMode?: 'sketch' | 'layout' | 'blueprint';
  initialElements?: WfElement[];
};

export const WireframeStudio = React.forwardRef<WireframeStudioHandle, WireframeStudioProps>(
  function WireframeStudio({ embedMode = false, studioMode = 'layout', initialElements }, ref) {
  const [tool, setTool] = useState<Tool>('select');
  const [fidelity, setFidelity] = useState<Fidelity>('lo');
  const [leftTab, setLeftTab] = useState<'components' | 'layers'>('components');
  const [rightTab, setRightTab] = useState<'format' | 'layout'>('format');
  const [elements, setElements] = useState<WfElement[]>(() => initialElements ?? buildLanding());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const idCounter = useRef(20);
  const history = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const dragComp = useRef<WfCompType | null>(null);
  const dragMove = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const drawStart = useRef<{ x: number; y: number; id: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

  const pushHistory = useCallback((els: WfElement[]) => {
    history.current.push(JSON.stringify(els));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
  }, []);

  const addComponent = useCallback(
    (type: WfCompType, x: number, y: number) => {
      const el = mkEl(idCounter.current++, type, x, y);
      setElements((prev) => {
        const next = [...prev, el];
        pushHistory(next);
        return next;
      });
      setSelectedId(el.id);
      setTool('select');
    },
    [pushHistory],
  );

  const canvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const scale = zoom / 100;
      return { x: (clientX - rect.left - 20) / scale, y: (clientY - rect.top - 20) / scale };
    },
    [zoom],
  );

  const undo = useCallback(() => {
    if (!history.current.length) return;
    future.current.push(JSON.stringify(elementsRef.current));
    setElements(JSON.parse(history.current.pop()!) as WfElement[]);
    setSelectedId(null);
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    history.current.push(JSON.stringify(elementsRef.current));
    setElements(JSON.parse(future.current.pop()!) as WfElement[]);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        setTool('select');
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.activeElement === document.body) {
        setElements((prev) => {
          const next = prev.filter((x) => x.id !== selectedId);
          pushHistory(next);
          return next;
        });
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedId, pushHistory]);

  const patchSelected = (patch: Partial<WfElement>) => {
    if (!selectedId) return;
    setElements((prev) => prev.map((el) => (el.id === selectedId ? { ...el, ...patch } : el)));
  };

  const loadTemplate = useCallback((kind: 'landing' | 'dashboard') => {
    pushHistory(elementsRef.current);
    if (kind === 'landing') {
      idCounter.current = 10;
      setElements(buildLanding());
    } else {
      setElements([
        mkEl(1, 'sidebar', 100, 300),
        mkEl(2, 'navbar', 330, 40),
        mkEl(3, 'chart', 330, 140),
        mkEl(4, 'table', 330, 340),
      ]);
      idCounter.current = 10;
    }
    setSelectedId(null);
  }, [pushHistory]);

  const clearCanvas = useCallback(() => {
    pushHistory(elementsRef.current);
    setElements([]);
    setSelectedId(null);
  }, [pushHistory]);

  React.useImperativeHandle(
    ref,
    () => ({
      getElements: () => elementsRef.current,
      setElements: (els: WfElement[]) => {
        pushHistory(elementsRef.current);
        setElements(els);
        setSelectedId(null);
      },
      loadTemplate,
      addComponent,
      setTool,
      getZoom: () => zoom,
      zoomIn: () => setZoom((z) => Math.min(200, z + 10)),
      zoomOut: () => setZoom((z) => Math.max(25, z - 10)),
      undo,
      redo,
      clear: clearCanvas,
    }),
    [addComponent, clearCanvas, loadTemplate, pushHistory, redo, undo, setTool, zoom],
  );

  const canvasBlock = (
    <div
      ref={canvasRef}
      className={`wf-studio__canvas-wrap wf-studio__canvas-wrap--${studioMode}`}
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!dragComp.current) return;
        const p = canvasPoint(e.clientX, e.clientY);
        addComponent(dragComp.current, p.x, p.y);
        dragComp.current = null;
      }}
      onMouseMove={(e) => {
        const p = canvasPoint(e.clientX, e.clientY);
        setCursor({ x: Math.round(p.x), y: Math.round(p.y) });
        if (drawStart.current) {
          const { id, x, y } = drawStart.current;
          setElements((prev) => prev.map((el) => (el.id === id ? { ...el, w: Math.max(10, p.x - x), h: Math.max(10, p.y - y) } : el)));
        }
        if (dragMove.current) {
          const { id, ox, oy } = dragMove.current;
          setElements((prev) => prev.map((el) => (el.id === id ? { ...el, x: p.x - ox, y: p.y - oy } : el)));
        }
      }}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t !== canvasRef.current && !t.classList.contains('wf-studio__grid') && !t.classList.contains('wf-studio__canvas-content')) return;
        if (tool === 'select') {
          setSelectedId(null);
          return;
        }
        const p = canvasPoint(e.clientX, e.clientY);
        const id = nextId(idCounter.current++);
        const el: WfElement = {
          id,
          type: tool === 'text' ? 'text' : tool === 'line' ? 'line' : tool === 'frame' ? 'frame' : 'rect',
          x: p.x,
          y: p.y,
          w: 2,
          h: 2,
          fill: studioMode === 'blueprint' ? '#0f172a' : '#ffffff',
          stroke: studioMode === 'blueprint' ? '#38bdf8' : '#cccccc',
          opacity: 1,
          radius: tool === 'rect' ? 4 : 0,
          label: tool,
        };
        drawStart.current = { x: p.x, y: p.y, id };
        setElements((prev) => [...prev, el]);
        setSelectedId(id);
      }}
      onMouseUp={() => {
        if (drawStart.current) {
          pushHistory(elementsRef.current);
          drawStart.current = null;
          setTool('select');
        }
        if (dragMove.current) {
          pushHistory(elementsRef.current);
          dragMove.current = null;
        }
      }}
    >
      <div className="wf-studio__grid" />
      {studioMode === 'blueprint' ? <div className="wf-studio__rulers" aria-hidden /> : null}
      <div className="wf-studio__canvas-content" style={{ transform: `scale(${zoom / 100})` }}>
        {elements.map((el) => (
          <div
            key={el.id}
            className={`wf-studio__el${el.id === selectedId ? ' is-selected' : ''}`}
            style={{
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              background: el.fill === 'transparent' ? 'transparent' : el.fill,
              border: el.stroke === 'none' ? 'none' : `1px solid ${el.stroke}`,
              borderRadius: el.radius,
              opacity: el.opacity,
            }}
            onMouseDown={(ev) => {
              if (tool !== 'select') return;
              ev.stopPropagation();
              setSelectedId(el.id);
              const p = canvasPoint(ev.clientX, ev.clientY);
              dragMove.current = { id: el.id, ox: p.x - el.x, oy: p.y - el.y };
            }}
          >
            {studioMode === 'blueprint' && el.label ? (
              <span className="wf-studio__dim-label">{el.label}</span>
            ) : null}
            <ElementPreview el={el} />
          </div>
        ))}
      </div>
      <div className="wf-studio__status">
        <span>{cursor.x}, {cursor.y}</span>
        <span>{selected ? `${Math.round(selected.w)} × ${Math.round(selected.h)}` : '—'}</span>
        <span style={{ marginLeft: 'auto' }}>{elements.length} layer{elements.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );

  if (embedMode) {
    return (
      <div className={`wf-studio wf-studio--embed wf-studio--mode-${studioMode}`} role="application" aria-label="Sketch canvas">
        {canvasBlock}
      </div>
    );
  }

  return (
    <div className="wf-studio" role="application" aria-label="Wireframe studio">
      <div className="wf-studio__topbar">
        <span className="wf-studio__logo">Sketch</span>
        {(
          [
            ['select', MousePointer2],
            ['frame', Square],
            ['rect', RectangleHorizontal],
            ['text', Type],
            ['line', Minus],
          ] as const
        ).map(([t, Icon]) => (
          <button key={t} type="button" className={`wf-studio__tb-btn${tool === t ? ' is-active' : ''}`} onClick={() => setTool(t)} title={t}>
            <Icon size={14} />
          </button>
        ))}
        <div className="wf-studio__sep" />
        <button type="button" className="wf-studio__tb-btn" onClick={undo} title="Undo"><Undo2 size={14} /></button>
        <button type="button" className="wf-studio__tb-btn" onClick={redo} title="Redo"><Redo2 size={14} /></button>
        <div className="wf-studio__right">
          <div className="wf-studio__zoom">
            <button type="button" className="wf-studio__tb-btn" onClick={() => setZoom((z) => Math.max(25, z - 10))}><ZoomOut size={12} /></button>
            <span style={{ width: 34, textAlign: 'center' }}>{zoom}%</span>
            <button type="button" className="wf-studio__tb-btn" onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn size={12} /></button>
          </div>
        </div>
      </div>

      <aside className="wf-studio__sidebar wf-studio__sidebar--l">
        <div className="wf-studio__tabs">
          <button type="button" className={`wf-studio__tab${leftTab === 'components' ? ' is-active' : ''}`} onClick={() => setLeftTab('components')}>Components</button>
          <button type="button" className={`wf-studio__tab${leftTab === 'layers' ? ' is-active' : ''}`} onClick={() => setLeftTab('layers')}>Layers</button>
        </div>
        <div className="wf-studio__panel">
          {leftTab === 'components' ? (
            <>
              <div className="wf-studio__fidelity">
                {(['lo', 'med', 'hi'] as const).map((f) => (
                  <button key={f} type="button" className={fidelity === f ? 'is-active' : ''} onClick={() => setFidelity(f)}>
                    {f === 'lo' ? 'Lo-fi' : f === 'med' ? 'Med-fi' : 'Hi-fi'}
                  </button>
                ))}
              </div>
              {PALETTE.map((sec) => (
                <div key={sec.section}>
                  <div className="wf-studio__section">{sec.section}</div>
                  <div className="wf-studio__comp-grid">
                    {sec.items.map(({ type, label, Icon }) => (
                      <div key={type} className="wf-studio__comp" draggable onDragStart={() => { dragComp.current = type; }}>
                        <Icon size={16} />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            [...elements].reverse().map((el) => (
              <button key={el.id} type="button" className={`wf-studio__layer${el.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(el.id)}>
                <MousePointer2 size={12} />
                <span style={{ flex: 1 }}>{el.label || el.type}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {canvasBlock}

      <aside className="wf-studio__sidebar wf-studio__sidebar--r">
        <div className="wf-studio__tabs">
          <button type="button" className={`wf-studio__tab${rightTab === 'format' ? ' is-active' : ''}`} onClick={() => setRightTab('format')}>Format</button>
          <button type="button" className={`wf-studio__tab${rightTab === 'layout' ? ' is-active' : ''}`} onClick={() => setRightTab('layout')}>Layout</button>
        </div>
        <div className="wf-studio__panel">
          {rightTab === 'format' ? (
            <>
              <div className="wf-studio__prop-row">
                <div className="wf-studio__prop-label">Position</div>
                <div className="wf-studio__prop-2col">
                  <input className="wf-studio__input" value={selected ? Math.round(selected.x) : ''} placeholder="X" onChange={(e) => patchSelected({ x: Number(e.target.value) || 0 })} />
                  <input className="wf-studio__input" value={selected ? Math.round(selected.y) : ''} placeholder="Y" onChange={(e) => patchSelected({ y: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="wf-studio__prop-row">
                <div className="wf-studio__prop-label">Size</div>
                <div className="wf-studio__prop-2col">
                  <input className="wf-studio__input" value={selected ? Math.round(selected.w) : ''} placeholder="W" onChange={(e) => patchSelected({ w: Math.max(10, Number(e.target.value) || 10) })} />
                  <input className="wf-studio__input" value={selected ? Math.round(selected.h) : ''} placeholder="H" onChange={(e) => patchSelected({ h: Math.max(10, Number(e.target.value) || 10) })} />
                </div>
              </div>
              <div className="wf-studio__prop-row">
                <div className="wf-studio__prop-label">Fill</div>
                <div className="wf-studio__swatches">
                  {FILLS.map((c) => (
                    <button key={c} type="button" className={`wf-studio__swatch${selected?.fill === c ? ' is-active' : ''}`} style={{ background: c === 'transparent' ? undefined : c, backgroundImage: c === 'transparent' ? 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)' : undefined, backgroundSize: c === 'transparent' ? '6px 6px' : undefined }} onClick={() => patchSelected({ fill: c })} />
                  ))}
                </div>
              </div>
              <div className="wf-studio__prop-row">
                <div className="wf-studio__prop-label">Stroke</div>
                <div className="wf-studio__swatches">
                  {STROKES.map((c) => (
                    <button key={c} type="button" className={`wf-studio__swatch${selected?.stroke === c ? ' is-active' : ''}`} style={{ background: c === 'none' ? undefined : c, backgroundImage: c === 'none' ? 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)' : undefined, backgroundSize: c === 'none' ? '6px 6px' : undefined }} onClick={() => patchSelected({ stroke: c })} />
                  ))}
                </div>
              </div>
              <button type="button" className="wf-studio__tb-btn wf-studio__ghost-btn" disabled={!selectedId} onClick={() => { if (!selectedId) return; setElements((prev) => { const next = prev.filter((x) => x.id !== selectedId); pushHistory(next); return next; }); setSelectedId(null); }}>
                <Trash2 size={12} /> Delete element
              </button>
            </>
          ) : (
            <>
              <button type="button" className="wf-studio__tb-btn wf-studio__ghost-btn" onClick={() => loadTemplate('landing')}><LayoutTemplate size={12} /> Load landing template</button>
              <button type="button" className="wf-studio__tb-btn wf-studio__ghost-btn" onClick={() => loadTemplate('dashboard')}><LayoutTemplate size={12} /> Load dashboard template</button>
              <button type="button" className="wf-studio__tb-btn wf-studio__ghost-btn" onClick={() => { pushHistory(elementsRef.current); setElements([]); setSelectedId(null); }}><Trash2 size={12} /> Clear canvas</button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
});

export default WireframeStudio;
