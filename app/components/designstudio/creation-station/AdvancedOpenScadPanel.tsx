import React from 'react';
import { ExternalLink, Loader2, Play, Save, Sparkles } from 'lucide-react';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';

export const OPENSCAD_REPO = 'https://github.com/openscad/openscad';

export const DEFAULT_SCAD = `// OpenSCAD — The Programmer's Solid 3D CAD Modeller
// https://github.com/openscad/openscad
//
// Edit parametric CSG here, then Save → Generate → Execute on ExecOS GCP.

cube(10, center = true);
`;

type CadHook = ReturnType<typeof useDesignStudioCad>;

type ActionsProps = {
  cad: CadHook;
  script: string;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onScriptUpdate?: (script: string) => void;
  onScriptChange?: (script: string) => void;
};

export function AdvancedOpenScadActions({
  cad,
  script,
  dirty,
  onDirtyChange,
  onScriptUpdate,
  onScriptChange,
}: ActionsProps) {
  const activeJob = cad.polledJob || cad.activeJob;

  const handleSave = async () => {
    if (!cad.activeBlueprintId) return;
    await cad.saveBlueprintScript(script);
    onDirtyChange(false);
  };

  const handleGenerate = async () => {
    const prompt =
      cad.activeBlueprint?.original_prompt?.trim() ||
      cad.activeBlueprint?.title?.trim() ||
      'Parametric OpenSCAD model';
    const result = await cad.runOpenScadGenerate(prompt);
    if (result?.script) {
      onScriptUpdate?.(result.script);
      onDirtyChange(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-main">OpenSCAD Advanced</p>
          <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
            Code on the left, 3D preview on the right — like{' '}
            <a
              href={OPENSCAD_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--solar-cyan)] hover:underline"
            >
              OpenSCAD
            </a>
            . Renders on ExecOS GCP, not in-browser.
          </p>
        </div>
        <a
          href={OPENSCAD_REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-[var(--solar-cyan)] hover:underline"
        >
          GitHub
          <ExternalLink size={11} />
        </a>
      </div>

      {!cad.activeBlueprintId ? (
        <p className="text-[11px] text-amber-400/90 rounded-lg px-3 py-2 border border-amber-500/25 bg-amber-500/10">
          Create or select a blueprint under CAD first, then edit its{' '}
          <code className="font-mono text-[10px]">.scad</code> script here.
        </p>
      ) : (
        <p className="text-[10px] text-muted">
          Blueprint: <span className="text-main">{cad.activeBlueprint?.title}</span>
          {dirty ? <span className="text-amber-400/90"> · unsaved</span> : null}
        </p>
      )}

      {onScriptChange ? (
        <textarea
          value={script}
          onChange={(e) => {
            onScriptChange(e.target.value);
            onDirtyChange(true);
          }}
          spellCheck={false}
          className="md:hidden w-full min-h-[200px] font-mono text-[11px] leading-relaxed rounded-xl px-3 py-2 resize-y focus:outline-none"
          style={{
            background: 'var(--bg-hover)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-main)',
          }}
          aria-label="OpenSCAD script editor (mobile)"
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={cad.busy || !cad.activeBlueprintId}
          onClick={() => void handleSave()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[10px] font-black uppercase disabled:opacity-40"
        >
          <Save size={14} />
          Save script
          {dirty ? ' *' : ''}
        </button>
        <button
          type="button"
          disabled={cad.busy}
          onClick={() => void handleGenerate()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-40"
          style={{ background: 'var(--solar-violet)', color: 'var(--bg-app)' }}
        >
          {cad.busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Generate from prompt
        </button>
        <button
          type="button"
          disabled={cad.busy || !activeJob?.id}
          onClick={() => void cad.runExecuteJob()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-40"
          style={{ background: 'var(--solar-cyan)', color: 'var(--bg-app)' }}
        >
          <Play size={14} />
          Execute on GCP
          {activeJob?.status ? ` (${activeJob.status})` : ''}
        </button>
      </div>

      {cad.error ? <p className="text-[10px] text-red-400">{cad.error}</p> : null}
    </div>
  );
}

export function OpenScadEditorStrip({
  script,
  onChange,
}: {
  script: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-muted">
          OpenSCAD
        </span>
        <a
          href={OPENSCAD_REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] font-semibold text-[var(--solar-cyan)] hover:underline flex items-center gap-1"
        >
          openscad/openscad
          <ExternalLink size={10} />
        </a>
      </div>
      <textarea
        value={script}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 w-full font-mono text-[11px] leading-relaxed px-3 py-2 resize-none focus:outline-none bg-[var(--bg-hover)] text-main"
        aria-label="OpenSCAD script"
      />
    </div>
  );
}
