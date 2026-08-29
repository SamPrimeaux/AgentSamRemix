import React, { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import type { BlueprintRow, CadJobRow } from './api';

type Props = {
  blueprints: BlueprintRow[];
  activeBlueprintId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string, prompt?: string) => Promise<void>;
  busy?: boolean;
  linkedJob?: CadJobRow | null;
};

function statusBadge(status?: string) {
  const s = String(status || 'draft').toLowerCase();
  const colors: Record<string, string> = {
    draft: 'bg-white/10 text-white/60',
    generated: 'bg-cyan-500/20 text-cyan-400',
    exported: 'bg-emerald-500/20 text-emerald-400',
  };
  return (
    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${colors[s] || colors.draft}`}>
      {s}
    </span>
  );
}

export function BlueprintPanel({ blueprints, activeBlueprintId, onSelect, onCreate, busy, linkedJob }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onCreate(title.trim(), prompt.trim() || undefined);
    setTitle('');
    setPrompt('');
    setShowForm(false);
  };

  return (
    <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-[var(--solar-cyan)]" />
          <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
            Blueprints
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="p-1 rounded-md bg-cyan-500/10 text-cyan-400"
          title="New blueprint"
        >
          <Plus size={14} />
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-2 p-3 bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)]">
          <input
            type="text"
            placeholder="Blueprint title"
            className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[11px]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          <textarea
            placeholder="Original prompt (optional)"
            rows={2}
            className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[11px] resize-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className="w-full bg-[var(--solar-cyan)] text-black py-2 rounded-lg text-[9px] font-black uppercase disabled:opacity-40"
          >
            Create Blueprint
          </button>
        </form>
      )}

      {linkedJob && activeBlueprintId ? (
        <div className="flex items-center justify-between gap-2 px-1 py-1 rounded-lg bg-cyan-500/5 border border-cyan-500/15">
          <span className="text-[9px] text-muted uppercase tracking-wide">Pipeline</span>
          <span
            className={`text-[9px] font-black uppercase ${
              linkedJob.status === 'done'
                ? 'text-emerald-400'
                : linkedJob.status === 'failed'
                  ? 'text-red-400'
                  : 'text-cyan-400'
            }`}
          >
            {linkedJob.status}
            {(linkedJob.progress_pct ?? 0) > 0 && linkedJob.status !== 'done'
              ? ` · ${linkedJob.progress_pct}%`
              : ''}
          </span>
        </div>
      ) : null}

      <div className="max-h-40 overflow-y-auto space-y-1">
        {blueprints.length === 0 && (
          <p className="text-[10px] text-muted px-1">No blueprints yet.</p>
        )}
        {blueprints.map((bp) => {
          const id = String(bp.id);
          const active = id === activeBlueprintId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={`w-full text-left px-2 py-2 rounded-lg border text-[10px] ${
                active
                  ? 'bg-cyan-500/10 border-cyan-500/40 text-main'
                  : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] hover:border-cyan-500/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold truncate">{bp.title}</span>
                {statusBadge(bp.status)}
              </div>
              {bp.preview_image_url ? (
                <img
                  src={bp.preview_image_url}
                  alt=""
                  className="mt-1.5 w-full max-h-16 object-contain rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
                />
              ) : null}
              {bp.original_prompt ? (
                <p className="text-[9px] text-muted truncate mt-0.5">{bp.original_prompt}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
