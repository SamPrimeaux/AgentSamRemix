import React from 'react';
import { Package } from 'lucide-react';

export type SavedSceneRow = {
  id: string;
  name: string;
  entity_count: number;
  updated_at: number;
  cad_job_id?: string | null;
  glb_r2_key?: string | null;
};

type Props = {
  sceneName: string;
  onSceneNameChange: (name: string) => void;
  savedScenes: SavedSceneRow[];
  sceneBusy: boolean;
  onSaveScene: () => void;
  onLoadScene: (id: string) => void;
  cadJobId?: string | null;
  glbR2Key?: string | null;
};

export function ScenePanel({
  sceneName,
  onSceneNameChange,
  savedScenes,
  sceneBusy,
  onSaveScene,
  onLoadScene,
  cadJobId,
  glbR2Key,
}: Props) {
  return (
    <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Package size={14} className="text-[var(--solar-cyan)]" />
        <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Scene</p>
      </div>
      <input
        type="text"
        placeholder="Scene name"
        className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[11px]"
        value={sceneName}
        onChange={(e) => onSceneNameChange(e.target.value)}
      />
      {(cadJobId || glbR2Key) && (
        <div className="text-[9px] font-mono text-muted space-y-0.5 px-1">
          {cadJobId ? <div>CAD job: {cadJobId.slice(0, 20)}…</div> : null}
          {glbR2Key ? <div>GLB: {glbR2Key.split('/').pop()}</div> : null}
        </div>
      )}
      <button
        type="button"
        disabled={sceneBusy}
        onClick={onSaveScene}
        className="w-full bg-[var(--solar-cyan)] text-black py-2 rounded-xl text-[10px] font-black uppercase disabled:opacity-40"
      >
        {sceneBusy ? 'Saving…' : 'Save Scene'}
      </button>
      {savedScenes.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-1">
          {savedScenes.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={sceneBusy}
              onClick={() => onLoadScene(s.id)}
              className="w-full text-left px-2 py-1.5 rounded-lg text-[10px] font-bold bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--solar-cyan)]/40"
            >
              {s.name}{' '}
              <span className="text-muted font-mono">({s.entity_count})</span>
              {s.cad_job_id ? <span className="text-[var(--solar-cyan)] ml-1">· CAD</span> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
