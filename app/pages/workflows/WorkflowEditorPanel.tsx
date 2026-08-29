import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Link2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { WorkflowGraph, WorkflowGraphNode } from './workflowTypes';
import { EXECUTOR_NODE_TYPES } from './workflowTypes';
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  patchWorkflow,
  updateNode,
} from './workflowApi';
import { apiNodeTypeToUi } from './workflowTypes';
import { WorkflowNodeIcon } from './WorkflowNodeIcon';

type Props = {
  graph: WorkflowGraph | null;
  selectedNodeKey: string | null;
  onSelectNode: (key: string | null) => void;
  onGraphChanged: () => void;
  connectFrom: string | null;
  onConnectFrom: (key: string | null) => void;
};

export function WorkflowEditorPanel({
  graph,
  selectedNodeKey,
  onSelectNode,
  onGraphChanged,
  connectFrom,
  onConnectFrom,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNodeKey, setNewNodeKey] = useState('');
  const [newNodeTitle, setNewNodeTitle] = useState('');
  const [newNodeType, setNewNodeType] = useState('agent');
  const [edgeTo, setEdgeTo] = useState('');

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
      <div className="p-4 text-[12px] text-[var(--dashboard-muted)]">
        Select a workflow to edit nodes and edges.
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 py-2 border-b border-[var(--dashboard-border)] bg-[var(--scene-bg)]">
        <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-muted)]">
          Graph editor
        </div>
        <div className="text-[11px] text-[var(--dashboard-muted)] mt-0.5 truncate" title={graph.workflowKey}>
          DAG: <code className="text-[var(--solar-cyan)]">{graph.dagWorkflowId}</code>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        <section className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
            Workflow
          </div>
          <input
            className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
            value={graph.displayName}
            readOnly
          />
          <button
            type="button"
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] py-1.5 text-[11px] hover:border-[var(--solar-cyan)]/40"
            onClick={() =>
              void run(async () => {
                const name = window.prompt('Display name', graph.displayName);
                if (!name?.trim()) return;
                await patchWorkflow(graph.registryId, { display_name: name.trim() });
                onGraphChanged();
              })
            }
          >
            <Save size={12} /> Rename workflow
          </button>
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
            Add node
          </div>
          <input
            placeholder="node_key"
            value={newNodeKey}
            onChange={(e) => setNewNodeKey(e.target.value)}
            className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px] font-mono"
          />
          <input
            placeholder="Title"
            value={newNodeTitle}
            onChange={(e) => setNewNodeTitle(e.target.value)}
            className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
          />
          <select
            value={newNodeType}
            onChange={(e) => setNewNodeType(e.target.value)}
            className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
          >
            {EXECUTOR_NODE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !newNodeKey.trim()}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[var(--solar-cyan)]/15 border border-[var(--solar-cyan)]/40 py-2 text-[11px] font-semibold text-[var(--solar-cyan)] disabled:opacity-40"
            onClick={() =>
              void run(async () => {
                await createNode(graph.registryId, {
                  node_key: newNodeKey.trim(),
                  title: newNodeTitle.trim() || newNodeKey.trim(),
                  node_type: newNodeType,
                });
                setNewNodeKey('');
                setNewNodeTitle('');
                onGraphChanged();
              })
            }
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add node
          </button>
        </section>

        {selected && (
          <section className="space-y-2 rounded-xl border border-[var(--dashboard-border)] p-2.5 bg-[var(--scene-bg)]">
            <div className="flex items-center gap-2">
              <WorkflowNodeIcon type={apiNodeTypeToUi(editType)} size={18} />
              <span className="text-[12px] font-semibold truncate">{selected.node_key}</span>
            </div>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
            />
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value)}
              className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
            >
              {EXECUTOR_NODE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              placeholder="handler_key (optional)"
              value={editHandler}
              onChange={(e) => setEditHandler(e.target.value)}
              className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[11px] font-mono"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-[var(--dashboard-border)] py-1.5 text-[11px]"
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
                <Save size={12} /> Save
              </button>
              <button
                type="button"
                disabled={busy}
                className="flex items-center justify-center gap-1 rounded-lg border border-red-500/30 text-red-400 px-2 py-1.5 text-[11px]"
                onClick={() =>
                  void run(async () => {
                    if (!window.confirm(`Delete node ${selected.node_key}?`)) return;
                    await deleteNode(graph.registryId, selected.node_key);
                    onSelectNode(null);
                    onGraphChanged();
                  })
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
            <button
              type="button"
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] border ${
                connectFrom === selected.node_key
                  ? 'border-[var(--solar-cyan)] bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)]'
                  : 'border-[var(--dashboard-border)] text-[var(--dashboard-muted)]'
              }`}
              onClick={() =>
                onConnectFrom(connectFrom === selected.node_key ? null : selected.node_key)
              }
            >
              <Link2 size={12} />
              {connectFrom === selected.node_key ? 'Cancel link' : 'Link from this node'}
            </button>
          </section>
        )}

        {connectFrom && (
          <section className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
              New edge from <code className="text-[var(--solar-cyan)]">{connectFrom}</code>
            </div>
            <select
              value={edgeTo}
              onChange={(e) => setEdgeTo(e.target.value)}
              className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2 py-1.5 text-[12px]"
            >
              <option value="">Select target node</option>
              {graph.nodes
                .filter((n) => n.node_key !== connectFrom)
                .map((n) => (
                  <option key={n.node_key} value={n.node_key}>
                    {n.title}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={busy || !edgeTo}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--solar-cyan)]/40 py-1.5 text-[11px] text-[var(--solar-cyan)] disabled:opacity-40"
              onClick={() =>
                void run(async () => {
                  await createEdge(graph.registryId, connectFrom, edgeTo);
                  setEdgeTo('');
                  onConnectFrom(null);
                  onGraphChanged();
                })
              }
            >
              <Link2 size={12} /> Create edge
            </button>
          </section>
        )}

        <section className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
            Edges ({graph.edges.length})
          </div>
          {graph.edges.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--dashboard-border)] px-2 py-1 text-[10px] font-mono"
            >
              <span className="truncate text-[var(--dashboard-muted)]">
                {e.from} → {e.to}
              </span>
              <button
                type="button"
                disabled={busy}
                className="shrink-0 text-red-400 hover:text-red-300"
                onClick={() =>
                  void run(async () => {
                    await deleteEdge(graph.registryId, e.id);
                    onGraphChanged();
                  })
                }
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
