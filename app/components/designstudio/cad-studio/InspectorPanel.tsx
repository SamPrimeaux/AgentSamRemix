/**
 * InspectorPanel — unified 280px right inspector (Outliner · Scene · Object).
 * Mobile: slide-up drawer; viewport always stays visible above the sheet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { GameEntity, SceneConfig } from '../../../../types';
import type { EntityMaterialPatch, StudioSceneEnvConfig, StudioSceneEnvPatch } from './studioEnvironment';
import { STUDIO_CANVAS_PRESETS, STUDIO_WORLD_PRESETS } from './studioEnvironment';
import type { MeshStats } from './cadStudioTypes';
import type { EntitySpatialSnapshot } from '../../../../lib/cadPlacement';
import { OutlinerEditor } from './editors/OutlinerEditor';
import type { ProtocolArtifact } from './useCadStudioProtocol';

export type InspectorTab = 'outliner' | 'scene' | 'object';

export type InspectorPanelProps = {
  open: boolean;
  onClose: () => void;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  entities: GameEntity[];
  selectedId: string | null;
  onSelectEntity: (id: string | null) => void;
  artifacts?: ProtocolArtifact[];
  sceneName?: string;
  onSceneNameChange?: (name: string) => void;
  sceneConfig?: SceneConfig;
  sceneEnvConfig?: StudioSceneEnvConfig;
  onSceneConfigChange?: (p: Partial<SceneConfig>) => void;
  onSceneEnvChange?: (patch: StudioSceneEnvPatch) => void;
  onSetBackground?: (hex: string) => void;
  onSetFog?: (enabled: boolean) => void;
  onSetGridVisible?: (v: boolean) => void;
  onSnapView?: (face: string) => void;
  onToggleOrtho?: (ortho: boolean) => void;
  orthoMode?: boolean;
  selectedEntity?: GameEntity | null;
  onEntityNameChange?: (id: string, name: string) => void;
  onEntityPositionChange?: (id: string, pos: { x?: number; y?: number; z?: number }) => void;
  onEntityScaleChange?: (id: string, scale: number) => void;
  onApplyMaterial?: (id: string, patch: EntityMaterialPatch) => void;
  onPatchDimensions?: (entityId: string, dims: { w?: number; h?: number; d?: number }) => void;
  onRunBlenderJob?: (prompt: string) => void | Promise<void>;
  meshStats?: MeshStats;
  entitySpatial?: EntitySpatialSnapshot | null;
  onSnapEntityToGrid?: (id: string) => void;
  onSetEntityGroundY?: (id: string, y: number) => void;
  spatialOverlaysEnabled?: boolean;
  onSpatialOverlaysChange?: (enabled: boolean) => void;
};

function SectionHead({ label }: { label: string }) {
  return <div className="ip__section-title">{label}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ip__row">
      <span className="ip__label">{label}</span>
      {children}
    </div>
  );
}

function IOSToggle({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label className="ip__ios-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ip__ios-slider" />
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span className="ip__label">{label}</span>
        <span className="ip__value">
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="ip__slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

function NumInput({ value, step = 0.01, onChange }: { value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="ip__number"
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

const VIEW_FACES = ['top', 'front', 'right', 'left', 'back', 'bottom'] as const;
const MODIFIERS = ['Subdivision', 'Solidify', 'Bevel', 'Array', 'Mirror', 'Boolean', 'Decimate', 'Screw'];

function SceneInspector({
  sceneName,
  onSceneNameChange,
  sceneConfig,
  sceneEnvConfig,
  onSceneConfigChange,
  onSceneEnvChange,
  onSetBackground,
  onSetGridVisible,
  onSnapView,
  onToggleOrtho,
  orthoMode = false,
}: Pick<
  InspectorPanelProps,
  | 'sceneName'
  | 'onSceneNameChange'
  | 'sceneConfig'
  | 'sceneEnvConfig'
  | 'onSceneConfigChange'
  | 'onSceneEnvChange'
  | 'onSetBackground'
  | 'onSetGridVisible'
  | 'onSnapView'
  | 'onToggleOrtho'
  | 'orthoMode'
>) {
  const [bgColor, setBgColor] = useState('#111214');
  const [gridOn, setGridOn] = useState(true);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const ambient = sceneEnvConfig?.ambientIntensity ?? sceneConfig?.ambientIntensity ?? 1.5;
  const shadows = sceneEnvConfig?.castShadows ?? sceneConfig?.castShadows ?? true;
  const sunColor = sceneConfig?.sunColor ?? '#ffffff';
  const exposure = sceneEnvConfig?.exposure ?? 1.5;
  const sunPower = sceneEnvConfig?.sunPower ?? 3;
  const sunHeight = sceneEnvConfig?.sunHeight ?? 45;
  const fogDensity = sceneEnvConfig?.fogDensity ?? 0;

  const applyPreset = useCallback(
    (p: { label: string; bg: string }) => {
      setActivePreset(p.label);
      setBgColor(p.bg);
      onSetBackground?.(p.bg);
    },
    [onSetBackground],
  );

  const applyWorldPreset = useCallback(
    (preset: (typeof STUDIO_WORLD_PRESETS)[number]) => {
      setActivePreset(preset.label);
      setBgColor(preset.bg);
      onSetBackground?.(preset.bg);
      onSceneEnvChange?.({
        ambientIntensity: preset.ambientIntensity,
        sunPower: preset.sunPower,
        exposure: preset.exposure,
        fogDensity: preset.fogDensity,
        fogEnabled: preset.fogDensity > 0,
      });
      onSceneConfigChange?.({ ambientIntensity: preset.ambientIntensity, castShadows: true });
    },
    [onSceneConfigChange, onSceneEnvChange, onSetBackground],
  );

  return (
    <>
      <div className="ip__section">
        <SectionHead label="SCENE" />
        <Row label="Name">
          <input
            className="ip__number"
            style={{ width: '100%', flex: 1 }}
            value={sceneName ?? ''}
            onChange={(e) => onSceneNameChange?.(e.target.value)}
            placeholder="Untitled scene"
          />
        </Row>
      </div>

      <div className="ip__section">
        <SectionHead label="CANVAS" />
        <div className="ip__pill-grid" style={{ marginBottom: 10 }}>
          {STUDIO_CANVAS_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`ip__pill${activePreset === p.label ? ' active' : ''}`}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Row label="Background">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
            <input
              type="color"
              className="ip__color"
              value={bgColor}
              onChange={(e) => {
                setBgColor(e.target.value);
                setActivePreset(null);
                onSetBackground?.(e.target.value);
              }}
            />
            <span style={{ fontFamily: 'var(--cs-mono)', fontSize: 10, color: 'var(--cs-text-2)' }}>{bgColor}</span>
          </div>
        </Row>
        <Row label="Grid">
          <IOSToggle
            id="ip-grid"
            checked={gridOn}
            onChange={(v) => {
              setGridOn(v);
              onSetGridVisible?.(v);
            }}
          />
        </Row>
        <Row label="Fog">
          <IOSToggle
            id="ip-fog"
            checked={fogDensity > 0.0001}
            onChange={(v) => onSceneEnvChange?.({ fogEnabled: v, fogDensity: v ? Math.max(fogDensity, 0.008) : 0 })}
          />
        </Row>
      </div>

      <div className="ip__section">
        <SectionHead label="LIGHTING" />
        <SliderRow label="Exposure" value={exposure} min={0.2} max={3} step={0.05} onChange={(v) => onSceneEnvChange?.({ exposure: v })} />
        <SliderRow label="Ambient" value={ambient} min={0} max={5} step={0.1} onChange={(v) => {
          onSceneEnvChange?.({ ambientIntensity: v });
          onSceneConfigChange?.({ ambientIntensity: v });
        }} />
        <SliderRow label="Sun power" value={sunPower} min={0} max={10} step={0.1} onChange={(v) => onSceneEnvChange?.({ sunPower: v })} />
        <SliderRow label="Sun height" value={sunHeight} min={-90} max={90} step={1} unit="°" onChange={(v) => onSceneEnvChange?.({ sunHeight: v })} />
        <SliderRow label="Fog density" value={fogDensity} min={0} max={0.08} step={0.001} onChange={(v) => onSceneEnvChange?.({ fogDensity: v, fogEnabled: v > 0.0001 })} />
        <Row label="Sun color">
          <input
            type="color"
            className="ip__color"
            value={sunColor}
            onChange={(e) => {
              onSceneConfigChange?.({ sunColor: e.target.value });
              onSceneEnvChange?.({ sunColor: e.target.value });
            }}
          />
        </Row>
        <Row label="Shadows">
          <IOSToggle
            id="ip-shadows"
            checked={shadows}
            onChange={(v) => {
              onSceneEnvChange?.({ castShadows: v });
              onSceneConfigChange?.({ castShadows: v });
            }}
          />
        </Row>
        <div className="ip__section-title" style={{ marginTop: 8 }}>WORLD PRESETS</div>
        <div className="ip__chip-grid">
          {STUDIO_WORLD_PRESETS.map((preset) => (
            <button key={preset.label} type="button" className="ip__chip" onClick={() => applyWorldPreset(preset)}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ip__section">
        <SectionHead label="CAMERA" />
        <div className="ip__pill-grid" style={{ marginBottom: 8 }}>
          <button type="button" className={`ip__pill${!orthoMode ? ' active' : ''}`} onClick={() => onToggleOrtho?.(false)}>
            Perspective
          </button>
          <button type="button" className={`ip__pill${orthoMode ? ' active' : ''}`} onClick={() => onToggleOrtho?.(true)}>
            Orthographic
          </button>
        </div>
        <div className="ip__section-title" style={{ marginTop: 6 }}>SNAP VIEW</div>
        <div className="ip__pill-grid">
          {VIEW_FACES.map((face) => (
            <button
              key={face}
              type="button"
              className="ip__pill"
              onClick={() => onSnapView?.(face)}
              style={{ textTransform: 'capitalize' }}
            >
              {face}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ObjectInspector({
  entity,
  onEntityNameChange,
  onEntityPositionChange,
  onEntityScaleChange,
  onApplyMaterial,
  onPatchDimensions,
  onRunBlenderJob,
  meshStats,
  entitySpatial,
  onSnapEntityToGrid,
  onSetEntityGroundY,
  spatialOverlaysEnabled = true,
  onSpatialOverlaysChange,
}: {
  entity: GameEntity;
  onEntityNameChange?: (id: string, name: string) => void;
  onEntityPositionChange?: (id: string, pos: { x?: number; y?: number; z?: number }) => void;
  onEntityScaleChange?: (id: string, scale: number) => void;
  onApplyMaterial?: (id: string, patch: EntityMaterialPatch) => void;
  onPatchDimensions?: (entityId: string, dims: { w?: number; h?: number; d?: number }) => void;
  onRunBlenderJob?: (prompt: string) => void | Promise<void>;
  meshStats?: MeshStats;
  entitySpatial?: EntitySpatialSnapshot | null;
  onSnapEntityToGrid?: (id: string) => void;
  onSetEntityGroundY?: (id: string, y: number) => void;
  spatialOverlaysEnabled?: boolean;
  onSpatialOverlaysChange?: (enabled: boolean) => void;
}) {
  const pos = entity.position ?? { x: 0, y: 0, z: 0 };
  const scale = entity.scale ?? entitySpatial?.visual_scale ?? 1;
  const rot = entitySpatial?.rotation_euler_deg ?? entity.rotation ?? { x: 0, y: 0, z: 0 };
  const stats = meshStats ?? { verts: 0, edges: 0, faces: 0, tris: 0 };
  const bbox = entitySpatial?.world_bbox;
  const unitsLabel = entitySpatial?.units ?? 'scene';
  const [matColor, setMatColor] = useState('#8a8a8a');
  const [roughness, setRoughness] = useState(0.45);
  const [metalness, setMetalness] = useState(0.1);
  const [opacity, setOpacity] = useState(1);
  const [surface, setSurface] = useState('principled');
  const [dimW, setDimW] = useState(1);
  const [dimH, setDimH] = useState(1);
  const [dimD, setDimD] = useState(1);

  useEffect(() => {
    setMatColor('#8a8a8a');
    setRoughness(0.45);
    setMetalness(0.1);
    setOpacity(1);
    setSurface('principled');
    setDimW(1);
    setDimH(1);
    setDimD(1);
  }, [entity.id]);

  const applyMat = (patch: EntityMaterialPatch) => onApplyMaterial?.(entity.id, patch);

  const applySurface = (mode: string) => {
    setSurface(mode);
    if (mode === 'emission') applyMat({ emissive: true, roughness: 0.3, wireframe: false });
    else if (mode === 'glass') applyMat({ emissive: false, roughness: 0.05, metalness: 0, opacity: 0.35, wireframe: false });
    else if (mode === 'metal') applyMat({ emissive: false, roughness: 0.25, metalness: 1, wireframe: false });
    else if (mode === 'wireframe') applyMat({ wireframe: true, emissive: false });
    else applyMat({ emissive: false, wireframe: false, roughness: 0.45, metalness: 0.1, opacity: 1 });
  };

  return (
    <>
      <div className="ip__section">
        <SectionHead label="TRANSFORM" />
        <div className="ip__section-title" style={{ marginBottom: 4 }}>POSITION</div>
        <div className="ip__xyz-row">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="ip__xyz-field">
              <span className={`ip__xyz-label ip__xyz-label--${axis}`}>{axis.toUpperCase()}</span>
              <NumInput value={pos[axis] ?? 0} onChange={(v) => onEntityPositionChange?.(entity.id, { [axis]: v })} />
            </div>
          ))}
        </div>
        <div className="ip__section-title" style={{ marginTop: 8, marginBottom: 4 }}>SCALE</div>
        <div className="ip__row">
          <span className="ip__label">Uniform</span>
          <NumInput value={scale} step={0.01} onChange={(v) => onEntityScaleChange?.(entity.id, v)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            type="button"
            className="ip__pill"
            onClick={() => {
              onEntityPositionChange?.(entity.id, { x: 0, y: 0, z: 0 });
              onEntityScaleChange?.(entity.id, 1);
            }}
          >
            Reset Transform
          </button>
        </div>
      </div>

      <div className="ip__section">
        <SectionHead label="PLANS / GYRO" />
        <Row label="Units">
          <span className="ip__value">{unitsLabel}{entitySpatial?.source_units ? ` (source ${entitySpatial.source_units})` : ''}</span>
        </Row>
        <Row label="Profile">
          <span className="ip__value">{entitySpatial?.spawn_profile ?? 'preview'}</span>
        </Row>
        {bbox ? (
          <>
            <div className="ip__section-title" style={{ marginTop: 8, marginBottom: 4 }}>WORLD BBOX ({unitsLabel})</div>
            <div className="ip__stats ip__stats--spatial">
              <span>W <b>{bbox.size.x.toFixed(3)}</b></span>
              <span>H <b>{bbox.size.y.toFixed(3)}</b></span>
              <span>D <b>{bbox.size.z.toFixed(3)}</b></span>
            </div>
            <div className="ip__stats ip__stats--spatial">
              <span>min Y <b>{bbox.min.y.toFixed(3)}</b></span>
              <span>ground <b>{entitySpatial?.ground_y.toFixed(3) ?? '—'}</b></span>
            </div>
          </>
        ) : null}
        <div className="ip__section-title" style={{ marginTop: 8, marginBottom: 4 }}>ROTATION (°)</div>
        <div className="ip__xyz-row">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="ip__xyz-field">
              <span className={`ip__xyz-label ip__xyz-label--${axis}`}>{axis.toUpperCase()}</span>
              <span className="ip__value ip__value--readonly">{(rot[axis] ?? 0).toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div className="ip__chip-grid" style={{ marginTop: 8 }}>
          <button type="button" className="ip__chip" onClick={() => onSnapEntityToGrid?.(entity.id)}>
            Snap to grid origin
          </button>
          <button type="button" className="ip__chip" onClick={() => onSetEntityGroundY?.(entity.id, 0)}>
            Set ground Y=0
          </button>
        </div>
        <label className="ip__toggle-row" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={spatialOverlaysEnabled}
            onChange={(e) => onSpatialOverlaysChange?.(e.target.checked)}
          />
          Show world + model axis triads
        </label>
      </div>

      <div className="ip__section">
        <SectionHead label="OBJECT" />
        <Row label="Name">
          <input
            className="ip__number"
            style={{ width: '100%', flex: 1 }}
            value={entity.name}
            onChange={(e) => onEntityNameChange?.(entity.id, e.target.value)}
          />
        </Row>
        <Row label="Type">
          <span className="ip__value" style={{ textAlign: 'left', opacity: 0.6 }}>{entity.type}</span>
        </Row>
      </div>

      <div className="ip__section">
        <SectionHead label="MESH" />
        <div className="ip__stats">
          <span><b>{stats.verts}</b> V</span>
          <span><b>{stats.edges}</b> E</span>
          <span><b>{stats.tris}</b> T</span>
        </div>
        <div className="ip__chip-grid" style={{ marginTop: 6 }}>
          {['Remesh', 'UV Unwrap', 'Clean Mesh'].map((op) => (
            <button key={op} type="button" className="ip__chip" onClick={() => void onRunBlenderJob?.(`${op} the selected object`)}>
              {op}
            </button>
          ))}
        </div>
      </div>

      <div className="ip__section">
        <SectionHead label="MATERIAL" />
        <Row label="Surface">
          <select className="ip__select" value={surface} onChange={(e) => applySurface(e.target.value)}>
            <option value="principled">Principled BSDF</option>
            <option value="emission">Emission</option>
            <option value="glass">Glass</option>
            <option value="metal">Metal</option>
            <option value="wireframe">Wireframe</option>
          </select>
        </Row>
        <Row label="Base color">
          <input
            type="color"
            className="ip__color"
            value={matColor}
            onChange={(e) => {
              setMatColor(e.target.value);
              applyMat({ color: e.target.value });
            }}
          />
        </Row>
        <SliderRow label="Roughness" value={roughness} min={0} max={1} step={0.01} onChange={(v) => { setRoughness(v); applyMat({ roughness: v }); }} />
        <SliderRow label="Metalness" value={metalness} min={0} max={1} step={0.01} onChange={(v) => { setMetalness(v); applyMat({ metalness: v }); }} />
        <SliderRow label="Opacity" value={opacity} min={0} max={1} step={0.01} onChange={(v) => { setOpacity(v); applyMat({ opacity: v }); }} />
      </div>

      <div className="ip__section">
        <SectionHead label="DIMENSIONS" />
        <div className="ip__xyz-row">
          {([
            ['W', dimW, setDimW, 'w'],
            ['H', dimH, setDimH, 'h'],
            ['D', dimD, setDimD, 'd'],
          ] as const).map(([label, val, setVal, key]) => (
            <div key={label} className="ip__xyz-field">
              <span className="ip__xyz-label">{label}</span>
              <NumInput
                value={val}
                step={0.01}
                onChange={(n) => {
                  setVal(n);
                  onPatchDimensions?.(entity.id, { [key]: n });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="ip__section">
        <SectionHead label="MODIFIERS" />
        <div className="ip__chip-grid">
          {MODIFIERS.map((mod) => (
            <button
              key={mod}
              type="button"
              className="ip__chip"
              onClick={() => void onRunBlenderJob?.(`Apply ${mod} modifier to the selected object`)}
            >
              {mod}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function InspectorPanel({
  open,
  onClose,
  tab,
  onTabChange,
  entities,
  selectedId,
  onSelectEntity,
  artifacts,
  sceneName,
  onSceneNameChange,
  sceneConfig,
  sceneEnvConfig,
  onSceneConfigChange,
  onSceneEnvChange,
  onSetBackground,
  onSetGridVisible,
  onSnapView,
  onToggleOrtho,
  orthoMode = false,
  selectedEntity = null,
  onEntityNameChange,
  onEntityPositionChange,
  onEntityScaleChange,
  onApplyMaterial,
  onPatchDimensions,
  onRunBlenderJob,
  meshStats,
  entitySpatial,
  onSnapEntityToGrid,
  onSetEntityGroundY,
  spatialOverlaysEnabled,
  onSpatialOverlaysChange,
}: InspectorPanelProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dragStart = React.useRef<{ y: number; h: number } | null>(null);

  const onDragPointerDown = React.useCallback((e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, h: panel.getBoundingClientRect().height };
  }, []);

  const onDragPointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || !panelRef.current) return;
    const delta = dragStart.current.y - e.clientY;
    const maxH = Math.min(window.innerHeight * 0.52, window.innerHeight - 128);
    const newH = Math.max(160, Math.min(maxH, dragStart.current.h + delta));
    panelRef.current.style.setProperty('--ip-mobile-height', `${newH}px`);
    panelRef.current.style.height = `${newH}px`;
  }, []);

  const onDragPointerUp = React.useCallback(() => {
    dragStart.current = null;
  }, []);

  if (!open) return null;

  const hasSelection = selectedEntity != null;
  const headTitle =
    tab === 'outliner' ? 'Outliner' : tab === 'object' && hasSelection ? selectedEntity!.name : 'Scene';

  return (
    <div className="ip__panel cad-studio__slide-drawer" ref={panelRef}>
      <div
        className="ip__drag-handle"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        aria-hidden
      />
      <div className="ip__head">
        {tab === 'object' && hasSelection ? (
          <input
            className="ip__head-input"
            value={selectedEntity!.name}
            onChange={(e) => onEntityNameChange?.(selectedEntity!.id, e.target.value)}
            aria-label="Object name"
          />
        ) : (
          <span className="ip__head-title">{headTitle}</span>
        )}
        <button type="button" className="ip__close" onClick={onClose} aria-label="Close Inspector">
          ✕
        </button>
      </div>
      <div className="ip__tabs" role="tablist">
        {([
          ['outliner', 'Outliner'],
          ['scene', 'Scene'],
          ['object', 'Object'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`ip__tab${tab === id ? ' active' : ''}`}
            disabled={id === 'object' && !hasSelection}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ip__body">
        {tab === 'outliner' ? (
          <OutlinerEditor
            embedded
            entities={entities}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelectEntity(id);
              if (id) onTabChange('object');
            }}
            artifacts={artifacts}
          />
        ) : tab === 'object' && hasSelection ? (
          <ObjectInspector
            entity={selectedEntity!}
            onEntityNameChange={onEntityNameChange}
            onEntityPositionChange={onEntityPositionChange}
            onEntityScaleChange={onEntityScaleChange}
            onApplyMaterial={onApplyMaterial}
            onPatchDimensions={onPatchDimensions}
            onRunBlenderJob={onRunBlenderJob}
            meshStats={meshStats}
            entitySpatial={entitySpatial}
            onSnapEntityToGrid={onSnapEntityToGrid}
            onSetEntityGroundY={onSetEntityGroundY}
            spatialOverlaysEnabled={spatialOverlaysEnabled}
            onSpatialOverlaysChange={onSpatialOverlaysChange}
          />
        ) : (
          <SceneInspector
            sceneName={sceneName}
            onSceneNameChange={onSceneNameChange}
            sceneConfig={sceneConfig}
            sceneEnvConfig={sceneEnvConfig}
            onSceneConfigChange={onSceneConfigChange}
            onSceneEnvChange={onSceneEnvChange}
            onSetBackground={onSetBackground}
            onSetGridVisible={onSetGridVisible}
            onSnapView={onSnapView}
            onToggleOrtho={onToggleOrtho}
            orthoMode={orthoMode}
          />
        )}
      </div>
    </div>
  );
}
