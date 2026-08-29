import React, { useState } from 'react';
import type { CadJobRow } from '../../api';
import { cadExportLinks, downloadCadAsset } from '../../cadExportFormats';
import type { GameEntity } from '../../../../types';
import type { PropertiesTabId } from '../cadStudioTypes';
import type { useCadStudioProtocol } from '../useCadStudioProtocol';
import type { EntityMaterialPatch } from '../studioEnvironment';

const TAB_DEFS: { id: PropertiesTabId; label: string; icon: string }[] = [
  { id: 'object', label: 'Object', icon: 'O' },
  { id: 'modifiers', label: 'Modifiers', icon: 'M' },
  { id: 'material', label: 'Material', icon: 'A' },
  { id: 'data', label: 'Data', icon: 'D' },
  { id: 'world', label: 'World', icon: 'W' },
  { id: 'render', label: 'Render', icon: 'R' },
  { id: 'scene', label: 'Scene', icon: 'S' },
  { id: 'physics', label: 'Physics', icon: 'P' },
];

export type PropertiesEditorProps = {
  selectedEntity: GameEntity | null;
  propertiesTab: PropertiesTabId;
  onTabChange: (tab: PropertiesTabId) => void;
  sceneName: string;
  onSceneNameChange: (name: string) => void;
  onEntityNameChange?: (id: string, name: string) => void;
  onTransformChange?: (id: string, patch: Partial<GameEntity>) => void;
  protocol: ReturnType<typeof useCadStudioProtocol>;
  activeJob?: CadJobRow | null;
  onDeployJob?: (job: CadJobRow) => void;
  onDownloadLatestGlb?: () => void;
  renderSamples?: number;
  renderBounces?: number;
  onRenderSettingsChange?: (patch: { samples?: number; bounces?: number }) => void;
  sceneConfig?: { ambientIntensity?: number; castShadows?: boolean };
  onSceneConfigChange?: (patch: { ambientIntensity?: number; castShadows?: boolean }) => void;
  onApplyMaterial?: (id: string, patch: EntityMaterialPatch) => void;
  onRunBlenderJob?: (prompt: string) => void | Promise<void>;
  onSetBackground?: (hex: string) => void;
};

function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cad-studio__accordion">
      <div className="cad-studio__accordion-title">▾ {title}</div>
      <div className="cad-studio__accordion-body">{children}</div>
    </div>
  );
}

