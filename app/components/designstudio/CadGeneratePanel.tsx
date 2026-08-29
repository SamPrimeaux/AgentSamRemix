import React, { useState } from 'react';
import { Box, Sparkles, Upload } from 'lucide-react';
import type { BlueprintRow } from './api';
import { MeshyPlatformNotice } from './creation-station/MeshyPlatformNotice';

type Props = {
  activeBlueprint: BlueprintRow | null;
  busy?: boolean;
  meshyStub?: boolean;
  onGenerateOpenScad: (prompt?: string) => Promise<unknown>;
  onExecuteJob: () => Promise<unknown>;
  onMeshyGenerate: (prompt: string) => Promise<unknown>;
  onImportGlb?: (file: File) => void;
  activeJobStatus?: string | null;
};

export function CadGeneratePanel({
  activeBlueprint,
  busy,
  meshyStub,
  onGenerateOpenScad,
  onExecuteJob,
  onMeshyGenerate,
  onImportGlb,
  activeJobStatus,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const defaultPrompt =
    activeBlueprint?.original_prompt?.trim() || activeBlueprint?.title?.trim() || '';

  const canExecute = activeJobStatus === 'script_ready';

  return (
    <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-[var(--solar-violet)]" />
        <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
          Generate
        </p>
      </div>

      {meshyStub && <MeshyPlatformNotice stub className="text-[10px]" />}

      <textarea
        placeholder={defaultPrompt || 'Describe what to build…'}
        rows={3}
        className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[11px] resize-none"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
      />

      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onGenerateOpenScad(prompt.trim() || defaultPrompt)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--solar-cyan)] text-black text-[10px] font-black uppercase disabled:opacity-40"
        >
          <Sparkles size={14} />
          Generate OpenSCAD
        </button>
        <button
          type="button"
          disabled={busy || !canExecute}
          onClick={() => void onExecuteJob()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] text-[10px] font-black uppercase disabled:opacity-30"
          title={canExecute ? 'Dispatch to ExecOS GCP (iam-tunnel)' : 'Generate OpenSCAD first'}
        >
          Execute on ExecOS GCP
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onMeshyGenerate(prompt.trim() || defaultPrompt)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-black uppercase hover:border-[var(--solar-cyan)]/30 disabled:opacity-40"
        >
          <Box size={14} className="text-[var(--solar-cyan)]" />
          Meshy Text → 3D
        </button>
        {onImportGlb && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".glb"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportGlb(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-black uppercase"
            >
              <Upload size={14} />
              Import GLB
            </button>
          </>
        )}
      </div>
    </section>
  );
}
