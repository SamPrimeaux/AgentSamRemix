import React from 'react';
import {
  Box,
  Clapperboard,
  Image,
  Key,
  Layers,
  Paintbrush,
  Printer,
  Sparkles,
  Type,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  MESHY_RAIL_TOOLS,
  type MeshyRailTool,
  persistMeshyRail,
} from './meshyToolkitTypes';

const ICONS: Record<MeshyRailTool, React.ReactNode> = {
  'text-to-3d': <Type size={18} strokeWidth={1.75} />,
  'image-to-3d': <Upload size={18} strokeWidth={1.75} />,
  'text-to-texture': <Wand2 size={18} strokeWidth={1.75} />,
  texture: <Paintbrush size={18} strokeWidth={1.75} />,
  animate: <Clapperboard size={18} strokeWidth={1.75} />,
  'post-process': <Sparkles size={18} strokeWidth={1.75} />,
  image: <Image size={18} strokeWidth={1.75} />,
  print: <Printer size={18} strokeWidth={1.75} />,
};

type Props = {
  active: MeshyRailTool;
  meshySegmentActive: boolean;
  onSelect: (tool: MeshyRailTool) => void;
  onOpenApiKey: () => void;
  onOpenTerminal: () => void;
  className?: string;
};

export function MeshyToolRail({
  active,
  meshySegmentActive,
  onSelect,
  onOpenApiKey,
  onOpenTerminal,
  className = '',
}: Props) {
  return (
    <nav
      className={`hidden md:flex flex-col items-stretch shrink-0 py-2 px-1 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] ${className}`}
      style={{ width: 58 }}
      aria-label="Meshy tools"
    >
      <div
        className="mx-auto mb-2 w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--solar-cyan) 12%, transparent)', color: 'var(--solar-cyan)' }}
      >
        <Box size={16} />
      </div>

      {MESHY_RAIL_TOOLS.map((t) => {
        const isActive = meshySegmentActive && active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            onClick={() => {
              persistMeshyRail(t.id);
              onSelect(t.id);
            }}
            className="relative flex flex-col items-center gap-0.5 py-2 px-0.5 text-center cursor-pointer border-l-2 transition-colors"
            style={{
              borderLeftColor: isActive ? 'var(--solar-cyan)' : 'transparent',
              color: isActive ? 'var(--solar-cyan)' : 'var(--text-muted)',
              background: isActive ? 'color-mix(in srgb, var(--solar-cyan) 8%, transparent)' : 'transparent',
            }}
          >
            {ICONS[t.id]}
            <span className="text-[9px] font-medium leading-tight tracking-tight px-0.5">{t.shortLabel}</span>
          </button>
        );
      })}

      <div className="flex-1 min-h-2" />

      <button
        type="button"
        title="Settings → Keys"
        onClick={onOpenApiKey}
        className="flex flex-col items-center gap-0.5 py-2 text-muted hover:text-[var(--solar-cyan)]"
      >
        <Key size={16} />
        <span className="text-[9px]">Keys</span>
      </button>
      <button
        type="button"
        title="Terminal / logs"
        onClick={onOpenTerminal}
        className="flex flex-col items-center gap-0.5 py-2 mb-1 text-muted hover:text-[var(--solar-cyan)]"
      >
        <Layers size={16} />
        <span className="text-[9px]">Log</span>
      </button>
    </nav>
  );
}

export function MobileMeshyToolStrip({
  active,
  meshySegmentActive,
  onSelect,
}: {
  active: MeshyRailTool;
  meshySegmentActive: boolean;
  onSelect: (tool: MeshyRailTool) => void;
}) {
  return (
    <div className="flex md:hidden gap-1 p-2 overflow-x-auto shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      {MESHY_RAIL_TOOLS.map((t) => {
        const isActive = meshySegmentActive && active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              persistMeshyRail(t.id);
              onSelect(t.id);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-semibold uppercase whitespace-nowrap border"
            style={{
              borderColor: isActive ? 'color-mix(in srgb, var(--solar-cyan) 35%, transparent)' : 'var(--border-subtle)',
              background: isActive ? 'color-mix(in srgb, var(--solar-cyan) 10%, transparent)' : 'transparent',
              color: isActive ? 'var(--solar-cyan)' : 'var(--text-muted)',
            }}
          >
            {ICONS[t.id]}
            {t.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
