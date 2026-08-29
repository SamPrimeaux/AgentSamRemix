/**
 * Sketch Studio shell — minimal toolbar, mode bar, saved templates.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Save,
  FolderOpen,
  Copy,
  Trash2,
  PenLine,
  LayoutTemplate,
  Ruler,
  Download,
  PanelLeft,
  X,
} from 'lucide-react';
import WireframeStudio, {
  type WireframeStudioHandle,
  type WfCompType,
  type WfTool,
} from '../draw/wireframe/WireframeStudio';
import {
  blueprintFloorPlanPreset,
  deleteSketchDocument,
  duplicateSketchDocument,
  listSketchDocuments,
  saveSketchDocument,
  type SketchDocument,
  type SketchStudioMode,
} from './sketchDocument';
import '../draw/wireframe/wireframe-studio.css';
import './sketch-studio.css';

const MODE_ITEMS: { id: SketchStudioMode; label: string; Icon: React.ElementType }[] = [
  { id: 'sketch', label: 'Sketch', Icon: PenLine },
  { id: 'layout', label: 'Layout', Icon: LayoutTemplate },
  { id: 'blueprint', label: 'Blueprint', Icon: Ruler },
];

const LAYOUT_PALETTE: { type: WfCompType; label: string }[] = [
  { type: 'navbar', label: 'Nav' },
  { type: 'hero', label: 'Hero' },
  { type: 'card', label: 'Card' },
  { type: 'button', label: 'Btn' },
  { type: 'input', label: 'Input' },
  { type: 'table', label: 'Table' },
];

export type SketchStudioShellProps = {
  initialMode?: SketchStudioMode;
  pendingLoad?: { elements?: unknown[]; mode?: SketchStudioMode; name?: string } | null;
  onBack?: () => void;
};

export function SketchStudioShell({
  initialMode = 'sketch',
  pendingLoad,
  onBack,
}: SketchStudioShellProps) {
  const canvasRef = useRef<WireframeStudioHandle>(null);
  const [mode, setMode] = useState<SketchStudioMode>(initialMode);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [docs, setDocs] = useState<SketchDocument[]>(() => listSketchDocuments());
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docName, setDocName] = useState('Untitled concept');
  const [activeTool, setActiveTool] = useState<WfTool>('select');
  const [zoomPct, setZoomPct] = useState(100);

  const refreshDocs = useCallback(() => setDocs(listSketchDocuments()), []);

  useEffect(() => {
    if (!pendingLoad?.elements?.length) return;
    canvasRef.current?.setElements(pendingLoad.elements as never);
    if (pendingLoad.mode) setMode(pendingLoad.mode);
    if (pendingLoad.name) setDocName(pendingLoad.name);
  }, [pendingLoad]);

  useEffect(() => {
    const syncZoom = window.setInterval(() => {
      const z = canvasRef.current?.getZoom();
      if (typeof z === 'number') setZoomPct(z);
    }, 120);
    return () => window.clearInterval(syncZoom);
  }, []);

  const pickTool = (tool: WfTool) => {
    canvasRef.current?.setTool(tool);
    setActiveTool(tool);
  };

  useEffect(() => {
    if (mode === 'blueprint' && canvasRef.current?.getElements().length === 0) {
      canvasRef.current?.setElements(blueprintFloorPlanPreset());
    }
  }, [mode]);

  const handleSave = () => {
    const elements = canvasRef.current?.getElements() ?? [];
    const saved = saveSketchDocument({
      id: activeDocId ?? undefined,
      name: docName,
      mode,
      elements,
      source: 'user',
    });
    setActiveDocId(saved.id);
    refreshDocs();
  };

  const handleLoadDoc = (doc: SketchDocument) => {
    canvasRef.current?.setElements(doc.elements);
    setMode(doc.mode);
    setDocName(doc.name);
    setActiveDocId(doc.id);
    setTemplatesOpen(false);
  };

  const handleDuplicate = (id: string) => {
    const copy = duplicateSketchDocument(id);
    if (copy) {
      refreshDocs();
      handleLoadDoc(copy);
    }
  };

  const handleExportJson = () => {
    const payload = {
      name: docName,
      mode,
      elements: canvasRef.current?.getElements() ?? [],
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docName.replace(/\s+/g, '-').toLowerCase()}.sketch.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`sketch-studio sketch-studio--${mode}`}>
      <div className="sketch-studio__float-toolbar" role="toolbar" aria-label="Sketch tools">
        <button type="button" className="sketch-studio__icon-btn" onClick={onBack} title="Back">
          ←
        </button>
        <span className="sketch-studio__doc-name">{docName}</span>
        <div className="sketch-studio__tool-group">
          {([
            ['select', MousePointer2, 'Select'],
            ['frame', Square, 'Frame'],
            ['rect', RectangleHorizontal, 'Rect'],
            ['text', Type, 'Text'],
            ['line', Minus, 'Line'],
          ] as const).map(([tool, Icon, label]) => (
            <button
              key={tool}
              type="button"
              className={`sketch-studio__icon-btn${activeTool === tool ? ' is-active' : ''}`}
              title={label}
              onClick={() => pickTool(tool)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div className="sketch-studio__tool-group">
          <button type="button" className="sketch-studio__icon-btn" onClick={() => canvasRef.current?.undo()} title="Undo"><Undo2 size={15} /></button>
          <button type="button" className="sketch-studio__icon-btn" onClick={() => canvasRef.current?.redo()} title="Redo"><Redo2 size={15} /></button>
        </div>
        <div className="sketch-studio__tool-group sketch-studio__tool-group--right">
          <button type="button" className="sketch-studio__icon-btn" onClick={() => setPaletteOpen((v) => !v)} title="Components"><PanelLeft size={15} /></button>
          <button type="button" className="sketch-studio__icon-btn" onClick={() => setTemplatesOpen((v) => !v)} title="Templates"><FolderOpen size={15} /></button>
          <button type="button" className="sketch-studio__icon-btn" onClick={handleSave} title="Save template"><Save size={15} /></button>
          <button type="button" className="sketch-studio__icon-btn" onClick={handleExportJson} title="Export"><Download size={15} /></button>
        </div>
      </div>

      {paletteOpen && mode === 'layout' ? (
        <aside className="sketch-studio__palette" aria-label="UI components">
          <div className="sketch-studio__palette-title">Components</div>
          <div className="sketch-studio__palette-grid">
            {LAYOUT_PALETTE.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                className="sketch-studio__palette-item"
                onClick={() => canvasRef.current?.addComponent(type, 280, 200)}
              >
                {label}
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      {paletteOpen && mode === 'blueprint' ? (
        <aside className="sketch-studio__palette" aria-label="Blueprint blocks">
          <div className="sketch-studio__palette-title">Rooms</div>
          <button type="button" className="sketch-studio__palette-item" onClick={() => canvasRef.current?.setElements(blueprintFloorPlanPreset())}>
            Load floor plan
          </button>
          <button type="button" className="sketch-studio__palette-item" onClick={() => canvasRef.current?.addComponent('rect', 200, 180)}>
            Add room block
          </button>
        </aside>
      ) : null}

      <div className="sketch-studio__canvas">
        <WireframeStudio ref={canvasRef} embedMode studioMode={mode} />
      </div>

      <div className="sketch-studio__modebar" role="tablist" aria-label="Studio mode">
        {MODE_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`sketch-studio__mode${mode === id ? ' is-active' : ''}`}
            onClick={() => setMode(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        <button type="button" className="sketch-studio__mode sketch-studio__mode--export" onClick={handleExportJson}>
          <Download size={14} />
          Export
        </button>
      </div>

      {templatesOpen ? (
        <div className="sketch-studio__templates" role="dialog" aria-label="Saved templates">
          <div className="sketch-studio__templates-head">
            <strong>Saved concepts</strong>
            <button type="button" className="sketch-studio__icon-btn" onClick={() => setTemplatesOpen(false)} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <p className="sketch-studio__templates-hint">Reuse agent drafts or your own — load, duplicate, refine in-app.</p>
          {docs.length === 0 ? (
            <p className="sketch-studio__templates-empty">No saved templates yet. Save the canvas to keep a concept.</p>
          ) : (
            <ul className="sketch-studio__templates-list">
              {docs.map((doc) => (
                <li key={doc.id} className="sketch-studio__templates-row">
                  <button type="button" className="sketch-studio__templates-load" onClick={() => handleLoadDoc(doc)}>
                    <span className="sketch-studio__templates-name">{doc.name}</span>
                    <span className="sketch-studio__templates-meta">{doc.mode} · {doc.elements.length} blocks · {doc.source}</span>
                  </button>
                  <button type="button" className="sketch-studio__icon-btn" title="Duplicate" onClick={() => handleDuplicate(doc.id)}><Copy size={13} /></button>
                  <button
                    type="button"
                    className="sketch-studio__icon-btn"
                    title="Delete"
                    onClick={() => {
                      deleteSketchDocument(doc.id);
                      if (activeDocId === doc.id) setActiveDocId(null);
                      refreshDocs();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="sketch-studio__zoom">
        <button type="button" className="sketch-studio__icon-btn" title="Zoom out" onClick={() => canvasRef.current?.zoomOut()}><ZoomOut size={14} /></button>
        <span>{zoomPct}%</span>
        <button type="button" className="sketch-studio__icon-btn" title="Zoom in" onClick={() => canvasRef.current?.zoomIn()}><ZoomIn size={14} /></button>
      </div>
    </div>
  );
}
