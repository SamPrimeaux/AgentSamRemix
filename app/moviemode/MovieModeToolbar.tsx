import React from 'react';
import {
  Clapperboard,
  Download,
  Film,
  Layers,
  Music,
  Sparkles,
  Sticker,
  Type,
  Wand2,
} from 'lucide-react';
import type { MovieModeBinTab } from './useMovieModeShell';
import { useMovieModeShell } from './useMovieModeShell';

const TABS: Array<{ id: MovieModeBinTab; label: string; icon: React.ReactNode }> = [
  { id: 'media', label: 'Media', icon: <Film size={14} /> },
  { id: 'audio', label: 'Audio', icon: <Music size={14} /> },
  { id: 'text', label: 'Text', icon: <Type size={14} /> },
  { id: 'transitions', label: 'Transitions', icon: <Layers size={14} /> },
  { id: 'effects', label: 'Effects', icon: <Wand2 size={14} /> },
  { id: 'stickers', label: 'Stickers', icon: <Sticker size={14} /> },
  { id: 'templates', label: 'Templates', icon: <Sparkles size={14} /> },
];

export const MovieModeToolbar: React.FC<{
  title?: string;
  subtitle?: string;
  saving?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  extraActions?: React.ReactNode;
}> = ({ title, subtitle, saving, onExport, exportDisabled, extraActions }) => {
  const { binTab, setBinTab } = useMovieModeShell();

  return (
    <header className="shrink-0 flex flex-col border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]">
      <div className="flex items-center gap-2 px-3 py-2 min-h-[44px]">
        <Clapperboard size={16} className="text-[var(--solar-cyan)] shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-main truncate">
            {title || 'MovieMode'}
          </h1>
          {subtitle ? (
            <p className="text-[10px] text-muted truncate">{subtitle}</p>
          ) : null}
        </div>
        {saving ? <span className="text-[10px] text-muted">Saving…</span> : null}
        {extraActions}
        {onExport ? (
          <button
            type="button"
            disabled={exportDisabled}
            onClick={onExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[var(--solar-cyan)] text-[#0a0f14] hover:opacity-90 disabled:opacity-40"
          >
            <Download size={13} />
            Export
          </button>
        ) : null}
      </div>
      <nav
        className="flex items-center gap-0.5 px-2 pb-1 overflow-x-auto scrollbar-thin"
        aria-label="MovieMode asset categories"
      >
        {TABS.map((tab) => {
          const active = binTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBinTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-[var(--bg-hover)] text-[var(--solar-cyan)]'
                  : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/60'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
