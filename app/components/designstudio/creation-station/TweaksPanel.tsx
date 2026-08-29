import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { MeshyPhase, MeshySettings } from './meshyTypes';
import { MeshyKeysLink } from './MeshyRailFields';

const SAMPLE_PROMPT = 'Describe the 3D model you want to generate…';

type Props = {
  tool: 'text-to-3d';
  meshyPhase: MeshyPhase;
  onMeshyPhase: (p: MeshyPhase) => void;
  settings: MeshySettings;
  onPatch: (p: Partial<MeshySettings>) => void;
  meshyStub: boolean;
  ctaCost: number;
  isGenerating: boolean;
  progressPct?: number;
  onCreate: () => void;
  onQuickGenerate: () => void;
  latestGlbUrl?: string | null;
  onDownloadGlb?: () => void;
  className?: string;
  embedded?: boolean;
};

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-[11px] text-zinc-400">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-zinc-700'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

export function TweaksPanel({
  tool,
  meshyPhase,
  onMeshyPhase,
  settings,
  onPatch,
  meshyStub,
  ctaCost,
  isGenerating,
  progressPct,
  onCreate,
  onQuickGenerate,
  latestGlbUrl,
  onDownloadGlb,
  className = '',
  embedded = false,
}: Props) {

  const title = 'Text to 3D';

  const inner = (
    <>
      {!embedded && (
        <header className="shrink-0 px-4 pt-4 pb-3 border-b border-[var(--border-subtle)]">
          <h2 className="text-[15px] font-semibold text-main">{title}</h2>
          {tool === 'text-to-3d' && (
            <div className="flex gap-1 mt-3 p-0.5 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
              {(['preview', 'refine'] as MeshyPhase[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onMeshyPhase(p)}
                  className="flex-1 py-1.5 rounded-md text-[11px] font-semibold capitalize"
                  style={{
                    background: meshyPhase === p ? 'var(--solar-cyan)' : 'transparent',
                    color: meshyPhase === p ? 'var(--bg-app)' : 'var(--text-muted)',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </header>
      )}

      {embedded && tool === 'text-to-3d' && (
        <div className="flex gap-1 mb-3 p-0.5 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
          {(['preview', 'refine'] as MeshyPhase[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onMeshyPhase(p)}
              className="flex-1 py-1.5 rounded-md text-[11px] font-semibold capitalize"
              style={{
                background: meshyPhase === p ? 'var(--solar-cyan)' : 'transparent',
                color: meshyPhase === p ? 'var(--bg-app)' : 'var(--text-muted)',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className={`${embedded ? '' : 'flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3'} space-y-3`}>
        {tool === 'text-to-3d' && (
          <>
            {meshyStub && (
              <p className="text-[11px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Platform Meshy key not configured on this Worker.
              </p>
            )}
            <MeshyKeysLink />

            {meshyPhase === 'refine' && (
              <div>
                <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                  Preview task ID
                </label>
                <input
                  className="mt-1 w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-300"
                  placeholder="From preview step…"
                  value={settings.preview_task_id}
                  onChange={(e) => onPatch({ preview_task_id: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Prompt</label>
              <textarea
                rows={5}
                className="mt-1 w-full bg-[#08090d] border border-white/[0.08] rounded-xl px-3 py-2.5 text-[12px] text-zinc-200 leading-relaxed resize-none focus:border-emerald-500/40 focus:outline-none"
                placeholder={SAMPLE_PROMPT}
                value={meshyPhase === 'refine' ? settings.texture_prompt || settings.prompt : settings.prompt}
                onChange={(e) =>
                  meshyPhase === 'refine'
                    ? onPatch({ texture_prompt: e.target.value })
                    : onPatch({ prompt: e.target.value })
                }
                disabled={isGenerating}
              />
              <p className="mt-1 text-[10px] text-zinc-600 text-right">
                {(meshyPhase === 'refine' ? settings.texture_prompt || settings.prompt : settings.prompt).length}/600
              </p>
            </div>

            <details className="group rounded-xl border border-white/[0.06] bg-[#0c0d12]">
              <summary className="px-3 py-2.5 text-[11px] font-medium text-zinc-400 cursor-pointer list-none flex justify-between">
                Optional settings
                <span className="text-zinc-600 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04]">
                <label className="text-[10px] text-zinc-500">AI model</label>
                <select
                  className="w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-2 py-2 text-[11px] text-zinc-300"
                  value={settings.ai_model}
                  onChange={(e) => onPatch({ ai_model: e.target.value })}
                >
                  <option value="meshy-6">Meshy 6</option>
                  <option value="latest">Latest</option>
                  <option value="meshy-5">Meshy 5</option>
                </select>
                <div className="flex gap-1">
                  {(['standard', 'lowpoly'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onPatch({ model_type: m })}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold ${
                        settings.model_type === m
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                          : 'border border-white/[0.08] text-zinc-500'
                      }`}
                    >
                      {m === 'lowpoly' ? 'Low poly' : 'Standard'}
                    </button>
                  ))}
                </div>
                <label className="text-[10px] text-zinc-500">Target polycount</label>
                <input
                  type="number"
                  min={1000}
                  max={300000}
                  className="w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-2 py-2 text-[11px]"
                  value={settings.target_polycount}
                  onChange={(e) => onPatch({ target_polycount: Number(e.target.value) || 5000 })}
                />
                <label className="text-[10px] text-zinc-500">Polycount mode</label>
                <div className="flex gap-1">
                  {(['fixed', 'adaptive'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onPatch({ polycount_mode: m })}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold ${
                        settings.polycount_mode === m
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                          : 'border border-white/[0.08] text-zinc-500'
                      }`}
                    >
                      {m === 'adaptive' ? 'Adaptive' : 'Fixed'}
                    </button>
                  ))}
                </div>
                <label className="text-[10px] text-zinc-500">Pose</label>
                <select
                  className="w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-2 py-2 text-[11px] text-zinc-300"
                  value={settings.pose_mode}
                  onChange={(e) =>
                    onPatch({ pose_mode: e.target.value as MeshySettings['pose_mode'] })
                  }
                >
                  <option value="">None</option>
                  <option value="a-pose">A-Pose</option>
                  <option value="t-pose">T-Pose</option>
                </select>
                <Toggle label="Remesh" on={settings.should_remesh} onChange={(v) => onPatch({ should_remesh: v })} />
                <Toggle label="Auto size" on={settings.auto_size} onChange={(v) => onPatch({ auto_size: v })} />
                {meshyPhase === 'refine' ? (
                  <>
                    <Toggle label="PBR maps" on={settings.enable_pbr} onChange={(v) => onPatch({ enable_pbr: v })} />
                    <Toggle label="HD texture (4K)" on={settings.hd_texture} onChange={(v) => onPatch({ hd_texture: v })} />
                    <Toggle label="Remove lighting" on={settings.remove_lighting} onChange={(v) => onPatch({ remove_lighting: v })} />
                  </>
                ) : null}
              </div>
            </details>

            {latestGlbUrl && onDownloadGlb ? (
              <button
                type="button"
                onClick={onDownloadGlb}
                className="w-full py-2 rounded-lg border border-orange-500/30 text-[11px] font-semibold text-orange-400"
              >
                Download latest GLB
              </button>
            ) : null}
          </>
        )}
      </div>

      {!embedded && tool === 'text-to-3d' && (
        <footer className="shrink-0 p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-2">
          {isGenerating && (
            <div className="text-[10px] text-center" style={{ color: 'var(--solar-cyan)' }}>
              {(progressPct ?? 0) >= 92 ? 'Finalizing' : 'Generating'}
              {progressPct != null ? ` · ${progressPct}%` : '…'}
            </div>
          )}
          <button
            type="button"
            disabled={isGenerating}
            onClick={onCreate}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[13px] disabled:opacity-50"
            style={{
              background: 'linear-gradient(90deg, var(--solar-cyan), var(--solar-violet))',
              color: 'var(--bg-app)',
            }}
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {meshyPhase === 'preview' ? 'Create Preview' : 'Create Refine'}
            <span className="opacity-70 text-[11px]">· {ctaCost} cr</span>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={onQuickGenerate}
            className="w-full py-2 text-[11px] font-medium text-muted hover:text-main"
          >
            Quick: preview + refine chain
          </button>
        </footer>
      )}
    </>
  );

  if (embedded) return inner;

  return (
    <aside
      className={`flex flex-col min-h-0 border-[var(--border-subtle)] border-b md:border-b-0 md:border-r bg-[var(--bg-panel)] ${className}`}
    >
      {inner}
    </aside>
  );
}
