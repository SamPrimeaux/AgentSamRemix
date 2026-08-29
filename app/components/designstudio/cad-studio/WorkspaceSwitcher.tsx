import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Clapperboard,
  Film,
  Grid3x3,
  Layers,
  MoreHorizontal,
  Palette,
  PenTool,
  Scissors,
  Sparkles,
  Video,
} from 'lucide-react';
import type { WorkspaceId } from './cadStudioTypes';
import { WORKSPACE_IDS } from './cadStudioTypes';

const PRIMARY: { id: WorkspaceId; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'Layout', label: 'Layout', icon: Grid3x3 },
  { id: 'Modeling', label: 'Model', icon: Box },
  { id: 'Shading', label: 'Shade', icon: Palette },
  { id: 'Animation', label: 'Animate', icon: Clapperboard },
  { id: 'Rendering', label: 'Render', icon: Film },
  { id: 'Agent', label: 'Agent', icon: Sparkles },
];

const OVERFLOW_IDS = WORKSPACE_IDS.filter((id) => !PRIMARY.some((p) => p.id === id));

export type WorkspaceSwitcherProps = {
  activeWorkspace: WorkspaceId;
  onWorkspaceChange: (ws: WorkspaceId) => void;
};

export function WorkspaceSwitcher({ activeWorkspace, onWorkspaceChange }: WorkspaceSwitcherProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const overflowActive = OVERFLOW_IDS.includes(activeWorkspace);

  const overflowIcon = (id: WorkspaceId) => {
    if (id.includes('UV') || id.includes('Texture')) return PenTool;
    if (id.includes('Video')) return Video;
    if (id.includes('Motion')) return Film;
    if (id.includes('2D')) return PenTool;
    if (id.includes('Sculpt')) return Scissors;
    if (id.includes('Geometry')) return Layers;
    return Box;
  };

  return (
    <div className="cad-workspace-switcher" role="tablist" aria-label="Workspaces">
      {PRIMARY.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeWorkspace === id}
          className={`cad-workspace-switcher__btn${activeWorkspace === id ? ' active' : ''}`}
          title={id}
          onClick={() => onWorkspaceChange(id)}
        >
          <Icon size={15} strokeWidth={1.75} />
          <span className="cad-workspace-switcher__label">{label}</span>
        </button>
      ))}

      <div className="cad-menu__dropdown" ref={ref}>
        <button
          type="button"
          className={`cad-workspace-switcher__btn cad-workspace-switcher__more${overflowActive ? ' active' : ''}`}
          title="More workspaces"
          aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((o) => !o)}
        >
          <MoreHorizontal size={15} strokeWidth={1.75} />
          <span className="cad-workspace-switcher__label">More</span>
        </button>
        {overflowOpen ? (
          <div className="cad-menu__panel cad-workspace-switcher__overflow">
            {OVERFLOW_IDS.map((id) => {
              const Icon = overflowIcon(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`cad-menu__item${activeWorkspace === id ? ' active' : ''}`}
                  onClick={() => {
                    onWorkspaceChange(id);
                    setOverflowOpen(false);
                  }}
                >
                  <Icon size={14} strokeWidth={1.75} />
                  <span>{id}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
