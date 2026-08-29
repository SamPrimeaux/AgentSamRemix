/**
 * WorkflowRunBoard — D1-driven workflow execution UI
 *
 * Components:
 *   WorkflowPicker        — shows agentsam_workflows rows; triggers POST .../run SSE
 *   WorkflowRunCard       — live run card driven by workflow_start/step/complete SSE events
 *   WorkflowApprovalGate  — inline Allow/Deny for approval_gate nodes
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type { AgentMode } from '../types';
import { AgentPresenceInline } from '../../../features/mode-presence/AgentPresenceInline';
import { AgentPresenceCard } from '../../../features/mode-presence/AgentPresenceCard';
import { SmoothProgressBar } from '../../shared/SmoothProgressBar';
import '../../shared/smoothProgress.css';
import { resolveWorkflowRunPresence } from './workflowRunPresence';
import type { WorkflowRow, WorkflowRunState, WorkflowStepState } from './workflowRunTypes';

export type { WorkflowRow, WorkflowRunState, WorkflowStepState } from './workflowRunTypes';

function sseSpineRunId(d: { agent_run_id?: unknown; run_id?: unknown }): string {
  if (typeof d.agent_run_id === 'string' && d.agent_run_id.trim()) return d.agent_run_id.trim();
  if (typeof d.run_id === 'string' && d.run_id.trim()) return d.run_id.trim();
  return '';
}

// ─── Components ───────────────────────────────────────────────────────────────
export function WorkflowRunPresenceBanner({
  ledger,
  mode = 'agent',
  active = true,
}: {
  ledger: {
    runId: string | null;
    stepsTotal: number | null;
    stepsCompleted: number;
    currentNodeKey: string | null;
    lastError: string | null;
    status?: 'idle' | 'running' | 'completed' | 'failed' | null;
  };
  mode?: AgentMode;
  /** When false (stream ended), hide even if runId lingered. */
  active?: boolean;
}) {
  if (!ledger.runId || !active) return null;
  if (ledger.status === 'completed' || ledger.status === 'idle') return null;
  const runState: WorkflowRunState = {
    runId: ledger.runId,
    workflowKey: ledger.currentNodeKey,
    status: ledger.lastError || ledger.status === 'failed' ? 'failed' : 'running',
    stepsTotal: ledger.stepsTotal ?? 0,
    stepsCompleted: ledger.stepsCompleted,
    currentNodeKey: ledger.currentNodeKey,
    steps: [],
    approvalId: null,
    errorMessage: ledger.lastError,
  };
  const view = resolveWorkflowRunPresence(runState, mode);
  if (!view) return null;

  const plannedOk =
    ledger.stepsTotal != null &&
    ledger.stepsTotal > 0 &&
    ledger.stepsCompleted <= ledger.stepsTotal;
  const pct = plannedOk
    ? Math.min(100, (ledger.stepsCompleted / Number(ledger.stepsTotal)) * 100)
    : null;

  return (
    <div className="min-w-0 space-y-2">
      <AgentPresenceInline
        mode={mode}
        state={view.state}
        title={view.title}
        meta={view.meta}
        size="sm"
      />
      {plannedOk ? (
        <div className="pl-10 pr-1">
          <SmoothProgressBar value={pct} indeterminate={false} showLabel height={3} />
        </div>
      ) : ledger.status === 'running' ? (
        <div className="pl-10 pr-1">
          <SmoothProgressBar value={null} indeterminate={!ledger.lastError} showLabel={false} height={3} />
        </div>
      ) : null}
    </div>
  );
}

// ─── WorkflowPicker ──────────────────────────────────────────────────────────

interface WorkflowPickerProps {
  onStartWorkflow: (workflow: WorkflowRow) => void;
  isRunning: boolean;
}

