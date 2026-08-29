import React from 'react';
import { Loader2, Rocket } from 'lucide-react';
import type { CadJobRow } from './api';

type Props = {
  jobs: CadJobRow[];
  activeJob: CadJobRow | null;
  polling?: boolean;
  onSelectJob: (id: string) => void;
  onDeploy: (job: CadJobRow) => void;
};

function statusColor(status?: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'done' || s === 'script_ready') return 'text-emerald-400';
  if (s === 'failed') return 'text-red-400';
  if (s === 'pending' || s === 'running') return 'text-cyan-400';
  return 'text-muted';
}

export function CadJobPanel({ jobs, activeJob, polling, onSelectJob, onDeploy }: Props) {
  const displayJob = activeJob || jobs[0] || null;

  return (
    <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center gap-2">
        {polling ? <Loader2 size={14} className="animate-spin text-cyan-400" /> : <Rocket size={14} className="text-[var(--solar-orange)]" />}
        <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Jobs</p>
      </div>

      {displayJob ? (
        <div className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-muted truncate">{displayJob.id}</span>
            <span className={`text-[9px] font-black uppercase ${statusColor(displayJob.status)}`}>
              {displayJob.status}
            </span>
          </div>
          <div className="text-[9px] text-muted uppercase">
            {displayJob.engine}
            {displayJob.status === 'pending' || displayJob.status === 'running' ? ' · execos gcp' : ''}
          </div>
          {(displayJob.progress_pct ?? 0) > 0 && displayJob.status !== 'done' && (
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${Math.min(100, displayJob.progress_pct || 0)}%` }}
              />
            </div>
          )}
          {displayJob.error ? (
            <p className="text-[9px] text-red-400 line-clamp-3">{displayJob.error}</p>
          ) : null}
          {displayJob.public_url && displayJob.status === 'done' ? (
            <button
              type="button"
              onClick={() => onDeploy(displayJob)}
              className="w-full py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase"
            >
              Deploy to Scene
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-[10px] text-muted">No jobs yet — generate OpenSCAD or Meshy.</p>
      )}

      {jobs.length > 1 && (
        <div className="max-h-28 overflow-y-auto space-y-1">
          {jobs.slice(0, 8).map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => onSelectJob(j.id)}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-[9px] font-mono border ${
                j.id === displayJob?.id
                  ? 'border-cyan-500/40 bg-cyan-500/5'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-panel)]'
              }`}
            >
              <span className={statusColor(j.status)}>{j.status}</span>
              <span className="text-muted ml-2">{j.engine}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
