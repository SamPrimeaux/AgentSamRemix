import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, FolderOpen, LayoutTemplate, Sparkles } from 'lucide-react';
import type { MovieModeShellTab } from './movieModeRoutes';
import { movieModeTabPath } from './movieModeRoutes';

const TABS: Array<{ id: MovieModeShellTab; label: string; icon: React.ReactNode }> = [
  { id: 'editor', label: 'Editor', icon: <Clapperboard size={22} strokeWidth={1.5} /> },
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={22} strokeWidth={1.5} /> },
  { id: 'ai-studio', label: 'AI Studio', icon: <Sparkles size={22} strokeWidth={1.5} /> },
  { id: 'projects', label: 'Projects', icon: <FolderOpen size={22} strokeWidth={1.5} /> },
];

type Props = {
  activeTab: MovieModeShellTab;
  projectId?: string | null;
};

export function MovieModeBottomNav({ activeTab, projectId }: Props) {
  const navigate = useNavigate();

  return (
    <nav
      className="hidden max-phone:flex fixed inset-x-0 z-[91] items-stretch justify-around gap-0 border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/98 backdrop-blur-sm"
      style={{ bottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Movie Mode"
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`relative flex flex-1 flex-col items-center justify-center min-h-[52px] gap-0.5 px-0.5 text-[10px] font-medium leading-tight ${
              active ? 'text-[var(--solar-cyan)]' : 'text-muted'
            }`}
            onClick={() => navigate(movieModeTabPath(tab.id, tab.id === 'editor' ? projectId : null))}
          >
            {active ? (
              <span
                className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[var(--solar-cyan)]"
                aria-hidden
              />
            ) : null}
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
