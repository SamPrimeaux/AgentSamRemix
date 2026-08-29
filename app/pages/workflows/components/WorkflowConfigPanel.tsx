import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, Trash2, Plus, ArrowRight } from 'lucide-react';
import type { WorkflowGraph, WorkflowGraphNode } from '../workflowTypes';
import { EXECUTOR_NODE_TYPES } from '../workflowTypes';
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  patchWorkflow,
  updateNode,
} from '../lib/workflowApi';
import { WorkflowNodeIcon, nodeAccent } from '../WorkflowNodeIcon';
import { apiNodeTypeToUi } from '../workflowTypes';

type Props = {
  graph: WorkflowGraph | null;
  selectedNodeKey: string | null;
  connectFrom: string | null;
  onGraphChanged: () => void;
  onConnectFrom: (key: string | null) => void;
};

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="wf-section">
      <button type="button" className="wf-section-head" onClick={() => setOpen(v => !v)}>
        <span className="wf-section-title">{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="wf-section-body">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="wf-field">
      <label className="wf-field-label">{label}</label>
      {children}
    </div>
  );
}

export function WorkflowConfigPanel({
  graph,
  selectedNodeKey,
  connectFrom,
  onGraphChanged,
  onConnectFrom,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNodeType, setNewNodeType] = useState('agent');
  const [edgeTo, setEdgeTo] = useState('');
  const [edgesOpen, setEdgesOpen] = useState(false);

  const selected: WorkflowGraphNode | null =
    graph?.nodes.find((n) => n.node_key === selectedNodeKey) ?? null;

  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('agent');
  const [editHandler, setEditHandler] = useState('');

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditType(selected.node_type);
    setEditHandler(selected.handler_key ?? '');
  }, [selected?.node_key]);

  // Auto-fill edgeTo when connectFrom is set and a node is selected
  useEffect(() => {
    if (connectFrom && selectedNodeKey && selectedNodeKey !== connectFrom) {
      setEdgeTo(selectedNodeKey);
    }
  }, [connectFrom, selectedNodeKey]);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!graph) {
    return (
      <div className="wf-empty-state">
        <p>Pick a workflow from the Library to get started.</p>
      </div>
    );
  }

  const accent = selected ? nodeAccent(apiNodeTypeToUi(selected.node_type)) : 'var(--wf-accent)';

  return (
    <div className="wf-config-scroll">

      {/* Workflow identity */}
      <div className="wf-identity">
        <div className="wf-identity-name">{graph.displayName}</div>
        <div className="wf-identity-key">{graph.workflowKey}</div>
        <div className="wf-identity-tags">
          {graph.riskLevel && graph.riskLevel !== 'low' && (
            <span className="wf-tag">{graph.riskLevel} risk</span>
          )}
          {graph.signedOff ? (
            <span className="wf-tag wf-tag-signed">Signed off</span>
          ) : graph.requiresApproval ? (
            <span className="wf-tag">approval</span>
          ) : null}
        </div>
        <div className="wf-row-btns" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`wf-btn ${graph.signedOff ? '' : 'primary'}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await patchWorkflow(graph.registryId, { signed_off: !graph.signedOff });
                onGraphChanged();
              })
            }
          >
            {graph.signedOff ? 'Revoke sign-off' : 'Sign off workflow'}
          </button>
        </div>
        {!graph.signedOff && (
          <p className="wf-hint" style={{ marginTop: 6 }}>
            Sign off when setup is complete — deploy and terminal steps run without per-run approval gates.
          </p>
        )}
      </div>

      {/* Selected node editor */}
      {selected ? (
        <Section title="Step" defaultOpen>
          <div className="wf-node-header">
            <div className="wf-node-icon-sm" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)` }}>
              <WorkflowNodeIcon type={apiNodeTypeToUi(selected.node_type)} size={14} />
            </div>
            <div>
              <div className="wf-node-name">{selected.title}</div>
              <div className="wf-node-key">{selected.node_key}</div>
            </div>
          </div>
          <Field label="Title">
            <input
              className="wf-input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </Field>
          <Field label="Type">
            <select
              className="wf-input"
              value={editType}
              onChange={(e) => setEditType(e.target.value)}
            >
              {EXECUTOR_NODE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Handler">
            <input
              className="wf-input"
              value={editHandler}
              onChange={(e) => setEditHandler(e.target.value)}
              placeholder="handler_key (optional)"
            />
          </Field>
          <div className="wf-row-btns">
            <button
              type="button"
              className="wf-btn primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await updateNode(graph.registryId, selected.node_key, {
                    title: editTitle,
                    node_type: editType,
                    handler_key: editHandler || null,
                  });
                  onGraphChanged();
                })
              }
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save
            </button>
            <button
              type="button"
              className="wf-btn danger"
              disabled={busy}
              title="Delete this step"
              onClick={() =>
                void run(async () => {
                  if (!window.confirm(`Delete "${selected.title}"?`)) return;
                  await deleteNode(graph.registryId, selected.node_key);
                  onGraphChanged();
                })
              }
            >
              <Trash2 size={11} />
            </button>
          </div>
        </Section>
      ) : (
        <div className="wf-hint">Click a node to inspect and edit it.</div>
      )}

      {/* Add step */}
      <Section title="Add step" defaultOpen={false}>
        <Field label="Type">
          <select
            className="wf-input"
            value={newNodeType}
            onChange={(e) => setNewNodeType(e.target.value)}
          >
            {EXECUTOR_NODE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="wf-btn primary wf-btn-full"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const key = `step_${Date.now().toString(36).slice(-5)}`;
              await createNode(graph.registryId, {
                node_key: key,
                title: newNodeType,
                node_type: newNodeType,
              });
              onGraphChanged();
            })
          }
        >
          <Plus size={11} /> Add {newNodeType}
        </button>
      </Section>

      {/* Connect steps */}
      <Section title="Connect steps" defaultOpen={!!connectFrom}>
        {connectFrom ? (
          <div className="wf-connect-hint">
            <span className="wf-connect-from">{connectFrom}</span>
            <ArrowRight size={11} style={{ color: 'var(--wf-muted)', flexShrink: 0 }} />
            <select
              className="wf-input"
              value={edgeTo}
              onChange={(e) => setEdgeTo(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">Pick target…</option>
              {graph.nodes
                .filter((n) => n.node_key !== connectFrom)
                .map((n) => (
                  <option key={n.node_key} value={n.node_key}>{n.title}</option>
                ))}
            </select>
          </div>
        ) : (
          <p className="wf-hint">Click the link icon on the rail, then click a source node.</p>
        )}
        {connectFrom && edgeTo && (
          <button
            type="button"
            className="wf-btn primary wf-btn-full"
            disabled={busy}
            style={{ marginTop: 6 }}
            onClick={() =>
              void run(async () => {
                await createEdge(graph.registryId, connectFrom, edgeTo);
                setEdgeTo('');
                onConnectFrom(null);
                onGraphChanged();
              })
            }
          >
            Create connection
          </button>
        )}

        {/* Edge list — collapsed by default when there are many */}
        {graph.edges.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="wf-edges-toggle"
              onClick={() => setEdgesOpen(v => !v)}
            >
              {edgesOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {graph.edges.length} connection{graph.edges.length !== 1 ? 's' : ''}
            </button>
            {edgesOpen && (
              <ul className="wf-edge-list">
                {graph.edges.map((e) => (
                  <li key={e.id} className="wf-edge-row">
                    <span className="wf-edge-label">
                      {graph.nodes.find(n => n.node_key === e.from)?.title ?? e.from}
                      <ArrowRight size={9} style={{ flexShrink: 0, opacity: 0.5 }} />
                      {graph.nodes.find(n => n.node_key === e.to)?.title ?? e.to}
                    </span>
                    <button
                      type="button"
                      className="wf-edge-del"
                      title="Remove connection"
                      onClick={() =>
                        void run(async () => {
                          await deleteEdge(graph.registryId, e.id);
                          onGraphChanged();
                        })
                      }
                    >
                      <Trash2 size={9} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {error && <p className="wf-error">{error}</p>}
    </div>
  );
}
