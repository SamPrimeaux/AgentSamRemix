/**
 * Creation Lane — left slide panel with 3 tabs:
 * MODEL  (Meshy text→3D, Meshy image→3D)
 * BUILD  (Blender · OpenSCAD · FreeCAD — describe → script → run)
 * SCENE  (primitives, environment presets, import GLB)
 *
 * NO chat dispatch on any button. Jobs fire directly via API.
 */
import React, { useRef, useState } from 'react';
import {
  Sparkles, Image, Box, Cpu, Ruler, Home,
  Play, Download, RefreshCw, ChevronDown, ChevronRight,
  Layers, Sun, Camera, Plus,
} from 'lucide-react';
import { dispatchGenerateCadObject } from './dispatchCadChat';
import {
  DEFAULT_MESHY_SETTINGS,
  buildMeshyPreviewBody,
  type MeshyPoseMode,
  MESHY_PROMPT_MAX,
} from '../creation-station/meshyTypes';

type CreationTab = 'model' | 'build' | 'scene';
type BuildEngine = 'blender' | 'openscad' | 'freecad';

const DEFAULT_PROMPT = '';

export type CreationLaneProps = {
  open: boolean;
  onClose: () => void;
  workspace: string;
  sceneId: string | null;
  selectedObjectId: string | null;
  onSpawnPrimitive: (type: 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'light' | 'camera') => void;
  onImportGlb: () => void;
  onRunBlenderScript: (script: string) => void;
  onRunOpenSCAD: (code: string) => void;
  onRunFreeCAD: (code: string) => void;
  onSnapView?: (face: string) => void;
  onToggleOrtho?: (ortho: boolean) => void;
  onMeshyTextTo3d?: (opts: {
    prompt: string;
    pose_mode: MeshyPoseMode;
    model_type: 'standard' | 'lowpoly';
    ai_model: string;
  }) => void | Promise<void>;
};

function SectionHead({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="cl__section-head">
      <Icon size={13} strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cl__field">
      <span className="cl__field-label">{label}</span>
      <div className="cl__field-control">{children}</div>
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="cl__select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ActionBtn({ label, icon: Icon, onClick, accent, disabled }: {
  label: string; icon?: React.ElementType; onClick: () => void; accent?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={['cl__btn', accent ? 'cl__btn--accent' : ''].filter(Boolean).join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon size={13} strokeWidth={1.75} />}
      {label}
    </button>
  );
}

