/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Play, X } from 'lucide-react';
import type { ExecutionPlanState, ExecutionPlanTask, ExecutionPlanTaskStatus } from '../types';
import type { AgentMode } from '../types';
import { ChatPresenceIcon } from '../../../features/mode-presence/ChatPresenceIcon';
import { usePlanTasksRealtime, type PlanTask } from '../../../src/hooks/usePlanTasksRealtime';

function mapD1TaskStatus(status: PlanTask['status']): ExecutionPlanTaskStatus {
  if (status === 'in_progress') return 'running';
  if (status === 'carried') return 'skipped';
  if (status === 'done' || status === 'blocked' || status === 'skipped' || status === 'todo') {
    return status;
  }
  return 'todo';
}

function mergePlanTasks(sse: ExecutionPlanTask[], d1: PlanTask[]): ExecutionPlanTask[] {
  if (!d1.length) return sse;
  const d1ById = new Map(d1.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const merged: ExecutionPlanTask[] = sse.map((t) => {
    seen.add(t.id);
    const row = d1ById.get(t.id);
    if (!row) return t;
    return {
      ...t,
      title: row.title || t.title,
      order_index: row.order_index ?? t.order_index,
      status: mapD1TaskStatus(row.status),
      detail: row.notes || row.blocked_reason || t.detail,
    };
  });
  for (const row of d1) {
    if (seen.has(row.id)) continue;
    merged.push({
      id: row.id,
      title: row.title,
      order_index: row.order_index,
      status: mapD1TaskStatus(row.status),
      detail: row.notes || row.blocked_reason || undefined,
    });
  }
  return merged.sort((a, b) => a.order_index - b.order_index);
}

function statusIcon(status: ExecutionPlanTaskStatus, mode: AgentMode = 'plan') {
  if (status === 'done') {
    return <Check size={14} className="text-[var(--solar-green)] shrink-0" aria-hidden />;
  }
  if (status === 'failed') {
    return <X size={14} className="text-red-400 shrink-0" aria-hidden />;
  }
  if (status === 'blocked') {
    return <AlertTriangle size={14} className="text-amber-400 shrink-0" aria-hidden />;
  }
  if (status === 'skipped') {
    return <span className="text-[11px] text-[var(--dashboard-muted)] shrink-0">—</span>;
  }
  if (status === 'running') {
    return (
      <ChatPresenceIcon mode={mode} state="task_stack" size={14} className="shrink-0" />
    );
  }
  return (
    <span
      className="w-3.5 h-3.5 rounded border border-[var(--dashboard-border)] shrink-0 inline-block"
      aria-hidden
    />
  );
}

export type AgentPlanChecklistProps = {
  plan: ExecutionPlanState;
  mode?: AgentMode;
  onRunPlan?: (planId: string) => void;
  runPlanBusy?: boolean;
  onSavePlanWorkspace?: (planId: string) => void;
  savePlanBusy?: boolean;
};

type TaskNode = ExecutionPlanState['tasks'][number] & { children: TaskNode[] };

function buildTaskTree(tasks: ExecutionPlanState['tasks']): TaskNode[] {
  const byId = new Map<string, TaskNode>();
  for (const t of tasks) {
    byId.set(t.id, { ...t, children: [] });
  }
  const roots: TaskNode[] = [];
  for (const t of tasks) {
    const node = byId.get(t.id)!;
    const parentId = t.parent_task_id?.trim();
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: TaskNode[]) => {
    nodes.sort((a, b) => a.order_index - b.order_index);
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function countProgress(tasks: ExecutionPlanState['tasks']) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  return { total, done, failed, running, pct: total ? Math.round((done / total) * 100) : 0 };
}

function TaskRow({
  task,
  mode,
  depth,
}: {
  task: TaskNode;
  mode: AgentMode;
  depth: number;
}) {
  return (
    <>
      <li
        className="flex items-start gap-2 px-1.5 py-1.5 rounded-lg text-[12px] text-[var(--dashboard-text)]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <span className="mt-0.5">{statusIcon(task.status, mode)}</span>
        <span className="min-w-0 flex-1 leading-snug break-words [overflow-wrap:anywhere]">
          {task.title}
          {task.status === 'running' && (
            <span
              className="block text-[10px] mt-0.5 text-[var(--solar-cyan)]"
              style={{ animation: 'agent-sam-plan-shimmer 2.8s ease-in-out infinite' }}
            >
              {task.detail ? String(task.detail).slice(0, 100) : 'Working…'}
            </span>
          )}
          {task.status === 'blocked' && task.detail ? (
            <span className="block text-[10px] mt-0.5 text-amber-400/90">{String(task.detail).slice(0, 120)}</span>
          ) : null}
        </span>
      </li>
      {task.children.map((child) => (
        <TaskRow key={child.id} task={child} mode={mode} depth={depth + 1} />
      ))}
    </>
  );
}

export const AgentPlanChecklist: React.FC<AgentPlanChecklistProps> = ({
  plan,
  mode = 'plan',
  onRunPlan,
  runPlanBusy = false,
  onSavePlanWorkspace,
  savePlanBusy = false,
}) => {
  const planId = plan.plan_id?.trim() || null;
  const { tasks: d1Tasks } = usePlanTasksRealtime(planId);
  const mergedPlan = useMemo(() => {
    const tasks = mergePlanTasks(plan.tasks, d1Tasks);
    const running = tasks.filter((t) => t.status === 'running').length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked').length;
    let status = plan.status;
    if (plan.status === 'running' || running > 0) status = 'running';
    else if (done === tasks.length && tasks.length > 0) status = 'complete';
    else if (failed > 0 && done + failed >= tasks.length) status = 'partial';
    return { ...plan, tasks, status, tasks_completed: done, tasks_failed: failed };
  }, [plan, d1Tasks]);

  const [expanded, setExpanded] = useState(false);
  const tree = useMemo(() => buildTaskTree(mergedPlan.tasks), [mergedPlan.tasks]);
  const flatSorted = [...mergedPlan.tasks].sort((a, b) => a.order_index - b.order_index);
  const progress = countProgress(mergedPlan.tasks);
  const hasTrace = flatSorted.some(
    (t) =>
      t.detail ||
      t.trace?.execution_step_id ||
      t.trace?.command_run_id ||
      t.trace?.workflow_run_id,
  );

  const headerStatus =
    mergedPlan.status === 'complete'
      ? 'Complete'
      : mergedPlan.status === 'partial'
        ? 'Partial'
        : mergedPlan.status === 'failed'
          ? 'Failed'
          : mergedPlan.status === 'running'
            ? `Running · ${progress.done}/${progress.total}`
            : mergedPlan.status === 'ready'
              ? 'Ready to build'
              : 'Planning';

  const headerPresenceState =
    mergedPlan.status === 'complete'
      ? 'handoff_ready'
      : mergedPlan.status === 'running'
        ? 'task_stack'
        : mergedPlan.status === 'failed'
          ? 'failed'
          : mergedPlan.status === 'ready'
            ? 'handoff_ready'
            : 'mapping';

  const showRunCta =
    Boolean(onRunPlan && mergedPlan.plan_id) &&
    (mergedPlan.status === 'ready' || mergedPlan.status === 'planning') &&
    progress.done < progress.total &&
    progress.running === 0;

  return (
    <div className="mt-2 rounded-xl border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/80 overflow-hidden max-w-full">
      <div className="px-3 py-2.5 border-b border-[var(--dashboard-border)]/60 flex items-start gap-2.5">
        <ChatPresenceIcon mode={mode} state={headerPresenceState} size={18} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--dashboard-text)] leading-snug">
            {mergedPlan.plan_title || 'Plan'}
          </p>
          <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">
            {headerStatus}
            {progress.failed > 0 ? ` · ${progress.failed} blocked/failed` : ''}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--dashboard-border)]/40 overflow-hidden" aria-hidden>
            <div
              className="h-full rounded-full bg-[var(--solar-cyan)] transition-all duration-500 ease-out"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      </div>
      {showRunCta ? (
        <div className="px-3 py-2 border-b border-[var(--dashboard-border)]/50 flex flex-wrap gap-2 items-center">
          {onSavePlanWorkspace ? (
            <button
              type="button"
              disabled={savePlanBusy || runPlanBusy}
              onClick={() => onSavePlanWorkspace(mergedPlan.plan_id)}
              className="inline-flex items-center gap-1.5 min-h-[2rem] px-3 rounded-lg text-[12px] font-medium border border-[var(--dashboard-border)] text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/35 disabled:opacity-45"
            >
              {savePlanBusy ? 'Saving…' : 'Save to workspace'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={runPlanBusy}
            onClick={() => onRunPlan?.(mergedPlan.plan_id)}
            className="inline-flex items-center gap-1.5 min-h-[2rem] px-3 rounded-lg text-[12px] font-semibold text-[var(--solar-base03)] bg-[var(--solar-cyan)] hover:brightness-110 disabled:opacity-45"
          >
            <Play size={13} className="fill-current" aria-hidden />
            {runPlanBusy ? 'Building…' : 'Build'}
          </button>
          <span className="text-[10px] text-[var(--dashboard-muted)] self-center">
            Save persists to ARTIFACTS · Build runs the task list
          </span>
        </div>
      ) : null}
      <ul className="px-2 py-2 space-y-0.5" aria-label="Plan tasks">
        {tree.map((task) => (
          <TaskRow key={task.id} task={task} mode={mode} depth={0} />
        ))}
      </ul>
      {mergedPlan.status === 'running' && flatSorted.every((t) => t.status !== 'running') && (
        <div className="px-4 pb-2 flex items-center gap-2 text-[11px] text-[var(--dashboard-muted)]">
          <ChatPresenceIcon mode={mode} state="mapping" size={12} />
          Planning next moves…
        </div>
      )}
      {hasTrace ? (
        <div className="border-t border-[var(--dashboard-border)]/60">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Hide trace' : 'Show trace'}
          </button>
          {expanded ? (
            <div className="px-3 pb-3 space-y-2">
              {flatSorted
                .filter((t) => t.detail && t.status !== 'todo')
                .map((task) => (
                  <div key={`trace-${task.id}`} className="text-[11px] text-[var(--dashboard-muted)] leading-relaxed">
                    <span className="font-medium text-[var(--dashboard-text)]">{task.title}</span>
                    {' — '}
                    {String(task.detail).slice(0, 300)}
                  </div>
                ))}
              {flatSorted.filter((t) => t.detail && t.status !== 'todo').length === 0 && (
                <p className="text-[11px] text-[var(--dashboard-muted)]">No trace yet.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
