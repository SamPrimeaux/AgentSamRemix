import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Loader2, MoreVertical, Plus, Scissors } from 'lucide-react';
import { IAM_LOGO_URL } from './movieModeRoutes';
import type { MoviemodeProjectRow } from '../hooks/useMovieModeProjects';

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
  loading?: boolean;
  onCreate: () => void;
  creating?: boolean;
};

export function MovieModeProjectsTab({ projects, loading, onCreate, creating }: Props) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'video'>('all');
  const rows = useMemo(() => {
    if (filter === 'video') return projects;
    return projects;
  }, [projects, filter]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[#f2f2f7] text-[#111]">
      <header className="shrink-0 px-4 pt-3 pb-2 bg-[#f2f2f7] border-b border-black/5">
        <div className="flex items-center gap-2 mb-3">
          <img src={IAM_LOGO_URL} alt="" className="h-7 w-7 rounded-md object-contain" aria-hidden />
          <h1 className="text-[22px] font-bold tracking-tight">Projects</h1>
        </div>
        <div className="flex gap-4 text-[14px] font-semibold border-b border-black/5 -mx-4 px-4">
          <span className="pb-2 border-b-2 border-[#111] text-[#111]">Local</span>
          <span className="pb-2 text-[#9ca3af]">Spaces</span>
          <span className="pb-2 text-[#9ca3af]">Media</span>
          <span className="pb-2 text-[#9ca3af]">Trash</span>
        </div>
        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-thin pb-1">
          {(['all', 'video'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold border ${
                filter === id
                  ? 'bg-[#111] text-white border-[#111]'
                  : 'bg-white text-[#374151] border-black/10'
              }`}
            >
              {id === 'all' ? 'All' : 'Video'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] text-[#6b7280]">{rows.length} projects</span>
        </div>

        <button
          type="button"
          className="w-full mb-4 flex items-center gap-3 rounded-2xl bg-[#dbeafe] px-4 py-3 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#2563eb]">
            <Film size={20} />
          </span>
          <span>
            <span className="block text-[14px] font-semibold text-[#111]">Space</span>
            <span className="block text-[11px] text-[#6b7280]">Upload and manage your projects</span>
          </span>
        </button>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[#6b7280]">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-[#6b7280] py-8 text-center">No projects yet.</p>
        ) : (
          <ul className="space-y-3 pb-20">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/dashboard/moviemode/${encodeURIComponent(p.id)}`)}
                  className="w-full flex items-center gap-3 rounded-2xl bg-white border border-black/5 p-3 text-left shadow-sm active:scale-[0.99] transition-transform"
                >
                  <div className="relative h-16 w-16 shrink-0 rounded-xl bg-[#1a1a1a] overflow-hidden flex items-center justify-center text-white/40">
                    <Film size={22} />
                    <span className="absolute bottom-1 right-1 text-[9px] font-bold text-white bg-black/50 rounded px-1">
                      00:10
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold truncate">{p.title || p.slug}</p>
                    <p className="text-[11px] text-[#6b7280]">{formatProjectDate(p.updated_at || p.created_at)}</p>
                    <p className="flex items-center gap-1 text-[11px] text-[#6b7280] mt-0.5">
                      <Scissors size={12} />
                      <span>—</span>
                    </p>
                  </div>
                  <MoreVertical size={18} className="text-[#9ca3af] shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={creating}
        onClick={onCreate}
        className="fixed max-phone:right-4 right-8 z-[92] inline-flex items-center gap-2 rounded-full bg-[var(--solar-cyan,#2dd4bf)] px-5 py-3 text-[14px] font-bold text-[#0a1018] shadow-lg disabled:opacity-60"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}
      >
        <Plus size={18} strokeWidth={2.5} />
        Create
      </button>
    </div>
  );
}