// ── MODEL TAB ────────────────────────────────────────────────────────────────
function ModelTab({
  workspace,
  sceneId,
  onMeshyTextTo3d,
}: {
  workspace: string;
  sceneId: string | null;
  onMeshyTextTo3d?: CreationLaneProps['onMeshyTextTo3d'];
}) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [modelType, setModelType] = useState('standard');
  const [aiModel, setAiModel] = useState('meshy-6');
  const [quality, setQuality] = useState('high');
  const [pose, setPose] = useState('none');
  const [count, setCount] = useState('1');
  const [imageEnhance, setImageEnhance] = useState(true);
  const [multiView, setMultiView] = useState(false);
  const [source, setSource] = useState<'text' | 'image'>('text');
  const fileRef = useRef<HTMLInputElement>(null);

  const poseModeMap: Record<string, MeshyPoseMode> = {
    none: '',
    a_pose: 'a-pose',
    t_pose: 't-pose',
  };

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (!trimmed && source === 'text') return;
    if (trimmed.length > MESHY_PROMPT_MAX) return;
    if (onMeshyTextTo3d) {
      void onMeshyTextTo3d({
        prompt: trimmed,
        pose_mode: poseModeMap[pose] ?? '',
        model_type: modelType === 'low_poly' ? 'lowpoly' : 'standard',
        ai_model: aiModel,
      });
      return;
    }
    dispatchGenerateCadObject({
      prompt,
      engine: 'Meshy',
      target: 'viewport',
      units: 'meters',
      quality,
      workspace,
      sceneId,
    });
  };

  return (
    <div className="cl__tab-body">
      {/* Source toggle */}
      <div className="cl__source-toggle">
        {(['text', 'image'] as const).map(s => (
          <button
            key={s}
            type="button"
            className={['cl__source-btn', source === s ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => setSource(s)}
          >
            {s === 'text' ? 'Text' : 'Image'}
          </button>
        ))}
      </div>

      {source === 'text' && (
        <>
          <SectionHead label="MESHY — Text to 3D" icon={Sparkles} />
          <textarea
            className="cl__prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the 3D model you want to generate…"
            rows={4}
          />
          <Field label="Model type">
            <Select value={modelType} onChange={setModelType} options={[
              { value: 'standard', label: 'Standard' },
              { value: 'low_poly', label: 'Low Poly (Beta)' },
            ]} />
          </Field>
          <Field label="AI model">
            <Select value={aiModel} onChange={setAiModel} options={[
              { value: 'meshy-6', label: 'Meshy 6' },
              { value: 'meshy-5', label: 'Meshy 5' },
            ]} />
          </Field>
          <Field label="Quality">
            <Select value={quality} onChange={setQuality} options={[
              { value: 'draft', label: 'Draft' },
              { value: 'high', label: 'High' },
              { value: 'ultra', label: 'Ultra' },
            ]} />
          </Field>
          <Field label="Pose">
            <Select value={pose} onChange={setPose} options={[
              { value: 'none', label: 'None' },
              { value: 'a_pose', label: 'A-Pose' },
              { value: 't_pose', label: 'T-Pose' },
            ]} />
          </Field>
          <Field label="Count">
            <Select value={count} onChange={setCount} options={['1','2','3','4'].map(v => ({ value: v, label: v }))} />
          </Field>
          <div className="cl__toggles">
            <label className="cl__toggle-row">
              <input type="checkbox" checked={imageEnhance} onChange={e => setImageEnhance(e.target.checked)} />
              Image Enhancement
            </label>
            <label className="cl__toggle-row">
              <input type="checkbox" checked={multiView} onChange={e => setMultiView(e.target.checked)} />
              Multi-view (Beta)
            </label>
          </div>
          <ActionBtn
            label="✦ Generate"
            onClick={handleGenerate}
            accent
            disabled={!prompt.trim() || prompt.trim().length > MESHY_PROMPT_MAX}
          />
        </>
      )}

      {source === 'image' && (
        <>
          <SectionHead label="MESHY — Image to 3D" icon={Image} />
          <div
            className="cl__dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
          >
            <Image size={24} strokeWidth={1} style={{ opacity: 0.4 }} />
            <span>Click / Drag / Paste Image</span>
            <span className="cl__dropzone-hint">.png .jpg .jpeg .webp · max 20MB</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="cad-editor__hidden-input" />
          <Field label="Model type">
            <Select value={modelType} onChange={setModelType} options={[
              { value: 'standard', label: 'Standard' },
              { value: 'low_poly', label: 'Low Poly (Beta)' },
            ]} />
          </Field>
          <Field label="AI model">
            <Select value={aiModel} onChange={setAiModel} options={[
              { value: 'meshy-6', label: 'Meshy 6' },
            ]} />
          </Field>
          <div className="cl__toggles">
            <label className="cl__toggle-row">
              <input type="checkbox" checked={imageEnhance} onChange={e => setImageEnhance(e.target.checked)} />
              Image Enhancement
            </label>
          </div>
          <ActionBtn label="✦ Generate from Image" onClick={() => {}} accent />
        </>
      )}
    </div>
  );
}

