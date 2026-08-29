import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aperture,
  Captions,
  CloudUpload,
  Film,
  Image as ImageIcon,
  Mic,
  Palette,
  Plus,
  ScanFace,
  Scissors,
  Search,
  Sparkles,
  Type,
  Video,
  Wand2,
  Zap,
} from 'lucide-react';
import { IAM_LOGO_URL } from './movieModeRoutes';
import { setMovieModeMediaSource } from './useMovieModeShell';
import type { MoviemodeProjectRow } from '../hooks/useMovieModeProjects';

const AI_TOOLS: Array<{ id: string; label: string; icon: React.ReactNode }> = [
  { id: 'autocut', label: 'AutoCut', icon: <Scissors size={22} /> },
  { id: 'retouch', label: 'Retouch', icon: <Wand2 size={22} /> },
  { id: 'ai-gen', label: 'AI generator', icon: <Sparkles size={22} /> },
  { id: 'photo', label: 'Photo tools', icon: <ImageIcon size={22} /> },
  { id: 'story', label: 'AI story maker', icon: <Film size={22} /> },
  { id: 'record', label: 'Shoot and record', icon: <Video size={22} /> },
  { id: 'enhance', label: 'Auto enhance', icon: <Zap size={22} /> },
  { id: 'captions', label: 'Auto captions', icon: <Captions size={22} /> },
  { id: 'bg', label: 'Remove background', icon: <ScanFace size={22} /> },
  { id: 'voice', label: 'AI voice', icon: <Mic size={22} /> },
  { id: 'brand', label: 'Brand kit', icon: <Palette size={22} /> },
  { id: 'templates', label: 'Templates', icon: <Aperture size={22} /> },
  { id: 'stock', label: 'Stock media', icon: <Film size={22} /> },
  { id: 'transitions', label: 'Transitions', icon: <Sparkles size={22} /> },
  { id: 'effects', label: 'Effects', icon: <Wand2 size={22} /> },
];

function formatProjectDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  projects: MoviemodeProjectRow[];
  projectsLoading?: boolean;
  onNewMovie: () => void;
  onImportStream: () => void;
  creating?: boolean;
};

export function MovieModeHome({
  projects,
  projectsLoading,
  onNewMovie,
  onImportStream,
  creating,
}: Props) {
  const navigate = useNavigate();
  const recent = useMemo(() => projects.slice(0, 8), [projects]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto bg-[#f2f2f7] text-[#111] max-phone:pb-2">
      {/* Hero — dark, mockup-aligned */}
      <section className="relative shrink-0 overflow-hidden bg-[#0a1018] text-white">
        <div
          className="absolute inset-0 opacity-40 bg-cover bg-center"
          style={{
            backgroundImage:
              'linear-gradient(135deg, rgba(45,212,191,0.15) 0%, rgba(10,16,24,0.9) 55%), radial-gradient(circle at 70% 30%, rgba(45,212,191,0.25), transparent 50%)',
          }}
          aria-hidden
        />

        <div className="relative px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-5">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={IAM_LOGO_URL}
                alt="Inner Animal Media"
                className="h-9 w-9 rounded-lg object-contain shrink-0"
              />
              <span className="text-[11px] font-bold tracking-[0.14em] text-white/90 truncate">
                INNER ANIMAL MEDIA
              </span>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/15"
              aria-label="Search"
            >
              <Search size={18} />
            </button>
          </div>

          <h1 className="text-[2rem] leading-[1.05] font-bold tracking-tight mb-2">
            Create. Edit.{' '}
            <span className="text-[var(--solar-cyan,#2dd4bf)]">Communicate.</span>
          </h1>
          <p className="text-[13px] text-white/70 max-w-[18rem] mb-6">
            AI-powered video tools built for creators, brands, and storytellers.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={creating}
              onClick={onNewMovie}
              className="flex flex-col items-start gap-3 rounded-2xl bg-[#121a24]/90 border border-white/10 p-4 text-left hover:border-[var(--solar-cyan)]/40 disabled:opacity-60"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--solar-cyan)] text-[#0a1018]">
                <Plus size={22} strokeWidth={2.5} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">New movie</span>
                <span className="block text-[11px] text-white/55 mt-0.5">Blank timeline</span>
              </span>
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={onImportStream}
              className="flex flex-col items-start gap-3 rounded-2xl bg-[#121a24]/90 border border-white/10 p-4 text-left hover:border-[var(--solar-cyan)]/40 disabled:opacity-60"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--solar-cyan)] text-[#0a1018]">
                <CloudUpload size={20} strokeWidth={2.2} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">Import from Stream</span>
                <span className="block text-[11px] text-white/55 mt-0.5">CF Stream library</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Light content area */}
      <section className="px-4 pt-5 pb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-bold tracking-[0.12em] text-[#6b7280]">RECENT PROJECTS</h2>
          <button
            type="button"
            onClick={() => navigate('/dashboard/moviemode/projects')}
            className="text-[12px] font-semibold text-[var(--solar-cyan,#0d9488)]"
          >
            See all &gt;
          </button>
        </div>

        {projectsLoading ? (
          <p className="text-[12px] text-[#6b7280] py-4">Loading projects…</p>
        ) : recent.length === 0 ? (
          <p className="text-[12px] text-[#6b7280] py-4">No projects yet — tap New movie to start.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
            {recent.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/dashboard/moviemode/${encodeURIComponent(p.id)}`)}
                className="shrink-0 w-[108px] text-left"
              >
                <div className="relative aspect-[9/16] rounded-xl bg-[#1a1a1a] overflow-hidden mb-2 border border-black/5">
                  <div className="absolute inset-0 flex items-center justify-center text-white/30">
                    <Film size={28} />
                  </div>
                  <span className="absolute bottom-1.5 right-1.5 rounded px-1 py-0.5 text-[9px] font-semibold bg-black/55 text-white">
                    16:9
                  </span>
                </div>
                <p className="text-[13px] font-semibold truncate">{p.title || p.slug}</p>
                <p className="text-[10px] text-[#6b7280] truncate">{formatProjectDate(p.updated_at || p.created_at)}</p>
              </button>
            ))}
          </div>
        )}

        <h2 className="text-[11px] font-bold tracking-[0.12em] text-[#6b7280] mt-6 mb-3">AI TOOLS</h2>
        <div className="grid grid-cols-5 gap-y-5 gap-x-1">
          {AI_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => navigate('/dashboard/moviemode/ai-studio')}
              className="flex flex-col items-center gap-1.5 text-center group"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white border border-black/5 text-[#111] shadow-sm group-active:scale-95 transition-transform">
                {tool.icon}
              </span>
              <span className="text-[9px] leading-tight text-[#374151] font-medium px-0.5">{tool.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Open editor with Stream media source pre-selected. */
export function primeStreamImport() {
  setMovieModeMediaSource('stream');
}
