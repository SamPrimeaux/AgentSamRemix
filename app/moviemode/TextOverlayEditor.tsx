import React, { useState } from 'react';
import type { TextOverlay } from '../src/types/moviemode';

const emptyOverlay = (playheadMs: number): TextOverlay => ({
  id: `txt_${Date.now()}`,
  text: 'New text',
  startMs: playheadMs,
  durationMs: 3000,
  x: 50,
  y: 80,
  fontSize: 36,
  color: '#ffffff',
  fontWeight: 'bold',
  background: 'rgba(0,0,0,0.55)',
  align: 'center',
  animation: 'fade-in',
});

type Props = {
  overlays: TextOverlay[];
  playheadMs: number;
  onChange: (overlays: TextOverlay[]) => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="text-muted font-semibold">{label}</span>
      {children}
    </label>
  );
}

export const TextOverlayEditor: React.FC<Props> = ({ overlays, playheadMs, onChange }) => {
  const [editing, setEditing] = useState<TextOverlay | null>(null);
  const [panel, setPanel] = useState<'list' | 'edit'>('list');

  const save = (updated: TextOverlay) => {
    const exists = overlays.some((o) => o.id === updated.id);
    onChange(exists ? overlays.map((o) => (o.id === updated.id ? updated : o)) : [...overlays, updated]);
    setPanel('list');
    setEditing(null);
  };

  const remove = (id: string) => {
    onChange(overlays.filter((o) => o.id !== id));
    if (editing?.id === id) {
      setEditing(null);
      setPanel('list');
    }
  };

  const activeIds = new Set(
    overlays
      .filter((o) => playheadMs >= o.startMs && playheadMs < o.startMs + o.durationMs)
      .map((o) => o.id),
  );

  if (panel === 'edit' && editing) {
    return (
      <div className="flex flex-col gap-2 p-2 text-main">
        <div className="flex items-center justify-between">
          <button type="button" className="text-[11px] text-[var(--solar-cyan)]" onClick={() => setPanel('list')}>
            ← Back
          </button>
          <span className="text-[11px] font-semibold">Edit overlay</span>
        </div>
        <textarea
          className="w-full rounded border border-[var(--dashboard-border)] bg-[var(--bg-input)] p-2 text-sm"
          value={editing.text}
          rows={3}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
        />
        <div className="grid grid-cols-1 gap-2">
          <Field label={`Start (${(editing.startMs / 1000).toFixed(1)}s)`}>
            <input
              type="range"
              min={0}
              max={60000}
              step={100}
              value={editing.startMs}
              onChange={(e) => setEditing({ ...editing, startMs: +e.target.value })}
            />
          </Field>
          <Field label={`Duration (${(editing.durationMs / 1000).toFixed(1)}s)`}>
            <input
              type="range"
              min={500}
              max={15000}
              step={100}
              value={editing.durationMs}
              onChange={(e) => setEditing({ ...editing, durationMs: +e.target.value })}
            />
          </Field>
          <Field label={`X ${editing.x}%`}>
            <input
              type="range"
              min={5}
              max={95}
              value={editing.x}
              onChange={(e) => setEditing({ ...editing, x: +e.target.value })}
            />
          </Field>
          <Field label={`Y ${editing.y}%`}>
            <input
              type="range"
              min={5}
              max={95}
              value={editing.y}
              onChange={(e) => setEditing({ ...editing, y: +e.target.value })}
            />
          </Field>
          <Field label="Animation">
            <select
              className="rounded border border-[var(--dashboard-border)] bg-[var(--bg-input)] px-2 py-1"
              value={editing.animation}
              onChange={(e) =>
                setEditing({ ...editing, animation: e.target.value as TextOverlay['animation'] })
              }
            >
              <option value="none">None</option>
              <option value="fade-in">Fade in</option>
              <option value="slide-up">Slide up</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded bg-[var(--solar-cyan)] text-black text-xs font-bold py-1.5"
            onClick={() => save(editing)}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded border border-[var(--dashboard-border)] text-xs px-2"
            onClick={() => remove(editing.id)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <button
        type="button"
        className="text-[11px] rounded border border-[var(--dashboard-border)] py-1 hover:border-[var(--solar-cyan)]"
        onClick={() => {
          setEditing(emptyOverlay(playheadMs));
          setPanel('edit');
        }}
      >
        + Text overlay
      </button>
      {overlays.length === 0 && (
        <p className="text-[10px] text-center text-muted opacity-60">No overlays yet.</p>
      )}
      {overlays.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`text-left rounded px-2 py-1.5 border text-[11px] ${
            activeIds.has(o.id)
              ? 'border-[var(--solar-cyan)] bg-[var(--solar-cyan)]/10'
              : 'border-[var(--border-subtle)]'
          }`}
          onClick={() => {
            setEditing(o);
            setPanel('edit');
          }}
        >
          <span className="block truncate font-medium">{o.text.slice(0, 40)}</span>
          <span className="text-muted">
            {(o.startMs / 1000).toFixed(1)}s → {((o.startMs + o.durationMs) / 1000).toFixed(1)}s
            {activeIds.has(o.id) ? ' · LIVE' : ''}
          </span>
        </button>
      ))}
    </div>
  );
};