export const WorkflowPicker: React.FC<WorkflowPickerProps> = ({ onStartWorkflow, isRunning }) => {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agentsam/workflows', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 px-3 text-[var(--dashboard-muted)] text-[12px]">
        <Loader2 size={14} className="animate-spin shrink-0" />
        Loading workflows…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3 space-y-2">
        <p className="text-[11px] text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 text-[11px] text-[var(--solar-cyan)] hover:brightness-110"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  if (!workflows.length) {
    return (
      <div className="px-3 py-4 text-[12px] text-[var(--dashboard-muted)]">
        No active workflows found in <code className="text-[var(--solar-cyan)]">agentsam_workflows</code>.
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-muted)] opacity-70 pb-1">
        D1 Workflows — select to run
      </div>
      {workflows.map((wf) => {
        const isRisky = String(wf.risk_level || '').toLowerCase() === 'high';
        const signedOff =
          wf.signed_off === true ||
          (() => {
            try {
              const raw = wf.metadata_json;
              const meta =
                raw && typeof raw === 'object'
                  ? raw
                  : JSON.parse(String(raw || '{}'));
              return meta?.signed_off === true;
            } catch {
              return false;
            }
          })();
        const needsApproval = !signedOff && !!wf.requires_approval;
        return (
          <button
            key={wf.id}
            id={`workflow-card-${wf.id}`}
            type="button"
            disabled={isRunning}
            onClick={() => onStartWorkflow(wf)}
            className={`group w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
              isRunning
                ? 'opacity-50 cursor-not-allowed border-[var(--dashboard-border)] bg-[var(--scene-bg)]'
                : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] hover:border-[var(--solar-cyan)]/50 hover:bg-[var(--dashboard-panel)] cursor-pointer'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              <Zap
                size={16}
                className={`transition-colors ${
                  isRisky
                    ? 'text-orange-400'
                    : 'text-[var(--solar-cyan)] group-hover:brightness-125'
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-[var(--dashboard-text)] truncate">
                  {wf.display_name || wf.workflow_key}
                </span>
                {isRisky && (
                  <span className="shrink-0 px-1.5 py-0 rounded text-[8px] font-bold uppercase tracking-wide bg-orange-500/15 text-orange-400 border border-orange-500/25">
                    high risk
                  </span>
                )}
                {needsApproval && (
                  <span className="shrink-0 px-1.5 py-0 rounded text-[8px] font-bold uppercase tracking-wide bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    approval
                  </span>
                )}
                {signedOff && (
                  <span className="shrink-0 px-1.5 py-0 rounded text-[8px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    signed off
                  </span>
                )}
              </div>
              {wf.description && (
                <p className="text-[11px] text-[var(--dashboard-muted)] leading-snug line-clamp-2 mt-0.5">
                  {wf.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                {wf.node_count != null && (
                  <span className="text-[9px] text-[var(--dashboard-muted)]">
                    {wf.node_count} nodes · {wf.edge_count ?? 0} edges
                  </span>
                )}
              </div>
            </div>
            <ChevronRight
              size={14}
              className="shrink-0 mt-1 text-[var(--dashboard-muted)] group-hover:text-[var(--solar-cyan)] transition-colors"
            />
          </button>
        );
      })}
    </div>
  );
};

// ─── WorkflowRunCard ─────────────────────────────────────────────────────────

interface WorkflowRunCardProps {
  runState: WorkflowRunState;
  onApprove: (decision: 'approved' | 'denied') => Promise<void>;
  approvalBusy: boolean;
  mode?: AgentMode;
}

function stepStatusIcon(status: WorkflowStepState['status']) {
  switch (status) {
    case 'running':
      return <Loader2 size={12} className="animate-spin text-[var(--solar-cyan)]" />;
    case 'success':
      return <CheckCircle2 size={12} className="text-emerald-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'approval_pending':
      return <ShieldAlert size={12} className="text-yellow-400 animate-pulse" />;
    default:
      return <Clock size={12} className="text-[var(--dashboard-muted)]" />;
  }
}

export const WorkflowRunCard: React.FC<WorkflowRunCardProps> = ({
  runState,
  onApprove,
  approvalBusy,
  mode = 'multitask',
}) => {
  const { runId, workflowKey, status, stepsTotal, stepsCompleted, steps, approvalId, errorMessage } = runState;

  // Avoid a fake 100% bar when completed overshoots a sticky steps_total=1.
  const pct =
    stepsTotal > 0 && stepsCompleted <= stepsTotal
      ? Math.min(100, Math.round((stepsCompleted / stepsTotal) * 100))
      : 0;

  const presenceView = resolveWorkflowRunPresence(runState, mode);

  if (status === 'idle' || !runId) return null;

  return (
    <div
      id={`workflow-run-card-${runId ?? 'pending'}`}
      className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] overflow-hidden"
    >
      {presenceView ? (
        <div className="p-3 border-b border-[var(--dashboard-border)]">
          <AgentPresenceCard
            mode={mode}
            state={presenceView.state}
            title={presenceView.title}
            description={presenceView.description}
            meta={presenceView.meta}
          />
        </div>
      ) : null}

      {/* Progress bar — hide fake N/1 denominators from chat tool sessions */}
      {stepsTotal > 0 && stepsCompleted <= stepsTotal && (
        <div className="px-3 pt-2 pb-1">
          <SmoothProgressBar
            value={pct}
            indeterminate={stepsCompleted === 0 && status === 'running'}
            showLabel
            height={3}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-[var(--dashboard-muted)]">
              {stepsCompleted} / {stepsTotal} steps
            </span>
          </div>
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <div className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
          {steps.map((step) => (
            <div key={step.node_key} className="flex items-center gap-2">
              {stepStatusIcon(step.status)}
              <span
                className={`text-[10px] font-mono truncate ${
                  step.status === 'running'
                    ? 'text-[var(--solar-cyan)]'
                    : step.status === 'success'
                    ? 'text-emerald-400'
                    : step.status === 'failed'
                    ? 'text-red-400'
                    : 'text-[var(--dashboard-muted)]'
                }`}
              >
                {step.node_key}
              </span>
              {step.node_type && (
                <span className="shrink-0 text-[8px] text-[var(--dashboard-muted)] opacity-60">
                  {step.node_type}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-red-400 leading-snug">{errorMessage}</p>
        </div>
      )}

      {/* Approval gate */}
      {status === 'awaiting_approval' && (
        <WorkflowApprovalGate
          runId={runId}
          approvalId={approvalId}
          onApprove={onApprove}
          busy={approvalBusy}
        />
      )}

      {/* Run ID footer */}
      {runId && (
        <div className="px-3 py-1.5 border-t border-[var(--dashboard-border)]">
          <span className="text-[8px] font-mono text-[var(--dashboard-muted)] opacity-50">
            run: {runId}
          </span>
        </div>
      )}
    </div>
  );
};

// ─── WorkflowApprovalGate ────────────────────────────────────────────────────

interface WorkflowApprovalGateProps {
  runId: string | null;
  approvalId: string | null;
  onApprove: (decision: 'approved' | 'denied') => Promise<void>;
  busy: boolean;
}

export const WorkflowApprovalGate: React.FC<WorkflowApprovalGateProps> = ({
  onApprove,
  busy,
}) => {
  return (
    <div className="px-3 py-3 border-t border-yellow-500/20 bg-yellow-500/5 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="shrink-0 text-yellow-400" />
        <span className="text-[11px] font-semibold text-yellow-300">
          Approval gate — this node requires your approval to continue
        </span>
      </div>
      <div className="flex gap-2">
        <button
          id="workflow-approval-allow"
          type="button"
          disabled={busy}
          onClick={() => void onApprove('approved')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
          Allow
        </button>
        <button
          id="workflow-approval-deny"
          type="button"
          disabled={busy}
          onClick={() => void onApprove('denied')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          <XCircle size={11} />
          Deny
        </button>
      </div>
    </div>
  );
};

// ─── useWorkflowRunner hook ──────────────────────────────────────────────────

const INITIAL_RUN_STATE: WorkflowRunState = {
  runId: null,
  workflowKey: null,
  status: 'idle',
  stepsTotal: 0,
  stepsCompleted: 0,
  currentNodeKey: null,
  steps: [],
  approvalId: null,
  errorMessage: null,
  executionEngine: null,
};

export function useWorkflowRunner(opts: {
  onSseChunk?: (data: Record<string, unknown>) => void;
}) {
  const [runState, setRunState] = useState<WorkflowRunState>(INITIAL_RUN_STATE);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const resetRun = useCallback(() => {
    abortRef.current?.abort();
    setRunState(INITIAL_RUN_STATE);
    setApprovalBusy(false);
  }, []);

  const pollDurableRun = useCallback(async (runId: string, signal: AbortSignal) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (!signal.aborted) {
      const res = await fetch(`/api/agentsam/workflow-runs/${encodeURIComponent(runId)}`, {
        credentials: 'same-origin',
        signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        run?: {
          status?: string;
          steps_total?: number;
          steps_completed?: number;
          current_node_key?: string | null;
          step_results_json?: string;
        };
        steps?: Array<{ node_key?: string; status?: string; ok?: boolean }>;
        approvals?: Array<{ id?: string; status?: string }>;
      };
      if (!res.ok) {
        setRunState((p) => ({
          ...p,
          status: 'error',
          errorMessage: (json as { error?: string }).error ?? `Poll failed (${res.status})`,
        }));
        return;
      }
      const run = json.run ?? {};
      const st = String(run.status ?? 'running').toLowerCase();
      let steps: WorkflowStepState[] = [];
      try {
        const parsed = JSON.parse(String(run.step_results_json || '[]')) as Array<{
          node_key?: string;
          node_type?: string;
          ok?: boolean;
        }>;
        steps = parsed.map((s) => ({
          node_key: String(s.node_key ?? ''),
          node_type: s.node_type,
          status: s.ok === false ? 'failed' : 'success',
          ok: s.ok !== false,
        }));
      } catch {
        steps = (json.steps ?? []).map((s) => ({
          node_key: String(s.node_key ?? ''),
          status: s.ok === false ? 'failed' : 'success',
          ok: s.ok !== false,
        }));
      }
      const pendingApproval = (json.approvals ?? []).find((a) => a.status === 'pending');
      setRunState((p) => ({
        ...p,
        runId,
        executionEngine: 'durable',
        stepsTotal: Number(run.steps_total ?? p.stepsTotal),
        stepsCompleted: Number(run.steps_completed ?? steps.length),
        currentNodeKey: run.current_node_key ?? p.currentNodeKey,
        steps,
        approvalId: pendingApproval?.id ?? (st === 'awaiting_approval' ? p.approvalId : null),
        status:
          st === 'awaiting_approval'
            ? 'awaiting_approval'
            : st === 'completed'
              ? 'completed'
              : st === 'failed'
                ? 'failed'
                : 'running',
      }));
      if (['completed', 'failed', 'cancelled', 'error'].includes(st)) return;
      await sleep(2000);
    }
  }, []);

  const consumeWorkflowSse = useCallback(
    async (res: Response, signal: AbortSignal) => {
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        setRunState((p) => ({ ...p, status: 'error', errorMessage: errText || `HTTP ${res.status}` }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';

      sseLoop: while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const parts = carry.split('\n\n');
        carry = parts.pop() ?? '';
        for (const block of parts) {
          for (const line of block.split('\n')) {
            const l = line.trim();
            if (!l.startsWith('data:')) continue;
            const raw = l.replace(/^data:\s*/i, '').trim();
            if (raw === '[DONE]') break sseLoop;
            let d: Record<string, unknown>;
            try {
              d = JSON.parse(raw);
            } catch {
              continue;
            }

            opts.onSseChunk?.(d);
            const t = String(d.type ?? '');

            if (t === 'done') break sseLoop;

            if (t === 'workflow_start') {
              const spineRunId = sseSpineRunId(d);
              setRunState((p) => ({
                ...p,
                runId: spineRunId || p.runId || '',
                stepsTotal: Number(d.steps_total ?? p.stepsTotal),
                status: 'running',
              }));
            } else if (t === 'workflow_step') {
              const nodeKey = String(d.current_node_key ?? d.node_key ?? '');
              const ok = d.ok !== false;
              setRunState((p) => {
                const steps = [...p.steps];
                const existing = steps.findIndex((s) => s.node_key === nodeKey);
                const stepState: WorkflowStepState = {
                  node_key: nodeKey,
                  status: ok ? 'success' : 'failed',
                  ok,
                };
                if (existing >= 0) steps[existing] = stepState;
                else steps.push(stepState);
                return {
                  ...p,
                  runId: sseSpineRunId(d) || p.runId || '',
                  stepsCompleted: Number(d.steps_completed ?? p.stepsCompleted),
                  stepsTotal: Number(d.steps_total ?? p.stepsTotal),
                  currentNodeKey: nodeKey,
                  steps,
                  status: 'running',
                };
              });
            } else if (t === 'workflow_complete') {
              setRunState((p) => ({
                ...p,
                runId: sseSpineRunId(d) || p.runId || '',
                status: 'completed',
              }));
              break sseLoop;
            } else if (t === 'workflow_approval_required') {
              setRunState((p) => ({
                ...p,
                runId: sseSpineRunId(d) || p.runId || '',
                approvalId: String(d.approval_id ?? ''),
                status: 'awaiting_approval',
              }));
            } else if (t === 'workflow_error') {
              setRunState((p) => ({
                ...p,
                runId: sseSpineRunId(d) || p.runId || '',
                status: 'error',
                errorMessage: String(d.message ?? 'workflow error'),
              }));
              break sseLoop;
            }
          }
        }
      }
    },
    [opts],
  );

  const startWorkflow = useCallback(async (workflow: WorkflowRow, input: Record<string, unknown> = {}) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setRunState({
      ...INITIAL_RUN_STATE,
      workflowKey: workflow.workflow_key,
      status: 'running',
    });

    try {
      const res = await fetch(`/api/agentsam/workflows/${encodeURIComponent(workflow.id)}/run`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
        signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = (await res.json().catch(() => ({}))) as {
          mode?: string;
          run_id?: string;
          steps_total?: number;
          error?: string;
        };
        if (!res.ok) {
          setRunState((p) => ({
            ...p,
            status: 'error',
            errorMessage: json.error ?? `HTTP ${res.status}`,
          }));
          return;
        }
        if (json.mode === 'durable' && json.run_id) {
          setRunState((p) => ({
            ...p,
            runId: json.run_id,
            executionEngine: 'durable',
            stepsTotal: Number(json.steps_total ?? p.stepsTotal),
            status: 'running',
          }));
          await pollDurableRun(json.run_id, signal);
          return;
        }
      }

      await consumeWorkflowSse(res, signal);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setRunState((p) => ({
        ...p,
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [consumeWorkflowSse, pollDurableRun]);

  const handleApproval = useCallback(async (decision: 'approved' | 'denied') => {
    const { runId, approvalId } = runState;
    if (!runId) return;
    setApprovalBusy(true);
    try {
      const res = await fetch(`/api/agentsam/workflow-runs/${encodeURIComponent(runId)}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, approval_id: approvalId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunState((p) => ({
          ...p,
          status: 'error',
          errorMessage: (json as { error?: string }).error ?? `Approve failed (${res.status})`,
        }));
        return;
      }
      if (decision === 'denied') {
        setRunState((p) => ({ ...p, status: 'failed', errorMessage: 'Approval denied by user.' }));
        return;
      }

      setRunState((p) => ({ ...p, status: 'running', approvalId: null }));
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      if (runState.executionEngine === 'durable') {
        await pollDurableRun(runId, signal);
        return;
      }

      const resumeRes = await fetch(`/api/agentsam/workflow-runs/${encodeURIComponent(runId)}/resume`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal,
      });
      await consumeWorkflowSse(resumeRes, signal);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setRunState((p) => ({ ...p, status: 'error', errorMessage: e instanceof Error ? e.message : String(e) }));
    } finally {
      setApprovalBusy(false);
    }
  }, [runState, consumeWorkflowSse, pollDurableRun]);

  return { runState, approvalBusy, startWorkflow, resetRun, handleApproval };
}
