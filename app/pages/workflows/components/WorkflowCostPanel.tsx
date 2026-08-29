import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { WorkflowGraph, WorkflowRunDetail } from '../workflowTypes';
import { fetchWorkflowRun } from '../lib/workflowApi';
import { pickModelFields } from '../lib/workflowGraphAdapter';
import type { WorkflowRunState } from '../../../components/ChatAssistant/components/WorkflowRunBoard';

function fmtUsd(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'Not measured yet';
  return `$${n.toFixed(n < 0.01 ? 4 : 3)}`;
}

type Props = {
  graph: WorkflowGraph | null;
  runState: WorkflowRunState;
};

export function WorkflowCostPanel({ graph, runState }: Props) {
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runState.runId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchWorkflowRun(runState.runId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runState.runId, runState.status]);

  const run = detail?.run ?? {};
  const summary = graph?.runsSummary;
  const steps = detail?.steps ?? [];

  return (
    <div className="space-y-3">
      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Run cost receipt</div>
        {loading && (
          <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--wf-muted)' }}>
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && !runState.runId && (
          <div className="wf-empty">Start a run to see token and cost metrics from agentsam_workflow_runs.</div>
        )}
        {runState.runId && (
          <dl style={{ margin: 0, fontSize: 11, display: 'grid', gap: 6 }}>
            <div>
              <dt style={{ color: 'var(--wf-muted)' }}>cost_usd</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--wf-font-mono)' }}>{fmtUsd(run.cost_usd)}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--wf-muted)' }}>tokens</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--wf-font-mono)' }}>
                in {run.input_tokens ?? '—'} · out {run.output_tokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt style={{ color: 'var(--wf-muted)' }}>duration_ms</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--wf-font-mono)' }}>
                {run.duration_ms != null ? run.duration_ms : 'Not measured yet'}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Budget guardrail</div>
        <dl style={{ margin: 0, fontSize: 11, display: 'grid', gap: 6 }}>
          <div>
            <dt style={{ color: 'var(--wf-muted)' }}>max_cost_usd</dt>
            <dd style={{ margin: 0, fontFamily: 'var(--wf-font-mono)' }}>{fmtUsd(run.max_cost_usd)}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--wf-muted)' }}>max_total_tokens</dt>
            <dd style={{ margin: 0, fontFamily: 'var(--wf-font-mono)' }}>
              {run.max_total_tokens != null ? run.max_total_tokens : 'Not measured yet'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Workflow history (D1 aggregate)</div>
        {summary && summary.run_count > 0 ? (
          <dl style={{ margin: 0, fontSize: 11, display: 'grid', gap: 6 }}>
            <div>
              <dt style={{ color: 'var(--wf-muted)' }}>avg_cost_usd</dt>
              <dd style={{ margin: 0 }}>{fmtUsd(summary.avg_cost_usd)}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--wf-muted)' }}>runs</dt>
              <dd style={{ margin: 0 }}>{summary.run_count}</dd>
            </div>
          </dl>
        ) : (
          <div className="wf-empty">Not measured yet for this workflow_key.</div>
        )}
      </div>

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Per-step cost</div>
        {steps.length === 0 ? (
          <div className="wf-empty">No execution_steps rows for this run yet.</div>
        ) : (
          steps.map((s) => {
            const f = pickModelFields(s as Record<string, unknown>);
            return (
              <div key={String(s.id ?? s.node_key)} style={{ fontSize: 10, padding: '6px 0', borderBottom: '1px solid var(--wf-border)' }}>
                <strong>{String(s.node_key)}</strong>
                <div style={{ color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>
                  {fmtUsd(f.cost_usd)} · {f.tokens_in ?? '—'}/{f.tokens_out ?? '—'} tok ·{' '}
                  {f.latency_ms != null ? `${f.latency_ms}ms` : '—'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
