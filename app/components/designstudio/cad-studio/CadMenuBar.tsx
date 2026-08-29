/**
 * IAM CAD Studio — Excalidraw-style top bar.
 * Left:   ☰ hamburger (all File/Edit/Render/Window/Help menus)
 * Center: context tool strip (mode-switcher + primary tool buttons)
 * Right:  Library toggle · Save Scene · runner health dot
 */
import React, { useEffect, useRef, useState } from 'react';
import type { SavedSceneRow } from '../shared/ScenePanel';
import {
  Menu, BookOpen, Circle, Save,
  Undo2, Redo2, MousePointer2, Move3d, RotateCcw, Maximize2,
  Box, Clapperboard, Cpu, SlidersHorizontal, Layers,
  PanelRight, Clock,
} from 'lucide-react';
import { IAM_AGENT_CHAT_COMPOSE } from '../../../agentChatConstants';
import type { WorkspaceId, ViewTool } from './cadStudioTypes';

export type CadMenuBarProps = {
  activeWorkspace: WorkspaceId;
  onWorkspaceChange: (ws: WorkspaceId) => void;
  onSaveScene: () => void;
  sceneBusy: boolean;
  savedScenes: SavedSceneRow[];
  onNewScene: () => void;
  onOpenScene: (id: string) => void;
  onImportFile: () => void;
  onExportGlb: () => void;
  onExportSceneJson: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onDeselect: () => void;
  onRenameSelected?: () => void;
  onToggleOutliner: () => void;
  onToggleProperties: () => void;
  onToggleAnimationLibrary: () => void;
  animationLibraryOpen?: boolean;
  onToggleLibrary: () => void;
  libraryOpen?: boolean;
  onToggleAssets: () => void;
  onToggleTimeline: () => void;
  onToggleConsole: () => void;
  onResetLayout: () => void;
  onOperatorSearch: () => void;
  onGenerateCad: () => void;
  onRenderViewport: () => void;
  onRenderViaChat: (intent: string) => void;
  computeHealth: string;
  onShowDiagnostics: () => void;
  // tool state
  activeTool?: ViewTool;
  onToolChange?: (t: ViewTool) => void;
  onTogglePanMode?: () => void;
  panMode?: boolean;
};

// ─── Hamburger dropdown ──────────────────────────────────────────────────────

function HamburgerMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="cad-menu__dropdown" ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="cad-studio__icon-btn"
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        aria-label="Open menu"
        style={{ width: 32, height: 32 }}
      >
        <Menu size={16} strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          className="cad-menu__panel"
          onClick={() => setOpen(false)}
          style={{ minWidth: 220, top: 36, left: 0 }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Sep({ label }: { label?: string }) {
  return <div className="cad-menu__sep">{label}</div>;
}

function Item({
  label, shortcut, onClick, disabled,
}: {
  label: string; shortcut?: string; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className="cad-menu__item" onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      {shortcut ? <span className="cad-menu__shortcut">{shortcut}</span> : null}
    </button>
  );
}

// ─── Center tool strip button ────────────────────────────────────────────────

function ToolBtn({
  icon: Icon, label, active, onClick, title,
}: {
  icon: React.ElementType; label?: string; active?: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      type="button"
      className={`cad-studio__icon-btn${active ? ' active' : ''}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{ width: 'auto', padding: '0 8px', gap: 5, display: 'inline-flex', alignItems: 'center', height: 28, borderRadius: 5, fontSize: 11 }}
    >
      <Icon size={13} strokeWidth={1.75} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 18, background: 'var(--cs-line-2)', margin: '0 2px', display: 'inline-block', verticalAlign: 'middle' }} />;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CadMenuBar({
  onSaveScene, sceneBusy, savedScenes,
  onNewScene, onOpenScene, onImportFile, onExportGlb, onExportSceneJson,
  onUndo, onRedo, canUndo, canRedo,
  onDeleteSelected, onSelectAll, onDeselect, onRenameSelected,
  onToggleOutliner, onToggleProperties, onToggleAnimationLibrary, animationLibraryOpen,
  onToggleLibrary, libraryOpen, onToggleAssets, onToggleTimeline, onToggleConsole,
  onResetLayout, onOperatorSearch, onGenerateCad,
  onRenderViewport, onRenderViaChat, computeHealth, onShowDiagnostics,
  activeTool = 'select', onToolChange,
}: CadMenuBarProps) {

  const recent = savedScenes.slice(0, 5);

  return (
    <nav
      className="cad-studio__top-menu"
      aria-label="Studio toolbar"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        height: 40,
        minHeight: 40,
        background: 'var(--cs-bg-3)',
        borderBottom: '1px solid var(--cs-line-0)',
      }}
    >
      {/* ── Left: hamburger ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <HamburgerMenu>
          <Sep label="File" />
          <Item label="New Scene" shortcut="⌘N" onClick={onNewScene} />
          {recent.length > 0 ? <Sep label="Open Recent" /> : null}
          {recent.map((s) => <Item key={s.id} label={s.name} onClick={() => onOpenScene(s.id)} />)}
          <Sep />
          <Item label="Import GLB…" onClick={onImportFile} />
          <Item label="Export GLB" onClick={onExportGlb} />
          <Item label="Export Scene JSON" onClick={onExportSceneJson} />
          <Sep />
          <Item label="Save Scene" shortcut="⌘S" onClick={onSaveScene} disabled={sceneBusy} />

          <Sep label="Edit" />
          <Item label="Undo" shortcut="⌘Z" onClick={onUndo} disabled={!canUndo} />
          <Item label="Redo" shortcut="⇧⌘Z" onClick={onRedo} disabled={!canRedo} />
          <Sep />
          <Item label="Delete Selected" shortcut="Del" onClick={onDeleteSelected} />
          <Item label="Rename" onClick={onRenameSelected} />
          <Sep />
          <Item label="Select All" shortcut="A" onClick={onSelectAll} />
          <Item label="Deselect All" onClick={onDeselect} />

          <Sep label="Render" />
          <Item label="Render Viewport" onClick={onRenderViewport} />
          <Item label="Render Turntable" onClick={() => onRenderViaChat('Render 360 turntable (Meshy animate or Blender camera orbit)')} />
          <Item label="Render Product Shot" onClick={() => onRenderViaChat('Render product hero shot')} />
          <Item label="Apply Meshy Animation" onClick={() => onRenderViaChat('Apply Meshy animation clip to selected / active Meshy model')} />

          <Sep label="Panels" />
          <Item label={`${animationLibraryOpen ? 'Hide' : 'Show'} Animation Library`} onClick={onToggleAnimationLibrary} />
          <Item label="Toggle Outliner" onClick={onToggleOutliner} />
          <Item label="Toggle Properties" onClick={onToggleProperties} />
          <Item label="Toggle Assets" onClick={onToggleAssets} />
          <Item label="Toggle Timeline" onClick={onToggleTimeline} />
          <Item label="Toggle Console" onClick={onToggleConsole} />
          <Sep />
          <Item label="Command Palette" shortcut="⌘K" onClick={onOperatorSearch} />
          <Item label="Reset Layout" onClick={onResetLayout} />
          <Item label="Generate CAD Object" onClick={onGenerateCad} />

          <Sep label="Help" />
          <Item label="Runner Diagnostics" onClick={onShowDiagnostics} />
          <Item
            label="Keyboard Shortcuts"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
                detail: { message: 'Show IAM CAD Studio keyboard shortcuts', send: false, ensureAgentPanel: true },
              }))
            }
          />
        </HamburgerMenu>
      </div>

      {/* ── Center: Excalidraw-style tool strip ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        {/* Selection / transform tools */}
        <ToolBtn icon={MousePointer2} title="Select (V)" active={activeTool === 'select'} onClick={() => onToolChange?.('select')} />
        <ToolBtn icon={Move3d} title="Move (G)" active={activeTool === 'move'} onClick={() => onToolChange?.('move')} />
        <ToolBtn icon={RotateCcw} title="Rotate (R)" active={activeTool === 'rotate'} onClick={() => onToolChange?.('rotate')} />
        <ToolBtn icon={Maximize2} title="Scale (S)" active={activeTool === 'scale'} onClick={() => onToolChange?.('scale')} />

        <Divider />

        {/* Scene actions */}
        <ToolBtn icon={Box} label="Add" title="Add object" active={false} onClick={onGenerateCad} />
        <ToolBtn icon={Cpu} label="Generate" title="Generate CAD / AI model" active={false} onClick={onGenerateCad} />

        <Divider />

        {/* Panel toggles */}
        <ToolBtn icon={Clapperboard} label="Animate" title="Animation library" active={animationLibraryOpen} onClick={onToggleAnimationLibrary} />
        <ToolBtn icon={Layers} label="Outliner" title="Toggle outliner" active={false} onClick={onToggleOutliner} />
        <ToolBtn icon={SlidersHorizontal} label="Properties" title="Toggle properties" active={false} onClick={onToggleProperties} />
        <ToolBtn icon={Clock} label="Timeline" title="Toggle timeline" active={false} onClick={onToggleTimeline} />
      </div>

      {/* ── Right: library · save · health ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ToolBtn
          icon={BookOpen}
          label="Library"
          title="Asset library"
          active={libraryOpen}
          onClick={onToggleLibrary}
        />
        <button
          type="button"
          className="cad-studio__btn cad-studio__save-btn"
          onClick={onSaveScene}
          disabled={sceneBusy}
          style={{ display: 'flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px' }}
        >
          <Save size={12} strokeWidth={2} />
          {sceneBusy ? 'Saving…' : 'Save'}
        </button>
        <span
          className={`cad-menu__health cad-menu__health--${computeHealth}`}
          title={`Runner: ${computeHealth}`}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Circle size={8} fill="currentColor" />
        </span>
      </div>
    </nav>
  );
}
