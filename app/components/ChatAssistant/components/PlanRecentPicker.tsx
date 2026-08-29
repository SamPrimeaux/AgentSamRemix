/**
 * Recent plans library — reopen plan markdown in Monaco or resume execution.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Play, Clock } from 'lucide-react';

export type RecentPlanRow = {
  id: string;
  title: string;
  status: string;
  tasks_total?: number;
  tasks_done?: number;
  updated_at?: number;
};

export type PlanRecentPickerProps = {
  workspaceId: string | null;
  activePlanId?: string | null;
  onOpenPlan?: (planId: string) => void;
  onRunPlan?: (planId: string) => void;
  runPlanBusy?: boolean;
  isNarrow?: boolean;
};

export const PlanRecentPicker: React.FC<PlanRecentPickerProps> = ({
  workspaceId,
  activePlanId,
  onOpenPlan,
  onRunPlan,
  runPlanBusy = false,
  isNarrow = false,
}) => {
  const [plans, setPlans] = useState<RecentPlanRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const ws = workspaceId?.trim();
    if (!ws) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ workspace_id: ws, limit: '8' });
      const res = await fetch(`/api/agentsam/plans?${q}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.plans)) {
        setPlans(
          data.plans.map((p: Record<string, unknown>) => ({
            id: String(p.id || ''),
            title: String(p.title || 'Plan'),
            status: String(p.status || 'active'),
            tasks_total: Number(p.tasks_total) || 0,
            tasks_done: Number(p.tasks_done) || 0,
            updated_at: Number(p.updated_at) || 0,
          })),
        );
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspaceId?.trim() || (!loading && plans.length === 0)) return null;

  return (
    <div
      className={`rounded-xl border border-[var(--dashboard-border)]/80 bg-[var(--scene-bg)]/60 ${
        isNarrow ? 'px-2.5 py-2' : 'px-3 py-2.5'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] mb-1.5">
        <Clock size={12} className="shrink-0" />
        Recent plans
      </div>
      <div className={`flex gap-2 ${isNarrow ? 'flex-col' : 'flex-wrap'}`}>
        {(loading ? [] : plans).slice(0, 6).map((p) => {
          const active = activePlanId === p.id;
          return (
            <div
              key={p.id}
              className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                active
                  ? 'border-[var(--solar-cyan)]/40 bg-[var(--solar-cyan)]/8'
                  : 'border-[var(--dashboard-border)]/70 bg-transparent'
              } ${isNarrow ? 'w-full' : 'max-w-[220px]'}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--dashboard-text)]">
                {p.title}
              </span>
              <button
                type="button"
                title="View plan"
                onClick={() => onOpenPlan?.(p.id)}
                className="shrink-0 p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)]"
              >
                <FileText size={14} />
              </button>
              <button
                type="button"
                title="Build"
                disabled={runPlanBusy}
                onClick={() => onRunPlan?.(p.id)}
                className="shrink-0 p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--solar-cyan)] disabled:opacity-40"
              >
                <Play size={14} />
              </button>
            </div>
          );
        })}
        {loading ? (
          <span className="text-[11px] text-[var(--dashboard-muted)]">Loading…</span>
        ) : null}
      </div>
    </div>
  );
};
