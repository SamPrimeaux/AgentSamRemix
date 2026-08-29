import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { WorkflowRunDetail } from '../workflowTypes';
import { fetchWorkflowRun } from '../lib/workflowApi';
import { pickModelFields } from '../lib/workflowGraphAdapter';
import {
  WorkflowApprovalGate,
  type WorkflowRunState,
} from '../../../components/ChatAssistant/components/WorkflowRunBoard';
import { resolveWorkflowRunPresence } from '../../../components/ChatAssistant/components/workflowRunPresence';
import { AgentPresenceCard } from '../../../features/mode-presence/AgentPresenceCard';

type Props = {
  runState: WorkflowRunState;
  onApprove: (decision: 'approved' | 'denied') => Promise<void>;
  approvalBusy: boolean;
  onStartRun: () => void;
  canRun: boolean;
  isRunning: boolean;
};

export function WorkflowRunPanel({
  runState,
  onApprove,
  approvalBusy,
  onStartRun,
  canRun,
  isRunning,
}: Props) {
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!runState.runId || runState.status === 'idle') {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchWorkflowRun(runState.runId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runState.runId, runState.status, runState.stepsCompleted]);

  const progress =
    runState.stepsTotal > 0
      ? Math.round((runState.stepsCompleted / runState.stepsTotal) * 100)
      : null;

  const presenceView = resolveWorkflowRunPresence(runState, 'multitask');
  const steps = detail?.steps ?? [];
  const modelRows = steps.map((s) => ({
    node_key: String(s.node_key ?? ''),
    status: String(s.status ?? ''),
    ...pickModelFields(s as Record<string, unknown>),
  }));

  return (
    <div className="space-y-3">
      {presenceView ? (
        <AgentPresenceCard
          mode="multitask"
          state={presenceView.state}
          title={presenceView.title}
          description={presenceView.description}
          meta={presenceView.meta}
        >
          {progress != null ? (
            <div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--wf-border)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--wf-accent)',
                    transition: 'width 200ms ease',
                  }}
                />
              </div>
            </div>
          ) : null}
        </AgentPresenceCard>
      ) : null}

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Current run</div>
        <div style={{ fontSize: 10, color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>
          Status: {runState.status}
          {runState.runId && (
            <>
              <br />
              run: {runState.runId}
            </>
          )}
        </div>
        <button
          type="button"
          className="wf-btn primary"
          style={{ marginTop: 10, width: '100%' }}
          disabled={!canRun || isRunning}
          onClick={onStartRun}
        >
          {isRunning ? 'Running…' : 'Run workflow (SSE)'}
        </button>
        {runState.errorMessage && (
          <p style={{ marginTop: 8, fontSize: 11, color: 'var(--wf-danger)' }}>{runState.errorMessage}</p>
        )}
      </div>

      {runState.status === 'awaiting_approval' && (
        <WorkflowApprovalGate onApprove={onApprove} busy={approvalBusy} />
      )}

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Live timeline</div>
        {runState.steps.length === 0 && !detailLoading && (
          <div className="wf-empty">No steps yet. Start a run to stream workflow_step events.</div>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {runState.steps.map((s) => (
            <li
              key={s.node_key}
              style={{
                fontSize: 11,
                padding: '6px 0',
                borderBottom: '1px solid var(--wf-border)',
                color: s.status === 'failed' ? 'var(--wf-danger)' : 'var(--wf-text)',
              }}
            >
              {s.node_key} — {s.status}
            </li>
          ))}
        </ul>
        {detailLoading && (
          <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--wf-muted)', marginTop: 6 }}>
            <Loader2 size={12} className="animate-spin" /> Loading run detail…
          </div>
        )}
      </div>

      <div className="wf-card">
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Run Results and Model Scores</div>
        {modelRows.length === 0 ? (
          <div className="wf-empty">Not measured yet — execution steps will populate after the run completes.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {modelRows.map((r) => (
              <div key={r.node_key} className="wf-card" style={{ padding: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{r.node_key}</div>
                <div style={{ fontSize: 10, color: 'var(--wf-muted)', marginTop: 4, fontFamily: 'var(--wf-font-mono)' }}>
                  {r.model_key || r.provider ? (
                    <>
                      model: {r.model_key || '—'} · provider: {r.provider || '—'}
                    </>
                  ) : (
                    'model_key/provider not in step row'
                  )}
                  <br />
                  quality: {r.quality_score != null ? r.quality_score : '—'} · latency:{' '}
                  {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                  <br />
                  tokens: {r.tokens_in ?? '—'} in / {r.tokens_out ?? '—'} out · cost:{' '}
                  {r.cost_usd != null ? `$${r.cost_usd}` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
