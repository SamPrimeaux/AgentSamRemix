/**
 * AdjustPanel — right-side context-aware sliders panel.
 * Controls call the viewport engine directly (not Agent chat).
 */
import React, { useEffect, useState } from 'react';
import { Sun, Globe, Camera, Layers, Palette, Ruler, SlidersHorizontal, X } from 'lucide-react';
import type { GameEntity } from '../../../../types';
import type { EntityMaterialPatch, StudioSceneEnvConfig, StudioSceneEnvPatch } from './studioEnvironment';
import { DEFAULT_STUDIO_SCENE_ENV, STUDIO_WORLD_PRESETS } from './studioEnvironment';
import type { MeshStats } from './cadStudioTypes';

export type AdjustPanelProps = {
  open: boolean;
  onClose: () => void;
  selectedEntity: GameEntity | null;
  selectedEntityId: string | null;
  sceneConfig: StudioSceneEnvConfig;
  onSceneConfigChange: (patch: StudioSceneEnvPatch) => void;
  onSetBackground?: (hex: string) => void;
  onSnapView?: (face: string) => void;
  onToggleOrtho?: (ortho: boolean) => void;
  orthoMode?: boolean;
  onApplyMaterial?: (entityId: string, patch: EntityMaterialPatch) => void;
  onPatchDimensions?: (entityId: string, dims: { w?: number; h?: number; d?: number }) => void;
  onRunBlenderJob?: (prompt: string) => void | Promise<void>;
  meshStats?: MeshStats;
};

function SectionHead({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="adj__section-head">
      <Icon size={12} strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  );
}

function Slider({ label, value, min, max, step = 0.01, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="adj__slider-row">
      <span className="adj__slider-label">{label}</span>
      <span className="adj__slider-value">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="adj__slider"
      />
    </div>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="adj__color-row">
      <span className="adj__slider-label">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="adj__color" />
      <span className="adj__color-hex">{value}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="adj__toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="adj__toggle" />
    </label>
  );
}

function ModChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="adj__chip" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export function AdjustPanel({
  open,
  onClose,
  selectedEntity,
  selectedEntityId,
  sceneConfig,
  onSceneConfigChange,
  onSetBackground,
  onSnapView,
  onToggleOrtho,
  orthoMode = false,
  onApplyMaterial,
  onPatchDimensions,
  onRunBlenderJob,
  meshStats,
}: AdjustPanelProps) {
  const [bgColor, setBgColor] = useState('#111214');
  const [matColor, setMatColor] = useState('#8a8a8a');
  const [roughness, setRoughness] = useState(0.8);
  const [metalness, setMetalness] = useState(0.0);
  const [opacity, setOpacity] = useState(1.0);
  const [surface, setSurface] = useState('principled');
  const [dimW, setDimW] = useState(1);
  const [dimH, setDimH] = useState(1);
  const [dimD, setDimD] = useState(1);

  useEffect(() => {
    if (!selectedEntityId) return;
    setMatColor('#8a8a8a');
    setRoughness(0.45);
    setMetalness(0.1);
    setOpacity(1);
    setSurface('principled');
    setDimW(1);
    setDimH(1);
    setDimD(1);
  }, [selectedEntityId]);

  if (!open) return null;

  const hasSelection = !!selectedEntity && !!selectedEntityId;
  const stats = meshStats ?? { verts: 0, edges: 0, faces: 0, tris: 0 };

  const applyMaterial = (patch: EntityMaterialPatch) => {
    if (!selectedEntityId || !onApplyMaterial) return;
    onApplyMaterial(selectedEntityId, patch);
  };

  const applySurface = (mode: string) => {
    setSurface(mode);
    if (mode === 'emission') applyMaterial({ emissive: true, roughness: 0.3 });
    else if (mode === 'glass') applyMaterial({ emissive: false, roughness: 0.05, metalness: 0, opacity: 0.35 });
    else if (mode === 'metal') applyMaterial({ emissive: false, roughness: 0.25, metalness: 1 });
    else if (mode === 'wireframe') applyMaterial({ wireframe: true });
    else applyMaterial({ emissive: false, wireframe: false, roughness: 0.45, metalness: 0.1, opacity: 1 });
  };

  const runBlender = (prompt: string) => {
    if (!hasSelection) return;
    void onRunBlenderJob?.(prompt);
  };

  const snapCamera = (label: string) => {
    const map: Record<string, string> = {
      Top: 'top',
      Front: 'front',
      Side: 'right',
      Perspective: 'perspective',
      Orthographic: 'ortho',
      Isometric: 'front',
    };
    if (label === 'Perspective') onToggleOrtho?.(false);
    else if (label === 'Orthographic') onToggleOrtho?.(true);
    else if (map[label]) onSnapView?.(map[label]);
  };

  return (
    <aside className="adj__panel">
      <div className="adj__head">
        <span>{hasSelection ? selectedEntity!.name : 'Adjust'}</span>
        <button type="button" className="adj__close" onClick={onClose} aria-label="Close">
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="adj__body">
        <SectionHead label="LIGHTING" icon={Sun} />
        <Slider label="Exposure" value={sceneConfig.exposure} min={0.2} max={3} step={0.05} onChange={v => onSceneConfigChange({ exposure: v })} />
        <Slider label="Ambient" value={sceneConfig.ambientIntensity} min={0} max={5} step={0.1} onChange={v => onSceneConfigChange({ ambientIntensity: v })} />
        <Slider label="Sun power" value={sceneConfig.sunPower} min={0} max={10} step={0.1} onChange={v => onSceneConfigChange({ sunPower: v })} />
        <Slider label="Sun height" value={sceneConfig.sunHeight} min={-90} max={90} step={1} unit="°" onChange={v => onSceneConfigChange({ sunHeight: v })} />
        <Toggle label="Cast shadows" checked={sceneConfig.castShadows} onChange={v => onSceneConfigChange({ castShadows: v })} />

        <SectionHead label="WORLD" icon={Globe} />
        <ColorSwatch label="Background" value={bgColor} onChange={(v) => { setBgColor(v); onSetBackground?.(v); }} />
        <Slider label="Fog density" value={sceneConfig.fogDensity} min={0} max={0.08} step={0.001} onChange={v => onSceneConfigChange({ fogDensity: v, fogEnabled: v > 0.0001 })} />
        <div className="adj__chip-grid">
          {STUDIO_WORLD_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="adj__chip"
              onClick={() => {
                setBgColor(preset.bg);
                onSetBackground?.(preset.bg);
                onSceneConfigChange({
                  ambientIntensity: preset.ambientIntensity,
                  sunPower: preset.sunPower,
                  exposure: preset.exposure,
                  fogDensity: preset.fogDensity,
                  fogEnabled: preset.fogDensity > 0,
                });
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <SectionHead label="CAMERA" icon={Camera} />
        <div className="adj__chip-grid">
          {['Perspective', 'Orthographic', 'Isometric', 'Top', 'Front', 'Side'].map((v) => (
            <button
              key={v}
              type="button"
              className={`adj__chip${(v === 'Perspective' && !orthoMode) || (v === 'Orthographic' && orthoMode) ? ' adj__chip--active' : ''}`}
              onClick={() => snapCamera(v)}
            >
              {v}
            </button>
          ))}
        </div>

        {hasSelection && (
          <>
            <SectionHead label="MATERIAL" icon={Palette} />
            <div className="adj__field">
              <span className="adj__slider-label">Surface</span>
              <select className="adj__select" value={surface} onChange={e => applySurface(e.target.value)}>
                <option value="principled">Principled BSDF</option>
                <option value="emission">Emission</option>
                <option value="glass">Glass</option>
                <option value="metal">Metal</option>
                <option value="wireframe">Wireframe</option>
              </select>
            </div>
            <ColorSwatch label="Base color" value={matColor} onChange={(v) => { setMatColor(v); applyMaterial({ color: v }); }} />
            <Slider label="Roughness" value={roughness} min={0} max={1} step={0.01} onChange={(v) => { setRoughness(v); applyMaterial({ roughness: v }); }} />
            <Slider label="Metalness" value={metalness} min={0} max={1} step={0.01} onChange={(v) => { setMetalness(v); applyMaterial({ metalness: v }); }} />
            <Slider label="Opacity" value={opacity} min={0} max={1} step={0.01} onChange={(v) => { setOpacity(v); applyMaterial({ opacity: v }); }} />

            <SectionHead label="MODIFIERS" icon={Layers} />
            <div className="adj__chip-grid">
              {['Subdivision', 'Solidify', 'Bevel', 'Array', 'Mirror', 'Boolean', 'Decimate', 'Screw'].map((m) => (
                <ModChip key={m} label={m} onClick={() => runBlender(`Apply ${m} modifier to the selected object in Blender`)} />
              ))}
            </div>

            <SectionHead label="GEOMETRY" icon={Ruler} />
            <div className="adj__field">
              <span className="adj__slider-label">Voxel size</span>
              <input type="number" className="adj__number" defaultValue={0.02} step={0.001} readOnly title="Set via Remesh job" />
            </div>
            <div className="adj__btn-row">
              <button type="button" className="adj__action-btn" onClick={() => runBlender('Voxel remesh selected object at voxel_size=0.02')}>Remesh</button>
              <button type="button" className="adj__action-btn" onClick={() => runBlender('Smart UV unwrap selected object')}>UV Unwrap</button>
              <button type="button" className="adj__action-btn" onClick={() => runBlender('Clean up mesh of selected object, remove doubles, fix normals')}>Clean Mesh</button>
            </div>

            <SectionHead label="DIMENSIONS" icon={SlidersHorizontal} />
            <div className="adj__dim-grid">
              {([
                ['W', dimW, setDimW, 'w'],
                ['H', dimH, setDimH, 'h'],
                ['D', dimD, setDimD, 'd'],
              ] as const).map(([label, val, setVal, key]) => (
                <div key={label} className="adj__dim-field">
                  <span className="adj__dim-label">{label}</span>
                  <input
                    type="number"
                    className="adj__number"
                    value={val}
                    step={0.01}
                    min={0.01}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setVal(n);
                      if (selectedEntityId && onPatchDimensions) {
                        onPatchDimensions(selectedEntityId, { [key]: n });
                      }
                    }}
                  />
                  <span className="adj__unit">m</span>
                </div>
              ))}
            </div>
            <div className="adj__poly-stats">
              <span>Verts <b>{stats.verts}</b></span>
              <span>Edges <b>{stats.edges}</b></span>
              <span>Tris <b>{stats.tris}</b></span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export { DEFAULT_STUDIO_SCENE_ENV };
