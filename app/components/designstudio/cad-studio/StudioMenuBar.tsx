/**
 * IAM Design Studio — clean top bar.
 * ☰  [+]  │  ↖ ↕ ↻ ⤢  │  🎬 Animate  🏠 Plan  ⚙ Adjust  ≡ Properties  │  📚 Library
 * Icons only. Labels on hover via title/tooltip.
 * No Save button. No health dot. No Timeline in default bar.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { SavedSceneRow } from '../shared/ScenePanel';
import {
  Menu, SquarePlus, MousePointer2, Move3d, RotateCcw, Maximize2,
  Clapperboard, HousePlus, Settings2, SlidersHorizontal, BookOpen,
  FileText, Download, Undo2, Redo2, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { IAM_AGENT_CHAT_COMPOSE } from '../../../agentChatConstants';
import type { WorkspaceId, ViewTool } from './cadStudioTypes';

export type StudioMenuBarProps = {
  activeWorkspace: WorkspaceId;
  onWorkspaceChange: (ws: WorkspaceId) => void;
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
  onToggleLibrary: () => void;
  libraryOpen?: boolean;
  onToggleTimeline: () => void;
  onResetLayout: () => void;
  onOperatorSearch: () => void;
  onRenderViewport: () => void;
  onRenderViaChat: (intent: string) => void;
  onShowDiagnostics: () => void;
  // active tool
  activeTool?: ViewTool;
  onToolChange?: (t: ViewTool) => void;
  // panel toggles
  animateOpen?: boolean;
  onToggleAnimate: () => void;
  planOpen?: boolean;
  onTogglePlan: () => void;
  adjustOpen?: boolean;
  onToggleAdjust: () => void;
  propertiesOpen?: boolean;
  onToggleProperties: () => void;
  // creation lane
  creationOpen?: boolean;
  onToggleCreation: () => void;
};

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
      <button type="button" className="cad-studio__icon-btn smb__icon" onClick={() => setOpen(o => !o)} title="Menu" aria-label="Menu">
        <Menu size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="cad-menu__panel smb__dropdown" onClick={() => setOpen(false)} style={{ minWidth: 220, top: 36, left: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, shortcut, onClick, disabled }: { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="cad-menu__item" onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      {shortcut && <span className="cad-menu__shortcut">{shortcut}</span>}
    </button>
  );
}

function Sep({ label }: { label?: string }) {
  return <div className="cad-menu__sep">{label ?? ''}</div>;
}

function ToolIcon({ icon: Icon, title, active, onClick, accent }: {
  icon: React.ElementType; title: string; active?: boolean; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={['smb__tool', active ? 'smb__tool--active' : '', accent ? 'smb__tool--accent' : ''].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  );
}

function Divider() {
  return <span className="smb__divider" aria-hidden />;
}

export function StudioMenuBar({
  savedScenes, onNewScene, onOpenScene, onImportFile, onExportGlb, onExportSceneJson,
  onUndo, onRedo, canUndo, canRedo, onDeleteSelected, onSelectAll, onDeselect, onRenameSelected,
  onToggleLibrary, libraryOpen, onToggleTimeline, onResetLayout, onOperatorSearch,
  onRenderViewport, onRenderViaChat, onShowDiagnostics,
  activeTool = 'select', onToolChange,
  animateOpen, onToggleAnimate,
  planOpen, onTogglePlan,
  adjustOpen, onToggleAdjust,
  propertiesOpen, onToggleProperties,
  creationOpen, onToggleCreation,
}: StudioMenuBarProps) {
  const recent = savedScenes.slice(0, 5);

  return (
    <nav className="smb__bar" aria-label="Studio toolbar">
      {/* Left: hamburger + create */}
      <div className="smb__left">
        <HamburgerMenu>
          <Sep label="File" />
          <MenuItem label="New Scene" shortcut="⌘N" onClick={onNewScene} />
          {recent.length > 0 && <Sep label="Open Recent" />}
          {recent.map(s => <MenuItem key={s.id} label={s.name} onClick={() => onOpenScene(s.id)} />)}
          <Sep />
          <MenuItem label="Import GLB…" onClick={onImportFile} />
          <MenuItem label="Export GLB" onClick={onExportGlb} />
          <MenuItem label="Export Scene JSON" onClick={onExportSceneJson} />
          <Sep label="Edit" />
          <MenuItem label="Undo" shortcut="⌘Z" onClick={onUndo} disabled={!canUndo} />
          <MenuItem label="Redo" shortcut="⇧⌘Z" onClick={onRedo} disabled={!canRedo} />
          <Sep />
          <MenuItem label="Delete Selected" shortcut="Del" onClick={onDeleteSelected} />
          <MenuItem label="Rename" onClick={onRenameSelected} />
          <Sep />
          <MenuItem label="Select All" shortcut="A" onClick={onSelectAll} />
          <MenuItem label="Deselect All" onClick={onDeselect} />
          <Sep label="Render" />
          <MenuItem label="Render Viewport" onClick={onRenderViewport} />
          <MenuItem label="Render Turntable" onClick={() => onRenderViaChat('Render 360 turntable (Meshy animate or Blender camera orbit)')} />
          <MenuItem label="Render Product Shot" onClick={() => onRenderViaChat('Render product hero shot')} />
          <MenuItem label="Apply Meshy Animation" onClick={() => onRenderViaChat('Apply Meshy animation clip to selected / active Meshy model')} />
          <Sep label="View" />
          <MenuItem label="Toggle Timeline" onClick={onToggleTimeline} />
          <MenuItem label="Command Palette" shortcut="⌘K" onClick={onOperatorSearch} />
          <MenuItem label="Reset Layout" onClick={onResetLayout} />
          <Sep label="Help" />
          <MenuItem label="Runner Diagnostics" onClick={onShowDiagnostics} />
          <MenuItem label="Keyboard Shortcuts" onClick={() =>
            window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
              detail: { message: 'Show IAM Studio keyboard shortcuts', send: false, ensureAgentPanel: true },
            }))
          } />
        </HamburgerMenu>

        <ToolIcon
          icon={SquarePlus}
          title="Create (MODEL · BUILD · SCENE)"
          active={creationOpen}
          onClick={onToggleCreation}
          accent
        />
      </div>

      {/* Center: transform tools */}
      <div className="smb__center">
        <ToolIcon icon={MousePointer2} title="Select  V"  active={activeTool === 'select'}  onClick={() => onToolChange?.('select')} />
        <ToolIcon icon={Move3d}        title="Move  G"    active={activeTool === 'move'}    onClick={() => onToolChange?.('move')} />
        <ToolIcon icon={RotateCcw}     title="Rotate  R"  active={activeTool === 'rotate'}  onClick={() => onToolChange?.('rotate')} />
        <ToolIcon icon={Maximize2}     title="Scale  S"   active={activeTool === 'scale'}   onClick={() => onToolChange?.('scale')} />
        <Divider />
        <ToolIcon icon={Clapperboard}    title="Animate — rig & motion"  active={animateOpen}    onClick={onToggleAnimate} />
        <ToolIcon icon={HousePlus}       title="Plan — 2D floor plan / CAD"  active={planOpen}   onClick={onTogglePlan} />
        <ToolIcon icon={Settings2}       title="Adjust — materials, lighting, modifiers"  active={adjustOpen}  onClick={onToggleAdjust} />
        <ToolIcon icon={SlidersHorizontal} title="Properties — object & scene inspector"  active={propertiesOpen}  onClick={onToggleProperties} />
      </div>

      {/* Right: library */}
      <div className="smb__right">
        <ToolIcon icon={BookOpen} title="Asset Library" active={libraryOpen} onClick={onToggleLibrary} />
      </div>
    </nav>
  );
}
