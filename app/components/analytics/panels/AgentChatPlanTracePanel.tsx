import React, { useEffect, useState } from 'react';

type TracePayload = {
  workflow_run?: Record<string, unknown>;
  plan?: Record<string, unknown> | null;
  tasks?: Record<string, unknown>[];
  steps?: Record<string, unknown>[];
  approvals?: Record<string, unknown>[];
  command_runs?: Record<string, unknown>[];
  checks?: Record<string, unknown>;
  error?: string;
};

/**
 * Small D1 readout for the latest (or pinned) agent_chat_plan workflow run — plan, tasks, steps, approvals.
 */
export function AgentChatPlanTracePanel() {
  const [data, setData] = useState<TracePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agentsam/agent-chat-plan-trace', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text();
          throw new Error(t || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((j) => {
        if (!cancelled) {
          setData(j);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e?.message ?? String(e));
          setData(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 p-3 text-sm text-rose-100">
        <div className="font-medium">Trace unavailable</div>
        <div className="mt-1 text-rose-200/80">{err}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
        Loading D1 workflow trace…
      </div>
    );
  }

  const wr = data.workflow_run as { id?: string; status?: string; workflow_key?: string } | undefined;
  const ch = data.checks || {};

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[13px] text-slate-200">
      <div className="font-semibold text-slate-100">D1 · agent_chat_plan trace</div>
      <div className="mt-2 space-y-1 font-mono text-[12px] text-slate-400">
        <div>
          <span className="text-slate-500">run</span> {wr?.id ?? '—'}{' '}
          <span className="text-slate-600">·</span> {wr?.status ?? '—'}{' '}
          <span className="text-slate-600">·</span> {wr?.workflow_key ?? '—'}
        </div>
        <div>
          <span className="text-slate-500">plan.workflow_run_id</span>{' '}
          {data.plan && (data.plan as { workflow_run_id?: string }).workflow_run_id ? 'yes' : 'no'}
        </div>
        <div>
          <span className="text-slate-500">tasks</span> {(data.tasks || []).length}{' '}
          <span className="text-slate-600">·</span> <span className="text-slate-500">with step</span>{' '}
          {String(ch.tasks_with_steps ?? '—')} <span className="text-slate-600">·</span>{' '}
          <span className="text-slate-500">with wrun</span> {String(ch.tasks_with_wrun ?? '—')}
        </div>
        <div>
          <span className="text-slate-500">execution_steps</span> {(data.steps || []).length}{' '}
          <span className="text-slate-600">·</span> <span className="text-slate-500">approvals</span>{' '}
          {(data.approvals || []).length}{' '}
          <span className="text-slate-600">·</span> <span className="text-slate-500">command_runs</span>{' '}
          {(data.command_runs || []).length}
        </div>
        <div className="text-slate-500">
          step/run link OK: {String(ch.tasks_execution_step_matches_run ?? '—')} / {String(ch.tasks_total ?? '—')}
        </div>
      </div>
    </div>
  );
}
