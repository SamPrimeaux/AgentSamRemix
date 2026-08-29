import React, { useMemo, useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import type { WorkflowListItem } from '../workflowTypes';
import { AppIcon } from '../../../components/ui/AppIcon';
import { isStarterWorkflow, starterIconSlug } from '../lib/resolveWorkflowNodeBrand';
import '../../../components/ui/AppIcon.css';

function pct(success: number, total: number): string | null {
  if (total <= 0) return null;
  return `${Math.round((success / total) * 100)}%`;
}

function formatCost(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Not measured yet';
  return `$${v.toFixed(v < 0.01 ? 4 : 3)}`;
}

type Props = {
  workflows: WorkflowListItem[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onCreate?: () => void;
};

export function WorkflowLibraryView({
  workflows,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
}: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? workflows.filter(
          (w) =>
            (w.display_name || '').toLowerCase().includes(needle) ||
            (w.workflow_key || '').toLowerCase().includes(needle),
        )
      : workflows;
    return [...base].sort((a, b) => {
      const aStarter = isStarterWorkflow(a.workflow_key) ? 0 : 1;
      const bStarter = isStarterWorkflow(b.workflow_key) ? 0 : 1;
      if (aStarter !== bStarter) return aStarter - bStarter;
      return (a.display_name || a.workflow_key).localeCompare(b.display_name || b.workflow_key);
    });
  }, [workflows, q]);

  return (
    <div className="wf-drawer-body" style={{ padding: 12 }}>
      <div style={{ marginBottom: 10 }}>
        <input
          className="wf-search"
          placeholder="Search saved workflows…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            width: '100%',
            height: 34,
            borderRadius: 10,
            border: '1px solid var(--wf-border)',
            background: 'var(--wf-surface)',
            padding: '0 10px',
            fontSize: 12,
            color: 'var(--wf-text)',
          }}
        />
      </div>
      {error && <p style={{ fontSize: 11, color: 'var(--wf-danger)' }}>{error}</p>}
      {loading && !workflows.length ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--wf-muted)', fontSize: 12 }}>
          <Loader2 size={14} className="animate-spin" /> Loading registry…
        </div>
      ) : (
        filtered.map((wf) => {
          const runs = Number(wf.run_count ?? 0);
          const success = Number(wf.success_count ?? 0);
          const fail = Number(wf.fail_count ?? 0);
          const successPct = pct(success, runs);
          const failPct = pct(fail, runs);
          const starter = isStarterWorkflow(wf.workflow_key);
          const slug = starterIconSlug(wf.workflow_key);
          return (
            <button
              key={wf.id}
              type="button"
              className={`wf-library-card${selectedId === wf.id ? ' active' : ''}`}
              onClick={() => onSelect(wf.id)}
            >
              {starter && slug ? (
                <AppIcon
                  title={wf.display_name || wf.workflow_key}
                  iconSlug={slug}
                  size="sm"
                  className="wf-library-starter-icon"
                />
              ) : (
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--wf-accent-soft)',
                    color: 'var(--wf-accent)',
                    border: '1px solid color-mix(in srgb, var(--wf-accent) 25%, var(--wf-border))',
                  }}
                >
                  <GitBranch size={16} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {wf.display_name || wf.workflow_key}
                  {starter ? <span className="wf-tag accent">Starter</span> : null}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--wf-muted)', lineHeight: 1.3 }}>
                  {wf.description || wf.workflow_key}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  <span className="wf-tag accent">{wf.node_count ?? 0} nodes</span>
                  {wf.risk_level && wf.risk_level !== 'low' && (
                    <span className="wf-tag">{wf.risk_level}</span>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  <div className="wf-card" style={{ padding: 6 }}>
                    <span style={{ fontSize: 8, color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>Success</span>
                    <strong style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                      {successPct ?? 'Not measured yet'}
                    </strong>
                  </div>
                  <div className="wf-card" style={{ padding: 6 }}>
                    <span style={{ fontSize: 8, color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>Fail</span>
                    <strong style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                      {failPct ?? (runs ? '0%' : 'Not measured yet')}
                    </strong>
                  </div>
                  <div className="wf-card" style={{ padding: 6 }}>
                    <span style={{ fontSize: 8, color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>Runs</span>
                    <strong style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{runs || '0'}</strong>
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: 'var(--wf-muted)' }}>
                  Avg cost: {formatCost(wf.avg_cost_usd)}
                </div>
              </div>
            </button>
          );
        })
      )}
      {!loading && !workflows.length && (
        <div className="wf-empty">
          No workflows yet.
          {onCreate ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="wf-btn primary" onClick={onCreate}>
                Create your first DAG
              </button>
            </div>
          ) : null}
        </div>
      )}
      {!loading && workflows.length > 0 && !filtered.length && (
        <div className="wf-empty">No workflows match your search.</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {onCreate ? (
          <button type="button" className="wf-btn primary" style={{ flex: 1 }} onClick={onCreate}>
            New workflow
          </button>
        ) : null}
        <button type="button" className="wf-btn" style={{ flex: 1 }} onClick={onRefresh}>
          Refresh library
        </button>
      </div>
    </div>
  );
}