export function PropertiesEditor({
  selectedEntity,
  propertiesTab,
  onTabChange,
  sceneName,
  onSceneNameChange,
  onEntityNameChange,
  onTransformChange,
  protocol,
  activeJob,
  onDeployJob,
  onDownloadLatestGlb,
  renderSamples = 128,
  renderBounces = 8,
  onRenderSettingsChange,
  sceneConfig,
  onSceneConfigChange,
  onApplyMaterial,
  onRunBlenderJob,
  onSetBackground,
}: PropertiesEditorProps) {
  const [matColor, setMatColor] = useState('#8a8a8a');
  const [roughness, setRoughness] = useState(0.45);
  const [metalness, setMetalness] = useState(0.1);
  const [bgColor, setBgColor] = useState('#111214');

  const applyMat = (patch: EntityMaterialPatch) => {
    if (selectedEntity && onApplyMaterial) onApplyMaterial(selectedEntity.id, patch);
  };
  const renderTab = () => {
    switch (propertiesTab) {
      case 'object':
        return selectedEntity ? (
          <>
            <Accordion title="Transform">
              <div className="cad-studio__field-grid">
                <span className="cad-studio__field-label">Location</span>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <input
                    key={axis}
                    className="cad-studio__field-input"
                    type="number"
                    step={0.01}
                    value={selectedEntity.position?.[axis] ?? 0}
                    onChange={(e) =>
                      onTransformChange?.(selectedEntity.id, {
                        position: {
                          ...selectedEntity.position,
                          [axis]: Number(e.target.value),
                        },
                      })
                    }
                  />
                ))}
              </div>
              <div style={{ height: 5 }} />
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Scale</span>
                <input
                  className="cad-studio__field-input"
                  type="number"
                  step={0.01}
                  min={0.01}
                  value={selectedEntity.scale ?? 1}
                  onChange={(e) =>
                    onTransformChange?.(selectedEntity.id, { scale: Number(e.target.value) })
                  }
                />
              </div>
            </Accordion>
            <Accordion title="Object">
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Name</span>
                <input
                  className="cad-studio__field-input"
                  value={selectedEntity.name}
                  onChange={(e) => onEntityNameChange?.(selectedEntity.id, e.target.value)}
                />
              </div>
              <div style={{ height: 5 }} />
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Type</span>
                <input className="cad-studio__field-input readonly" readOnly value={selectedEntity.type} />
              </div>
            </Accordion>
          </>
        ) : (
          <p className="cad-editor__hint">Select an object in the outliner.</p>
        );
      case 'modifiers':
        return selectedEntity ? (
          <Accordion title="Modifiers">
            <div className="ip__chip-grid" style={{ marginTop: 4 }}>
              {['Subdivision', 'Solidify', 'Bevel', 'Mirror', 'Decimate'].map((mod) => (
                <button
                  key={mod}
                  type="button"
                  className="cad-studio__btn"
                  style={{ fontSize: 10, padding: '4px 8px' }}
                  onClick={() => void onRunBlenderJob?.(`Apply ${mod} modifier to selected object`)}
                >
                  {mod}
                </button>
              ))}
            </div>
          </Accordion>
        ) : (
          <p className="cad-editor__hint">Select an object in the outliner.</p>
        );
      case 'material':
        return selectedEntity ? (
          <Accordion title="Material">
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Surface</span>
              <select
                className="cad-studio__field-input"
                defaultValue="principled"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'emission') applyMat({ emissive: true });
                  else if (v === 'wireframe') applyMat({ wireframe: true });
                  else applyMat({ emissive: false, wireframe: false });
                }}
              >
                <option value="principled">Principled BSDF</option>
                <option value="emission">Emission</option>
                <option value="wireframe">Wireframe</option>
              </select>
            </div>
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Base color</span>
              <input
                type="color"
                className="cad-studio__field-input"
                value={matColor}
                onChange={(e) => {
                  setMatColor(e.target.value);
                  applyMat({ color: e.target.value });
                }}
              />
            </div>
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Roughness</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={roughness}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRoughness(v);
                  applyMat({ roughness: v });
                }}
              />
            </div>
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Metalness</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={metalness}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMetalness(v);
                  applyMat({ metalness: v });
                }}
              />
            </div>
          </Accordion>
        ) : (
          <p className="cad-editor__hint">Select an object in the outliner.</p>
        );
      case 'render':
        return (
          <Accordion title="Render">
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Samples</span>
              <input
                className="cad-studio__field-input"
                type="number"
                min={1}
                value={renderSamples}
                onChange={(e) => onRenderSettingsChange?.({ samples: Number(e.target.value) })}
              />
            </div>
            <div style={{ height: 5 }} />
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Max Bounces</span>
              <input
                className="cad-studio__field-input"
                type="number"
                min={0}
                value={renderBounces}
                onChange={(e) => onRenderSettingsChange?.({ bounces: Number(e.target.value) })}
              />
            </div>
          </Accordion>
        );
      case 'world':
        return (
          <Accordion title="World">
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Background</span>
              <input
                type="color"
                className="cad-studio__field-input"
                value={bgColor}
                onChange={(e) => {
                  setBgColor(e.target.value);
                  onSetBackground?.(e.target.value);
                }}
              />
            </div>
            <div className="cad-studio__field-grid two">
              <span className="cad-studio__field-label">Ambient</span>
              <input
                className="cad-studio__field-input"
                type="number"
                step={0.1}
                min={0}
                value={sceneConfig?.ambientIntensity ?? 1.5}
                onChange={(e) => onSceneConfigChange?.({ ambientIntensity: Number(e.target.value) })}
              />
            </div>
            <label className="cad-editor__checkbox">
              <input
                type="checkbox"
                checked={sceneConfig?.castShadows ?? true}
                onChange={(e) => onSceneConfigChange?.({ castShadows: e.target.checked })}
              />
              Cast Shadows
            </label>
          </Accordion>
        );
      case 'scene':
        return (
          <>
            <Accordion title="Scene">
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Name</span>
                <input
                  className="cad-studio__field-input"
                  value={sceneName}
                  onChange={(e) => onSceneNameChange(e.target.value)}
                  placeholder="Untitled scene"
                />
              </div>
            </Accordion>
            <Accordion title="IAM CAD Protocol">
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Engine</span>
                <input className="cad-studio__field-input readonly" readOnly value={protocol.activeEngine} />
              </div>
              <div style={{ height: 5 }} />
              <div className="cad-studio__field-grid two">
                <span className="cad-studio__field-label">Job</span>
                <input className="cad-studio__field-input readonly" readOnly value={activeJob?.id || 'none'} />
              </div>
              {protocol.currentScript ? (
                <pre className="cad-studio__mini-code">{protocol.currentScript.slice(0, 900)}</pre>
              ) : (
                <p className="cad-editor__hint">No generated script attached yet.</p>
              )}
            </Accordion>
          </>
        );
      default:
        return (
          <Accordion title={propertiesTab}>
            <p className="cad-editor__hint">Properties for {propertiesTab} — wire via workspace context.</p>
          </Accordion>
        );
    }
  };

  const exportLinks = activeJob
    ? cadExportLinks(activeJob.model_formats, activeJob.public_url)
    : [];

  return (
    <section className="cad-editor cad-editor--properties">
      <div className="cad-studio__panel-head">
        <span>{selectedEntity?.name || 'Properties'}</span>
        <span />
        <span>Pin</span>
      </div>
      <div className="cad-studio__props-body">
        <div className="cad-studio__prop-tabs">
          {TAB_DEFS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              className={`cad-studio__prop-tab${propertiesTab === t.id ? ' active' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="cad-studio__props-scroll">
          {renderTab()}
          {exportLinks.length > 0 ? (
            <Accordion title="Export">
              <p className="text-[10px] text-muted leading-snug mb-2">
                STL for 3D printing; OBJ/PLY when you need materials or vertex colors. Verify size in
                your slicer before printing.
              </p>
              {exportLinks.map((link) => (
                <div key={link.format} className="cad-studio__artifact-row">
                  <span>
                    {activeJob?.engine || 'cad'} <span style={{ color: '#8994a2' }}>{link.label}</span>
                  </span>
                  <button
                    type="button"
                    className="cad-studio__download-btn"
                    onClick={() =>
                      downloadCadAsset(
                        link.url,
                        `${activeJob?.engine || 'cad'}-${link.format}.${link.format === '3mf' ? '3mf' : link.format}`,
                      )
                    }
                  >
                    Download
                  </button>
                </div>
              ))}
              {onDeployJob && activeJob ? (
                <div className="cad-studio__artifact-row" style={{ marginTop: 8 }}>
                  <span>Viewport</span>
                  <button
                    type="button"
                    className="cad-studio__download-btn"
                    onClick={() => onDeployJob(activeJob)}
                  >
                    Spawn
                  </button>
                </div>
              ) : null}
            </Accordion>
          ) : activeJob?.public_url ? (
            <Accordion title="Artifacts">
              <div className="cad-studio__artifact-row">
                <span>
                  {activeJob.engine} export <span style={{ color: '#8994a2' }}>GLB</span>
                </span>
                <button type="button" className="cad-studio__download-btn" onClick={() => onDeployJob?.(activeJob)}>
                  Spawn
                </button>
                <button type="button" className="cad-studio__download-btn" onClick={onDownloadLatestGlb}>
                  Download
                </button>
              </div>
            </Accordion>
          ) : null}
        </div>
      </div>
    </section>
  );
}
