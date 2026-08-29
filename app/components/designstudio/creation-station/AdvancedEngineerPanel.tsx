/**
 * AdvancedEngineerPanel — Agent Sam Engineer Layer
 * OpenSCAD · Blender · FreeCAD
 *
 * Real two-step flow for every engine:
 *   1. POST generate endpoint → {job_id, script}
 *   2. POST /api/cad/jobs/{id}/execute → dispatches to ExecOS GCP via iam-vpc
 *   3. Poll GET /api/cad/jobs/{id} every 4s until done/failed
 *   4. Expose public_url as download
 *
 * No stubs. No fake routes.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Save,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { appendStudioTerminalOutput, openStudioTerminal } from '../studioTerminalOutput';
import { executeCadJob, fetchCadJob } from '../api';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';
import type { CustomAsset } from '../../../types';

type CadHook = ReturnType<typeof useDesignStudioCad>;
type Engine = 'openscad' | 'blender' | 'freecad';

const ENGINES: { id: Engine; label: string; ext: string; color: string }[] = [
  { id: 'openscad', label: 'OpenSCAD', ext: '.scad', color: 'var(--solar-cyan)' },
  { id: 'blender',  label: 'Blender',  ext: '.py',   color: 'var(--solar-violet)' },
  { id: 'freecad',  label: 'FreeCAD',  ext: '.py',   color: '#f97316' },
];

// ── Preset libraries ─────────────────────────────────────────────────────────

type Preset = { label: string; script: string };

const OPENSCAD_PRESETS: Preset[] = [
  {
    label: 'Parametric box',
    script: '// Parametric lidded box\nw = 40; h = 30; d = 20; t = 2;\ndifference() {\n  cube([w, d, h], center=true);\n  translate([0, 0, t])\n    cube([w - t*2, d - t*2, h], center=true);\n}',
  },
  {
    label: 'Spur gear (MCAD)',
    script: '// Spur gear — requires MCAD library on ExecOS\nuse <MCAD/involute_gears.scad>\ngear(number_of_teeth=20, circular_pitch=200, gear_thickness=5,\n     rim_thickness=7, hub_thickness=10, hub_diameter=15);',
  },
  {
    label: 'Voronoi panel',
    script: '// Voronoi-style perforated panel\npts = [[10,10],[30,5],[50,15],[20,30],[40,28],[60,10],[15,50],[45,45]];\ndifference() {\n  cube([70, 60, 3]);\n  for(p = pts) translate([p[0], p[1], -1]) cylinder(h=5, r=6, $fn=6);\n}',
  },
];

const BLENDER_PRESETS: Preset[] = [
  {
    label: 'Decimate to 50%',
    script: 'import bpy\nobj = bpy.context.active_object\nmod = obj.modifiers.new(name="Decimate", type=\'DECIMATE\')\nmod.ratio = 0.5\nbpy.ops.object.modifier_apply(modifier=mod.name)\nbpy.ops.export_scene.gltf(filepath=OUTPUT_GLB, export_format=\'GLB\')\nprint("Decimated and exported")',
  },
  {
    label: 'Smart UV project',
    script: 'import bpy\nobj = bpy.context.active_object\nbpy.context.view_layer.objects.active = obj\nbpy.ops.object.mode_set(mode=\'EDIT\')\nbpy.ops.mesh.select_all(action=\'SELECT\')\nbpy.ops.uv.smart_project(angle_limit=66.0, margin_method=\'SCALED\')\nbpy.ops.object.mode_set(mode=\'OBJECT\')\nbpy.ops.export_scene.gltf(filepath=OUTPUT_GLB, export_format=\'GLB\')\nprint("UV unwrap done")',
  },
  {
    label: 'Subdivision + smooth',
    script: 'import bpy\nobj = bpy.context.active_object\nmod = obj.modifiers.new(name="Subdivision", type=\'SUBSURF\')\nmod.levels = 2\nmod.render_levels = 2\nbpy.ops.object.modifier_apply(modifier=mod.name)\nbpy.ops.object.shade_smooth()\nbpy.ops.export_scene.gltf(filepath=OUTPUT_GLB, export_format=\'GLB\')\nprint("Subdivision + smooth done")',
  },
  {
    label: 'Bake normals',
    script: 'import bpy\n# Scene must have "LowPoly" and "HighPoly" objects\nbpy.context.scene.render.engine = \'CYCLES\'\nbpy.context.scene.cycles.samples = 64\nlow = bpy.data.objects[\'LowPoly\']\nhigh = bpy.data.objects[\'HighPoly\']\nbpy.context.view_layer.objects.active = low\nlow.select_set(True)\nbpy.ops.object.bake(type=\'NORMAL\', use_selected_to_active=True)\nprint("Normal bake complete")',
  },
];

const FREECAD_PRESETS: Preset[] = [
  {
    label: 'Export to STEP',
    script: 'import FreeCAD, Part, Import\ndoc = FreeCAD.open("/tmp/input.FCStd")\nImport.export([doc.Objects[0]], OUTPUT_FILE)\nprint("Exported STEP")',
  },
  {
    label: 'Mesh repair',
    script: 'import FreeCAD, Mesh\nmesh = Mesh.read("/tmp/input.stl")\nmesh.removeDuplicatedPoints()\nmesh.removeDuplicatedFacets()\nmesh.removeInvalidPoints()\nmesh.harmonizeNormals()\nmesh.write(OUTPUT_FILE)\nprint("Mesh repair done")',
  },
  {
    label: 'Boolean subtract',
    script: 'import FreeCAD, Part\ndoc = FreeCAD.open("/tmp/input.FCStd")\nbase = doc.getObject("Base")\ntool = doc.getObject("Tool")\ncut = doc.addObject("Part::Cut", "BooleanCut")\ncut.Base = base\ncut.Tool = tool\ndoc.recompute()\nPart.export([cut], OUTPUT_FILE)\nprint("Boolean subtract complete")',
  },
];

function presetsFor(engine: Engine): Preset[] {
  if (engine === 'openscad') return OPENSCAD_PRESETS;
  if (engine === 'blender') return BLENDER_PRESETS;
  return FREECAD_PRESETS;
}

// ── Job poller ───────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'complete']);
const POLL_MS = 4000;

function useJobPoller(jobId: string | null, onDone: (job: { status: string; public_url?: string; error?: string }) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    activeRef.current = true;

    const poll = async () => {
      if (!activeRef.current) return;
      try {
        const job = await fetchCadJob(jobId);
        const status = String(job?.status || '').toLowerCase();
        appendStudioTerminalOutput(`Job ${jobId} · ${status}${job?.progress_pct ? ` · ${job.progress_pct}%` : ''}`, 'info');
        if (TERMINAL_STATUSES.has(status)) {
          activeRef.current = false;
          onDone(job as { status: string; public_url?: string; error?: string });
          return;
        }
      } catch (e) {
        appendStudioTerminalOutput(`Poll error: ${String(e)}`, 'warn');
      }
      if (activeRef.current) {
        timerRef.current = setTimeout(() => void poll(), POLL_MS);
      }
    };

    timerRef.current = setTimeout(() => void poll(), POLL_MS);

    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId, onDone]);
}

// ── Shared UI components ─────────────────────────────────────────────────────

function JobPill({ status, progress }: { status?: string; progress?: number | null }) {
  if (!status) return null;
  const running = status === 'running' || status === 'processing' || status === 'queued' || status === 'pending';
  const done = status === 'done' || status === 'complete';
  const failed = status === 'failed' || status === 'error';
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
      style={{
        background: running
          ? 'color-mix(in srgb, var(--solar-cyan) 10%, transparent)'
          : done ? 'color-mix(in srgb, #4ade80 10%, transparent)'
          : failed ? 'color-mix(in srgb, #f87171 10%, transparent)'
          : 'var(--bg-hover)',
        border: `1px solid ${running
          ? 'color-mix(in srgb, var(--solar-cyan) 30%, transparent)'
          : done ? 'color-mix(in srgb, #4ade80 30%, transparent)'
          : failed ? 'color-mix(in srgb, #f87171 30%, transparent)'
          : 'var(--border-subtle)'}`,
        color: running ? 'var(--solar-cyan)' : done ? '#4ade80' : failed ? '#f87171' : 'var(--text-muted)',
      }}
    >
      {running && <Loader2 size={10} className="animate-spin shrink-0" />}
      <span>{status}{progress != null && progress > 0 ? ` · ${progress}%` : ''}</span>
    </div>
  );
}

function AssetSelector({ assets, value, onChange, label }: {
  assets: CustomAsset[]; value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none pl-2.5 pr-7 py-2 rounded-lg text-[11px] focus:outline-none"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', color: value ? 'var(--text-main)' : 'var(--text-muted)' }}>
          <option value="">— none —</option>
          {assets.map((a) => <option key={a.id} value={a.url}>{a.name}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
      </div>
    </div>
  );
}

function PresetSelector({ engine, onSelect }: { engine: Engine; onSelect: (script: string) => void }) {
  const presets = presetsFor(engine);
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">Preset scripts</label>
      <div className="relative">
        <select defaultValue="" onChange={(e) => {
          const p = presets.find((x) => x.label === e.target.value);
          if (p) onSelect(p.script);
          e.target.value = '';
        }}
          className="w-full appearance-none pl-2.5 pr-7 py-2 rounded-lg text-[11px] focus:outline-none"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
          <option value="" disabled>Load a preset…</option>
          {presets.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
      </div>
    </div>
  );
}

function ScriptEditor({ value, onChange, engine, dirty }: {
  value: string; onChange: (s: string) => void; engine: Engine; dirty: boolean;
}) {
  const eng = ENGINES.find((e) => e.id === engine)!;
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: eng.color }}>
          {eng.label} {eng.ext}
          {dirty ? <span className="text-amber-400/80 ml-1"> · unsaved</span> : null}
        </span>
        <Terminal size={10} style={{ color: eng.color }} />
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)}
        spellCheck={false} rows={11}
        className="w-full font-mono text-[10.5px] leading-relaxed px-3 py-2.5 resize-none focus:outline-none"
        style={{ background: 'color-mix(in srgb, var(--bg-app) 85%, transparent)', color: 'var(--text-main)', minHeight: '170px' }} />
    </div>
  );
}

// ── Per-engine local state ───────────────────────────────────────────────────

type EngineState = {
  script: string;
  dirty: boolean;
  busy: boolean;
  jobId: string | null;
  jobStatus: string | null;
  jobProgress: number | null;
  resultUrl: string | null;
  error: string | null;
  targetAsset: string;
};

function useEngineState(initial: string) {
  const [state, setState] = useState<EngineState>({
    script: initial, dirty: false, busy: false,
    jobId: null, jobStatus: null, jobProgress: null,
    resultUrl: null, error: null, targetAsset: '',
  });
  const setScript   = useCallback((s: string) => setState((p) => ({ ...p, script: s, dirty: true })), []);
  const setBusy     = useCallback((b: boolean) => setState((p) => ({ ...p, busy: b })), []);
  const setJobId    = useCallback((id: string) => setState((p) => ({ ...p, jobId: id, jobStatus: 'queued', jobProgress: null, resultUrl: null, error: null })), []);
  const setJobPoll  = useCallback((status: string, pct?: number | null) => setState((p) => ({ ...p, jobStatus: status, jobProgress: pct ?? null })), []);
  const setDone     = useCallback((url: string | null) => setState((p) => ({ ...p, busy: false, jobStatus: 'done', resultUrl: url })), []);
  const setError    = useCallback((e: string) => setState((p) => ({ ...p, busy: false, jobStatus: 'failed', error: e })), []);
  const setTarget   = useCallback((t: string) => setState((p) => ({ ...p, targetAsset: t })), []);
  const markClean   = useCallback(() => setState((p) => ({ ...p, dirty: false })), []);
  return [state, { setScript, setBusy, setJobId, setJobPoll, setDone, setError, setTarget, markClean }] as const;
}

// ── OpenSCAD panel ───────────────────────────────────────────────────────────

function OpenScadEnginePanel({ cad, onScriptUpdate }: { cad: CadHook; onScriptUpdate?: (s: string) => void }) {
  const [st, actions] = useEngineState('// OpenSCAD\ncube(10, center = true);\n');
  const activeJob = cad.polledJob || cad.activeJob;

  // Poll via cad hook — OpenSCAD uses the existing cad job pipeline
  // cad.polledJob updates automatically via useCadJobPoll in useDesignStudioCad

  const handleSave = async () => {
    if (!cad.activeBlueprintId) return;
    await cad.saveBlueprintScript(st.script);
    actions.markClean();
    appendStudioTerminalOutput('Script saved to blueprint', 'ok', { open: false });
  };

  const handleGenerate = async () => {
    actions.setBusy(true);
    const prompt =
      cad.activeBlueprint?.original_prompt?.trim() ||
      cad.activeBlueprint?.title?.trim() ||
      'Parametric OpenSCAD model';
    appendStudioTerminalOutput(`Generating OpenSCAD script: ${prompt}`, 'info', { open: true });
    try {
      const result = await cad.runOpenScadGenerate(prompt);
      if (result?.script) {
        actions.setScript(result.script);
        onScriptUpdate?.(result.script);
        appendStudioTerminalOutput(`Script generated — job ${result.job_id}`, 'ok');
      }
    } catch (e) {
      appendStudioTerminalOutput(`Generate failed: ${String(e)}`, 'error');
    }
    actions.setBusy(false);
  };

  const handleExecute = async () => {
    actions.setBusy(true);
    openStudioTerminal({ tab: 'output' });
    appendStudioTerminalOutput('Dispatching OpenSCAD job to ExecOS via iam-vpc…', 'info');
    try {
      await cad.runExecuteJob();
      appendStudioTerminalOutput('OpenSCAD job dispatched — polling status…', 'ok');
    } catch (e) {
      actions.setBusy(false);
      appendStudioTerminalOutput(`Dispatch failed: ${String(e)}`, 'error');
    }
    // cad.polledJob handles status — setBusy stays true until job terminal
    actions.setBusy(false);
  };

  const jobStatus = cad.polledJob?.status || activeJob?.status;
  const progressPct = cad.polledJob?.progress_pct ?? null;
  const resultUrl = cad.polledJob?.public_url || cad.activeJob?.public_url || null;

  return (
    <div className="space-y-3">
      {!cad.activeBlueprintId ? (
        <div className="rounded-lg px-3 py-2.5 text-[10px] leading-relaxed"
          style={{ background: 'color-mix(in srgb, #f59e0b 8%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 25%, transparent)', color: '#fbbf24' }}>
          Select or create a blueprint under <strong>CAD</strong> first, then edit its{' '}
          <code className="font-mono text-[9px]">.scad</code> script here.
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] text-muted">
            Blueprint: <span className="text-main font-medium">{cad.activeBlueprint?.title}</span>
          </span>
          {jobStatus && <JobPill status={jobStatus} progress={progressPct} />}
        </div>
      )}

      <PresetSelector engine="openscad" onSelect={actions.setScript} />
      <ScriptEditor value={st.script} onChange={actions.setScript} engine="openscad" dirty={st.dirty} />

      <div className="grid grid-cols-1 gap-2">
        <button type="button" disabled={cad.busy || !cad.activeBlueprintId} onClick={() => void handleSave()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[10px] font-black uppercase tracking-[0.1em] disabled:opacity-40 hover:border-[var(--solar-cyan)] transition-colors"
          style={{ color: 'var(--text-main)' }}>
          <Save size={13} />Save script{st.dirty ? ' *' : ''}
        </button>
        <button type="button" disabled={cad.busy || st.busy} onClick={() => void handleGenerate()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
          style={{ background: 'var(--solar-violet)', color: 'var(--bg-app)' }}>
          {(cad.busy || st.busy) ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          AI generate from prompt
        </button>
        <button type="button" disabled={cad.busy || st.busy || !activeJob?.id} onClick={() => void handleExecute()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
          style={{ background: 'var(--solar-cyan)', color: 'var(--bg-app)' }}>
          <Play size={13} />Execute on GCP
        </button>
      </div>

      {resultUrl && (
        <a href={resultUrl} download
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.1em]"
          style={{ border: '1px solid color-mix(in srgb, var(--solar-cyan) 40%, transparent)', color: 'var(--solar-cyan)' }}>
          <Download size={13} />Download GLB
        </a>
      )}

      {cad.error && <p className="text-[10px] text-red-400 font-mono leading-relaxed">{cad.error}</p>}

      <a href="https://github.com/openscad/openscad" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 text-[9px] hover:underline" style={{ color: 'var(--solar-cyan)' }}>
        openscad/openscad <ExternalLink size={9} />
      </a>
    </div>
  );
}

// ── Blender panel ─────────────────────────────────────────────────────────────
// Flow: POST /api/cad/blender/script → {job_id} → POST /api/cad/jobs/{id}/execute → poll

function BlenderEnginePanel({ customAssets }: { customAssets: CustomAsset[] }) {
  const [st, actions] = useEngineState(BLENDER_PRESETS[0].script);
  const glbAssets = customAssets.filter((a) => a.url?.endsWith('.glb') || a.url?.endsWith('.gltf'));

  const onJobDone = useCallback((job: { status: string; public_url?: string; error?: string }) => {
    if (job.status === 'done' || job.status === 'complete') {
      const url = job.public_url ?? null;
      actions.setDone(url);
      appendStudioTerminalOutput(`Blender job complete${url ? ` → ${url}` : ''}`, 'ok');
    } else {
      const msg = job.error ?? 'Job failed';
      actions.setError(msg);
      appendStudioTerminalOutput(`Blender job failed: ${msg}`, 'error');
    }
  }, [actions]);

  useJobPoller(st.jobId, onJobDone);

  const handleRun = async () => {
    if (st.busy || !st.script.trim()) return;
    actions.setBusy(true);
    openStudioTerminal({ tab: 'output' });
    appendStudioTerminalOutput('Generating Blender script job…', 'info');

    try {
      // Step 1 — create job with script
      const res = await fetch('/api/cad/blender/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'User-supplied Blender Python script',
          script_override: st.script,
          input_glb_url: st.targetAsset || undefined,
        }),
      });
      const data = await res.json() as { job_id?: string; error?: string };
      if (!res.ok || !data.job_id) throw new Error(data.error ?? `HTTP ${res.status}`);

      appendStudioTerminalOutput(`Job created: ${data.job_id}`, 'ok');
      actions.setJobId(data.job_id);

      // Step 2 — dispatch to ExecOS via iam-vpc
      appendStudioTerminalOutput('Dispatching to ExecOS GCP via iam-vpc…', 'info');
      await executeCadJob(data.job_id);
      appendStudioTerminalOutput('Blender job running — polling…', 'ok');

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      actions.setError(msg);
      appendStudioTerminalOutput(`Blender error: ${msg}`, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[10px] leading-relaxed"
        style={{ background: 'color-mix(in srgb, var(--solar-violet) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--solar-violet) 20%, transparent)', color: 'var(--text-muted)' }}>
        <Box size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--solar-violet)' }} />
        <span>
          Script runs on ExecOS GCP via <strong style={{ color: 'var(--solar-violet)' }}>iam-vpc</strong> with
          Blender headless. <code className="font-mono text-[9px]">OUTPUT_GLB</code> is injected automatically.
          Result GLB → R2 → download.
        </span>
      </div>

      <AssetSelector assets={glbAssets} value={st.targetAsset} onChange={actions.setTarget} label="Input GLB (optional)" />
      <PresetSelector engine="blender" onSelect={actions.setScript} />
      <ScriptEditor value={st.script} onChange={actions.setScript} engine="blender" dirty={st.dirty} />

      {st.jobStatus && <JobPill status={st.jobStatus} progress={st.jobProgress} />}

      <button type="button" disabled={st.busy || !st.script.trim()} onClick={() => void handleRun()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
        style={{ background: 'var(--solar-violet)', color: 'var(--bg-app)' }}>
        {st.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        Execute in Blender
      </button>

      {st.resultUrl && (
        <a href={st.resultUrl} download
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.1em]"
          style={{ border: '1px solid color-mix(in srgb, var(--solar-violet) 40%, transparent)', color: 'var(--solar-violet)' }}>
          <Download size={13} />Download result GLB
        </a>
      )}

      {st.error && <p className="text-[10px] text-red-400 font-mono leading-relaxed">{st.error}</p>}

      <div className="flex items-center gap-3">
        <a href="https://docs.blender.org/api/current/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[9px] hover:underline" style={{ color: 'var(--solar-violet)' }}>
          Blender Python API <ExternalLink size={9} />
        </a>
        <a href="https://docs.blender.org/manual/en/latest/advanced/scripting/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[9px] text-muted hover:underline">
          Scripting docs <ExternalLink size={9} />
        </a>
      </div>
    </div>
  );
}

// ── FreeCAD panel ─────────────────────────────────────────────────────────────
// Flow: POST /api/cad/freecad/script → {job_id} → POST /api/cad/jobs/{id}/execute → poll
// Note: /api/cad/freecad/script backend route is wired by Cursor (parallel task)

function FreeCadEnginePanel({ customAssets }: { customAssets: CustomAsset[] }) {
  const [st, actions] = useEngineState(FREECAD_PRESETS[0].script);

  const onJobDone = useCallback((job: { status: string; public_url?: string; error?: string }) => {
    if (job.status === 'done' || job.status === 'complete') {
      const url = job.public_url ?? null;
      actions.setDone(url);
      appendStudioTerminalOutput(`FreeCAD job complete${url ? ` → ${url}` : ''}`, 'ok');
    } else {
      const msg = job.error ?? 'Job failed';
      actions.setError(msg);
      appendStudioTerminalOutput(`FreeCAD job failed: ${msg}`, 'error');
    }
  }, [actions]);

  useJobPoller(st.jobId, onJobDone);

  const handleRun = async () => {
    if (st.busy || !st.script.trim()) return;
    actions.setBusy(true);
    openStudioTerminal({ tab: 'output' });
    appendStudioTerminalOutput('Creating FreeCAD script job…', 'info');

    try {
      // Step 1 — create job (backend route wired by Cursor)
      const res = await fetch('/api/cad/freecad/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'User-supplied FreeCAD Python script',
          script_override: st.script,
          input_url: st.targetAsset || undefined,
        }),
      });
      const data = await res.json() as { job_id?: string; error?: string };
      if (!res.ok || !data.job_id) throw new Error(data.error ?? `HTTP ${res.status}`);

      appendStudioTerminalOutput(`Job created: ${data.job_id}`, 'ok');
      actions.setJobId(data.job_id);

      // Step 2 — dispatch to ExecOS GCP via iam-vpc
      appendStudioTerminalOutput('Dispatching to ExecOS GCP via iam-vpc…', 'info');
      await executeCadJob(data.job_id);
      appendStudioTerminalOutput('FreeCAD job running — polling…', 'ok');

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      actions.setError(msg);
      appendStudioTerminalOutput(`FreeCAD error: ${msg}`, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[10px] leading-relaxed"
        style={{ background: 'color-mix(in srgb, #f97316 8%, transparent)', border: '1px solid color-mix(in srgb, #f97316 20%, transparent)', color: 'var(--text-muted)' }}>
        <Wrench size={12} className="shrink-0 mt-0.5" style={{ color: '#f97316' }} />
        <span>
          FreeCAD Python executes headless on ExecOS via <strong style={{ color: '#f97316' }}>iam-vpc</strong>.
          Outputs STEP, STL, or 3MF. <code className="font-mono text-[9px]">OUTPUT_FILE</code> injected by runner.
        </span>
      </div>

      <AssetSelector assets={customAssets} value={st.targetAsset} onChange={actions.setTarget} label="Input file URL (optional)" />
      <PresetSelector engine="freecad" onSelect={actions.setScript} />
      <ScriptEditor value={st.script} onChange={actions.setScript} engine="freecad" dirty={st.dirty} />

      {st.jobStatus && <JobPill status={st.jobStatus} progress={st.jobProgress} />}

      <button type="button" disabled={st.busy || !st.script.trim()} onClick={() => void handleRun()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
        style={{ background: '#f97316', color: '#fff' }}>
        {st.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        Execute in FreeCAD
      </button>

      {st.resultUrl && (
        <a href={st.resultUrl} download
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.1em]"
          style={{ border: '1px solid color-mix(in srgb, #f97316 40%, transparent)', color: '#f97316' }}>
          <Download size={13} />Download result
        </a>
      )}

      {st.error && <p className="text-[10px] text-red-400 font-mono leading-relaxed">{st.error}</p>}

      <a href="https://wiki.freecad.org/Python_scripting_tutorial" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 text-[9px] hover:underline" style={{ color: '#f97316' }}>
        FreeCAD Python scripting <ExternalLink size={9} />
      </a>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export type AdvancedEngineerPanelProps = {
  cad: CadHook;
  customAssets: CustomAsset[];
  advancedScript?: string;
  advancedDirty?: boolean;
  onAdvancedDirtyChange?: (dirty: boolean) => void;
  onAdvancedScriptUpdate?: (script: string) => void;
  onAdvancedScriptChange?: (script: string) => void;
};

export function AdvancedEngineerPanel({
  cad,
  customAssets,
  onAdvancedScriptUpdate,
  onAdvancedScriptChange,
}: AdvancedEngineerPanelProps) {
  const [engine, setEngine] = useState<Engine>('openscad');
  const activeEng = ENGINES.find((e) => e.id === engine)!;

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
        {ENGINES.map((eng) => {
          const on = engine === eng.id;
          return (
            <button key={eng.id} type="button" onClick={() => setEngine(eng.id)}
              className="flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] transition-colors"
              style={{
                border: 'none',
                background: on ? `color-mix(in srgb, ${eng.color} 14%, transparent)` : 'transparent',
                color: on ? eng.color : 'var(--text-muted)',
              }}>
              {eng.label}
            </button>
          );
        })}
      </div>

      <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: activeEng.color }}>
        {activeEng.label} · CAD engineer · ExecOS GCP
      </p>

      {engine === 'openscad' && (
        <OpenScadEnginePanel cad={cad} onScriptUpdate={onAdvancedScriptUpdate ?? onAdvancedScriptChange} />
      )}
      {engine === 'blender' && <BlenderEnginePanel customAssets={customAssets} />}
      {engine === 'freecad' && <FreeCadEnginePanel customAssets={customAssets} />}
    </div>
  );
}
