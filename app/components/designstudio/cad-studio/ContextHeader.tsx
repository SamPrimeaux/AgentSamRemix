import React, { useEffect, useRef, useState } from 'react';
import { Circle, Square } from 'lucide-react';
import type { InteractionMode } from './cadStudioTypes';
import type { AgentSamGeneratorKey } from '../../../utils/agentSamGenerators';

export type ContextHeaderProps = {
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  wireframe: boolean;
  solidShading: boolean;
  onToggleWireframe: () => void;
  onToggleSolid: () => void;
  onFrameAll: () => void;
  onAddCube: () => void;
  onImportFile: () => void;
  onSpawnProcedural?: (key: AgentSamGeneratorKey) => void;
};

const MODES: { id: InteractionMode; label: string }[] = [
  { id: 'object', label: 'Object Mode' },
  { id: 'edit', label: 'Edit Mode' },
  { id: 'sculpt', label: 'Sculpt Mode' },
  { id: 'pose', label: 'Pose Mode' },
];

const EDIT_SUBMENUS = ['Mesh', 'Vertex', 'Edge', 'Face'];
const POSE_SUBMENUS = ['Pose', 'Object'];

function SubMenu({
  label,
  items,
  onPick,
}: {
  label: string;
  items: string[];
  onPick?: (item: string) => void;
}) {
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
    <div className="cad-menu__dropdown" ref={ref}>
      <button type="button" className="cad-studio__btn" onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open ? (
        <div className="cad-menu__panel">
          {items.map((item) => (
            <button key={item} type="button" className="cad-menu__item" onClick={() => { onPick?.(item); setOpen(false); }}>
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ContextHeader({
  interactionMode,
  onInteractionModeChange,
  wireframe,
  solidShading,
  onToggleWireframe,
  onToggleSolid,
  onFrameAll,
  onAddCube,
  onImportFile,
  onSpawnProcedural,
}: ContextHeaderProps) {
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const modeLabel = MODES.find((m) => m.id === interactionMode)?.label ?? 'Object Mode';

  return (
    <section className="cad-studio__viewport-header">
      <div className="cad-studio__vh-group">
        <div className="cad-menu__dropdown" ref={modeRef}>
          <button
            type="button"
            className="cad-studio__btn cad-studio__mode-btn"
            onClick={() => setModeOpen((o) => !o)}
          >
            {modeLabel}
          </button>
          {modeOpen ? (
            <div className="cad-menu__panel">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="cad-menu__item"
                  onClick={() => {
                    onInteractionModeChange(m.id);
                    setModeOpen(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {interactionMode === 'edit'
          ? EDIT_SUBMENUS.map((s) => <SubMenu key={s} label={s} items={[s, `Select ${s}`, `${s} Tools`]} />)
          : null}
        {interactionMode === 'pose' ? POSE_SUBMENUS.map((s) => <SubMenu key={s} label={s} items={[s]} />) : null}
        <SubMenu
          label="View"
          items={['Frame All', 'Toggle Wireframe', 'Toggle Solid', 'Orthographic', 'Perspective']}
          onPick={(item) => {
            if (item === 'Frame All') onFrameAll();
            if (item === 'Toggle Wireframe') onToggleWireframe();
            if (item === 'Toggle Solid') onToggleSolid();
          }}
        />
        <SubMenu
          label="Add"
          items={['Mesh · Cube', 'Import GLB', 'Procedural · Sphere', 'Procedural · Torus', 'Light', 'Camera']}
          onPick={(item) => {
            if (item.startsWith('Mesh')) onAddCube();
            if (item.startsWith('Import')) onImportFile();
            if (item.includes('Sphere')) onSpawnProcedural?.('sphere');
            if (item.includes('Torus')) onSpawnProcedural?.('torus');
          }}
        />
        <SubMenu label="+" items={['Empty', 'Collection', 'Text']} />
      </div>
      <div className="cad-studio__vh-group">
        <span className="cad-studio__divider-v" />
        <button
          type="button"
          className={`cad-studio__icon-btn${solidShading ? ' active' : ''}`}
          title="Solid"
          onClick={onToggleSolid}
        >
          <Circle size={14} fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          className={`cad-studio__icon-btn${wireframe ? ' active' : ''}`}
          title="Wireframe"
          onClick={onToggleWireframe}
        >
          <Square size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="cad-studio__vh-group cad-studio__vh-spacer" />
    </section>
  );
}