// ── BUILD TAB ────────────────────────────────────────────────────────────────
function BuildTab({ workspace, sceneId, selectedObjectId, onRunBlenderScript, onRunOpenSCAD, onRunFreeCAD }: {
  workspace: string; sceneId: string | null; selectedObjectId: string | null;
  onRunBlenderScript: (s: string) => void;
  onRunOpenSCAD: (s: string) => void;
  onRunFreeCAD: (s: string) => void;
}) {
  const [engine, setEngine] = useState<BuildEngine>('blender');
  const [prompt, setPrompt] = useState('');
  const [script, setScript] = useState('');
  const [showScript, setShowScript] = useState(false);
  const [unit, setUnit] = useState('mm');
  const [workbench, setWorkbench] = useState('part_design');

  // OpenSCAD params (auto-extracted stubs)
  const [params, setParams] = useState({ width: 50, height: 20, depth: 10, holes: 4 });

  const handleGenerate = () => {
    dispatchGenerateCadObject({
      prompt,
      engine: engine === 'blender' ? 'Blender' : engine === 'openscad' ? 'OpenSCAD' : 'FreeCAD',
      target: 'viewport',
      units: unit === 'mm' ? 'millimeters' : 'meters',
      quality: 'high',
      workspace,
      sceneId,
    });
  };

  return (
    <div className="cl__tab-body">
      {/* Engine sub-tabs */}
      <div className="cl__source-toggle">
        {([['blender', 'Blender'], ['openscad', 'OpenSCAD'], ['freecad', 'FreeCAD']] as const).map(([e, l]) => (
          <button
            key={e}
            type="button"
            className={['cl__source-btn', engine === e ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => setEngine(e)}
          >
            {l}
          </button>
        ))}
      </div>

      {engine === 'blender' && (
        <>
          <SectionHead label="BLENDER — Python modifier/render" icon={Cpu} />
          <textarea
            className="cl__prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe what to do… e.g. add subdivision surface modifier level 3, then UV unwrap"
            rows={4}
          />
          <div className="cl__btn-row">
            <ActionBtn label="✦ Generate Script" onClick={handleGenerate} accent disabled={!prompt.trim()} />
            <ActionBtn label="▶ Run" icon={Play} onClick={() => onRunBlenderScript(script)} disabled={!script} />
          </div>
          {script && (
            <div className="cl__script-wrap">
              <button type="button" className="cl__script-toggle" onClick={() => setShowScript(v => !v)}>
                {showScript ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Script preview
              </button>
              {showScript && (
                <textarea
                  className="cl__script-editor"
                  value={script}
                  onChange={e => setScript(e.target.value)}
                  rows={8}
                />
              )}
            </div>
          )}
          <SectionHead label="QUICK MODIFIERS" icon={Layers} />
          <div className="cl__chip-grid">
            {['Subdivision','Boolean','Solidify','Decimate','Mirror','Array','Bevel','Screw'].map(m => (
              <button key={m} type="button" className="cl__chip" onClick={() => {
                setPrompt(`Apply ${m} modifier to selected object`);
              }}>{m}</button>
            ))}
          </div>
        </>
      )}

      {engine === 'openscad' && (
        <>
          <SectionHead label="OPENSCAD — Parametric parts" icon={Ruler} />
          <textarea
            className="cl__prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the part… e.g. a mounting bracket with 4mm holes at each corner, 50×20×10mm"
            rows={4}
          />
          <Field label="Units">
            <Select value={unit} onChange={setUnit} options={[
              { value: 'mm', label: 'Millimeters (mm)' },
              { value: 'cm', label: 'Centimeters (cm)' },
              { value: 'in', label: 'Inches' },
            ]} />
          </Field>
          <div className="cl__btn-row">
            <ActionBtn label="✦ Generate" onClick={handleGenerate} accent disabled={!prompt.trim()} />
            <ActionBtn label="▶ Preview" icon={Play} onClick={() => onRunOpenSCAD(script)} disabled={!script} />
            <ActionBtn label="⬇ STL" icon={Download} onClick={() => {}} disabled={!script} />
          </div>
          <SectionHead label="PARAMETERS" icon={SlidersHorizontal} />
          {Object.entries(params).map(([k, v]) => (
            <Field key={k} label={k}>
              <input
                className="cl__number"
                type="number"
                value={v}
                onChange={e => setParams(p => ({ ...p, [k]: Number(e.target.value) }))}
              />
              {k !== 'holes' && <span className="cl__unit">{unit}</span>}
            </Field>
          ))}
        </>
      )}

      {engine === 'freecad' && (
        <>
          <SectionHead label="FREECAD — Precision CAD" icon={Home} />
          <Field label="Part type">
            <Select value="body" onChange={() => {}} options={[
              { value: 'body', label: 'Body' },
              { value: 'sketch', label: 'Sketch' },
              { value: 'assembly', label: 'Assembly' },
            ]} />
          </Field>
          <Field label="Workbench">
            <Select value={workbench} onChange={setWorkbench} options={[
              { value: 'part_design', label: 'Part Design' },
              { value: 'arch', label: 'Arch (Architecture)' },
              { value: 'draft', label: 'Draft (2D/3D)' },
              { value: 'bim', label: 'BIM' },
            ]} />
          </Field>
          <textarea
            className="cl__prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the part… e.g. shophouse exterior wall 3m high, 6m wide, 200mm thick concrete"
            rows={4}
          />
          <Field label="Units">
            <Select value={unit} onChange={setUnit} options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'm', label: 'm' },
            ]} />
          </Field>
          <Field label="Tolerance">
            <input className="cl__number" type="number" defaultValue={0.01} step={0.001} />
          </Field>
          <div className="cl__btn-row">
            <ActionBtn label="✦ Generate" onClick={handleGenerate} accent disabled={!prompt.trim()} />
            <ActionBtn label="▶ Run" icon={Play} onClick={() => onRunFreeCAD(script)} disabled={!script} />
            <ActionBtn label="⬇ DXF" icon={Download} onClick={() => {}} />
          </div>
          <div className="cl__runner-status">
            <span className="cl__status-dot cl__status-dot--idle" />
            GCP VM · ExecOS runner
          </div>
        </>
      )}
    </div>
  );
}

