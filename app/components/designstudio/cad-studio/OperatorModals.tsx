import React, { useMemo, useState } from 'react';
import {
  CAD_OPERATORS,
  DEFAULT_OPERATOR_PROMPT,
  isViewportLocalOperator,
  type CadOperator,
} from './operators';
import { dispatchCadChat, dispatchGenerateCadObject } from './dispatchCadChat';

export type OperatorSearchModalProps = {
  open: boolean;
  onClose: () => void;
  workspace: string;
  selectedObjectId: string | null;
  sceneId: string | null;
  initialOperatorId?: string;
  /** Runs viewport-local operators (Add Cube, etc.) without Agent chat. */
  onRunLocalOperator?: (operatorId: string) => void;
  /** Runs Meshy HTTP operators without Agent chat. */
  onRunMeshyOperator?: (operatorId: string, prompt?: string) => void | Promise<void>;
};

export function OperatorSearchModal({
  open,
  onClose,
  workspace,
  selectedObjectId,
  sceneId,
  initialOperatorId,
  onRunLocalOperator,
  onRunMeshyOperator,
}: OperatorSearchModalProps) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<CadOperator>(
    CAD_OPERATORS.find((c) => c.id === initialOperatorId) ?? CAD_OPERATORS[0],
  );
  const [prompt, setPrompt] = useState(DEFAULT_OPERATOR_PROMPT);

  React.useEffect(() => {
    if (initialOperatorId) {
      const cmd = CAD_OPERATORS.find((c) => c.id === initialOperatorId);
      if (cmd) setSelected(cmd);
    }
  }, [initialOperatorId, open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return CAD_OPERATORS;
    return CAD_OPERATORS.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.engine.toLowerCase().includes(q),
    );
  }, [filter]);

  const needsPrompt =
    selected.id.startsWith('generate') ||
    selected.id === 'repairGeometry' ||
    selected.id === 'meshyRetexture';

  const isLocal = selected.execution === 'local' || isViewportLocalOperator(selected.id);
  const isMeshyApi = selected.execution === 'api' || selected.engine === 'Meshy';

  const submit = () => {
    if (isLocal) {
      onRunLocalOperator?.(selected.id);
      onClose();
      return;
    }
    if (isMeshyApi) {
      void onRunMeshyOperator?.(selected.id, needsPrompt ? prompt : undefined);
      onClose();
      return;
    }
    dispatchCadChat({
      operator: selected,
      prompt: needsPrompt ? prompt : undefined,
      workspace,
      selectedObjectId,
      sceneId,
      send: true,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="cad-studio__operator-backdrop open"
      role="dialog"
      aria-modal="true"
      aria-label="Operator Search"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="cad-studio__operator">
        <input
          className="cad-studio__operator-input"
          placeholder="Search operators..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <div className="cad-studio__operator-body">
          <div className="cad-studio__command-list">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cad-studio__command-row${selected.id === c.id ? ' active' : ''}`}
                onClick={() => setSelected(c)}
              >
                <span>{c.title}</span>
                <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--cs-mono)' }}>{c.type}</span>
              </button>
            ))}
          </div>
          <div className="cad-studio__operator-detail">
            <h3 style={{ margin: 0, fontSize: 14 }}>{selected.title}</h3>
            <p style={{ margin: 0, color: '#9faab8', lineHeight: 1.45, fontSize: 12 }}>{selected.description}</p>
            {needsPrompt ? (
              <textarea
                className="cad-studio__prompt-area"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            ) : null}
            <pre className="cad-studio__mini-code">{`operator: iamcad.operator.${selected.id}\nroute: ${
              isLocal
                ? 'Viewport → AgentSamEngine (local)'
                : isMeshyApi
                  ? 'CAD API → Meshy (/api/cad/meshy/*)'
                  : 'ChatAssistant → Agent tools'
            }\nworkspace: ${workspace}`}</pre>
            <div className="cad-studio__operator-actions">
              <button type="button" className="cad-studio__secondary-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="cad-studio__primary-btn" onClick={submit}>
                {isLocal ? 'Run in viewport' : isMeshyApi ? 'Run Meshy API' : 'Send to Agent'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type GenerateCadModalProps = {
  open: boolean;
  onClose: () => void;
  workspace: string;
  sceneId: string | null;
  /** When set and engine=Meshy, runs CAD Meshy API instead of Agent chat. */
  onMeshyGenerate?: (prompt: string) => void | Promise<void>;
};

export function GenerateCadModal({
  open,
  onClose,
  workspace,
  sceneId,
  onMeshyGenerate,
}: GenerateCadModalProps) {
  const [prompt, setPrompt] = useState(DEFAULT_OPERATOR_PROMPT);
  const [engine, setEngine] = useState('Meshy');
  const [target, setTarget] = useState('viewport');
  const [units, setUnits] = useState('meters');
  const [quality, setQuality] = useState('high');

  if (!open) return null;

  const isMeshy = /meshy/i.test(engine);

  return (
    <div
      className="cad-studio__operator-backdrop open"
      role="dialog"
      aria-modal="true"
      aria-label="Generate CAD Object"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="cad-studio__operator cad-studio__generate-modal">
        <div className="cad-editor__head">Generate CAD Object</div>
        <div className="cad-studio__generate-body">
          <textarea
            className="cad-studio__prompt-area"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the object to generate…"
          />
          <div className="cad-studio__field-grid two">
            <span className="cad-studio__field-label">Engine</span>
            <select className="cad-studio__field-input" value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="Meshy">Meshy</option>
              <option value="Blender">Blender</option>
              <option value="OpenSCAD">OpenSCAD</option>
              <option value="FreeCAD">FreeCAD</option>
            </select>
          </div>
          <div className="cad-studio__field-grid two">
            <span className="cad-studio__field-label">Target</span>
            <select className="cad-studio__field-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="viewport">Viewport</option>
              <option value="assets">Assets library</option>
            </select>
          </div>
          <div className="cad-studio__field-grid two">
            <span className="cad-studio__field-label">Units</span>
            <select className="cad-studio__field-input" value={units} onChange={(e) => setUnits(e.target.value)}>
              <option value="meters">Meters</option>
              <option value="millimeters">Millimeters</option>
            </select>
          </div>
          <div className="cad-studio__field-grid two">
            <span className="cad-studio__field-label">Quality</span>
            <select className="cad-studio__field-input" value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="draft">Draft</option>
              <option value="high">High</option>
              <option value="ultra">Ultra</option>
            </select>
          </div>
          <div className="cad-studio__operator-actions">
            <button type="button" className="cad-studio__secondary-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="cad-studio__primary-btn"
              onClick={() => {
                if (isMeshy && onMeshyGenerate) {
                  void onMeshyGenerate(prompt);
                  onClose();
                  return;
                }
                dispatchGenerateCadObject({ prompt, engine, target, units, quality, workspace, sceneId });
                onClose();
              }}
            >
              {isMeshy && onMeshyGenerate ? 'Run Meshy API' : 'Send to Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