// ── SCENE TAB ────────────────────────────────────────────────────────────────
function SceneTab({ onSpawnPrimitive, onImportGlb }: {
  onSpawnPrimitive: CreationLaneProps['onSpawnPrimitive'];
  onImportGlb: () => void;
}) {
  const PRIMITIVES: { type: CreationLaneProps['onSpawnPrimitive'] extends (t: infer T) => void ? T : never; label: string }[] = [
    { type: 'cube', label: 'Cube' },
    { type: 'sphere', label: 'Sphere' },
    { type: 'plane', label: 'Plane' },
    { type: 'cylinder', label: 'Cylinder' },
    { type: 'cone', label: 'Cone' },
    { type: 'light', label: 'Light' },
    { type: 'camera', label: 'Camera' },
  ];

  return (
    <div className="cl__tab-body">
      <SectionHead label="ADD PRIMITIVES" icon={Box} />
      <div className="cl__chip-grid">
        {PRIMITIVES.map(p => (
          <button key={p.type} type="button" className="cl__chip cl__chip--add" onClick={() => onSpawnPrimitive(p.type)}>
            <Plus size={10} strokeWidth={2} /> {p.label}
          </button>
        ))}
      </div>

      <SectionHead label="IMPORT" icon={Download} />
      <ActionBtn label="Import GLB / GLTF…" icon={Download} onClick={onImportGlb} />

      <SectionHead label="ENVIRONMENT" icon={Sun} />
      <div className="cl__chip-grid">
        {['Exterior Day','Interior Studio','Product White','Golden Hour','Night Sky','Custom HDRI'].map(e => (
          <button key={e} type="button" className="cl__chip">{e}</button>
        ))}
      </div>

      <SectionHead label="CAMERA PRESETS" icon={Camera} />
      <div className="cl__chip-grid">
        {(['Perspective','Orthographic','Top','Front','Right','Left'] as const).map(v => (
          <button key={v} type="button" className="cl__chip" onClick={() => {
            if (v === 'Perspective') { onToggleOrtho?.(false); }
            else if (v === 'Orthographic') { onToggleOrtho?.(true); }
            else { onSnapView?.(v.toLowerCase()); }
          }}>{v}</button>
        ))}
      </div>

      <SectionHead label="SCENE LAYERS" icon={Layers} />
      {['Structure','Furniture','Landscaping','Electrical','Plumbing'].map(l => (
        <label key={l} className="cl__toggle-row">
          <input type="checkbox" defaultChecked /> {l}
        </label>
      ))}
    </div>
  );
}

// ── SHELL ────────────────────────────────────────────────────────────────────
export function CreationLane({
  open, onClose, workspace, sceneId, selectedObjectId,
  onSpawnPrimitive, onImportGlb, onRunBlenderScript, onRunOpenSCAD, onRunFreeCAD,
  onSnapView, onToggleOrtho, onMeshyTextTo3d,
}: CreationLaneProps) {
  const [tab, setTab] = useState<CreationTab>('model');

  if (!open) return null;

  return (
    <aside className="cl__panel cad-studio__slide-drawer">
      <div className="cl__tabs">
        {(['model', 'build', 'scene'] as const).map(t => (
          <button
            key={t}
            type="button"
            className={['cl__tab', tab === t ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(t)}
          >
            {t === 'model' ? 'MODEL' : t === 'build' ? 'BUILD' : 'SCENE'}
          </button>
        ))}
        <button type="button" className="cl__close" onClick={onClose} title="Close" aria-label="Close creation lane">×</button>
      </div>

      <div className="cl__body">
        {tab === 'model' && (
          <ModelTab workspace={workspace} sceneId={sceneId} onMeshyTextTo3d={onMeshyTextTo3d} />
        )}
        {tab === 'build' && (
          <BuildTab
            workspace={workspace} sceneId={sceneId} selectedObjectId={selectedObjectId}
            onRunBlenderScript={onRunBlenderScript}
            onRunOpenSCAD={onRunOpenSCAD}
            onRunFreeCAD={onRunFreeCAD}
          />
        )}
        {tab === 'scene' && <SceneTab onSpawnPrimitive={onSpawnPrimitive} onImportGlb={onImportGlb} />}
      </div>
    </aside>
  );
}
