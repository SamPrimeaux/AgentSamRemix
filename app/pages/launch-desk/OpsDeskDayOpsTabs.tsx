import React, { useMemo, useRef } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import { askAgentSam } from './askAgentSam';
import {
  ActivePlan,
  KanbanTask,
  OpsDeskDayBundle,
  PlanTask,
  TodoItem,
  priorityClass,
  todoPriorityClass,
  truncatePlanRef,
} from './ops-desk-types';

type OpsTab = 'sprint' | 'plans' | 'todos';

interface OpsDeskDayOpsTabsProps {
  tab: OpsTab;
  bundle: OpsDeskDayBundle | null;
  filterPlanId: string | null;
  onCompletePlanTask: (id: string) => void;
  onCompleteTodo: (id: string) => void;
  onFocusPlan: (planId: string) => void;
  onClearPlanFilter: () => void;
}

export function OpsDeskDayOpsTabs({
  tab,
  bundle,
  filterPlanId,
  onCompletePlanTask,
  onCompleteTodo,
  onFocusPlan,
  onClearPlanFilter,
}: OpsDeskDayOpsTabsProps) {
  const planRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const groupedSprint = useMemo(() => {
    const groups: Record<string, PlanTask[]> = { P0: [], P1: [], P2: [], other: [] };
    for (const t of bundle?.plan_tasks ?? []) {
      const p = String(t.priority || 'P2').toUpperCase();
      if (p === 'P0') groups.P0.push(t);
      else if (p === 'P1') groups.P1.push(t);
      else if (p === 'P2') groups.P2.push(t);
      else groups.other.push(t);
    }
    return groups;
  }, [bundle?.plan_tasks]);

  const activePlans = useMemo(() => {
    const plans = bundle?.active_plans ?? [];
    if (!filterPlanId) return plans;
    return plans.filter((p) => p.id === filterPlanId);
  }, [bundle?.active_plans, filterPlanId]);

  if (tab === 'sprint') {
    const kanban = bundle?.kanban_due ?? [];
    const hasAny = Object.values(groupedSprint).some((g) => g.length > 0) || kanban.length > 0;
    if (!hasAny) {
      return <div className="ops-desk-day-empty">No open sprint tasks.</div>;
    }
    return (
      <div className="ops-desk-ops-scroll">
        {(['P0', 'P1', 'P2', 'other'] as const).map((group) => {
          const items = groupedSprint[group];
          if (!items.length) return null;
          return (
            <section key={group} className="ops-desk-ops-section">
              <h3>{group === 'other' ? 'Other' : group}</h3>
              <div className="ops-desk-day-cards">
                {items.map((task) => (
                  <SprintTaskCard key={task.id} task={task} onComplete={() => onCompletePlanTask(task.id)} />
                ))}
              </div>
            </section>
          );
        })}
        {kanban.length > 0 ? (
          <section className="ops-desk-ops-section">
            <h3>Kanban due today</h3>
            <div className="ops-desk-day-cards">
              {kanban.map((kt) => (
                <KanbanCard key={kt.id} task={kt} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  if (tab === 'todos') {
    const todos = bundle?.todos ?? [];
    if (!todos.length) {
      return <div className="ops-desk-day-empty">No open deliverables in agentsam_todo.</div>;
    }
    return (
      <div className="ops-desk-ops-scroll">
        <div className="ops-desk-day-cards">
          {todos.map((todo) => (
            <TodoCard key={todo.id} todo={todo} onComplete={() => onCompleteTodo(todo.id)} />
          ))}
        </div>
      </div>
    );
  }

  if (!activePlans.length) {
    return <div className="ops-desk-day-empty">No active plans.</div>;
  }

  return (
    <div className="ops-desk-ops-scroll">
      {filterPlanId ? (
        <button type="button" className="ops-desk-clear-filter" onClick={onClearPlanFilter}>
          Show all active plans
        </button>
      ) : null}
      {activePlans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          ref={(el) => {
            planRefs.current[plan.id] = el;
          }}
          onCompleteTask={onCompletePlanTask}
        />
      ))}
    </div>
  );
}

function SprintTaskCard({ task, onComplete }: { task: PlanTask; onComplete: () => void }) {
  return (
    <article className="ops-desk-day-card ops-desk-ops-card">
      <div className="ops-desk-task-card-top">
        <span className={`ops-desk-priority ops-desk-priority-${priorityClass(task.priority)}`}>
          {task.priority || 'P2'}
        </span>
        {task.category ? <span className="ops-desk-category-chip">{task.category}</span> : null}
      </div>
      <h4>{task.title}</h4>
      <p className="ops-desk-task-plan-ref">{truncatePlanRef(task.plan_title, task.plan_id)}</p>
      {task.blocked_reason ? <p className="ops-desk-blocked-note">Blocked: {task.blocked_reason}</p> : null}
      <div className="ops-desk-task-card-actions">
        <button type="button" className="ops-desk-btn ops-desk-btn-primary" onClick={onComplete}>
          Complete
        </button>
        <button
          type="button"
          className="ops-desk-btn"
          onClick={() =>
            askAgentSam(
              `What's blocking ${task.title}? Plan ID: ${task.plan_id}. Blocked reason: ${task.blocked_reason || 'none'}. Give me the fastest unblock.`,
            )
          }
        >
          <Sparkles size={12} />
          Ask Sam
        </button>
      </div>
    </article>
  );
}

function TodoCard({ todo, onComplete }: { todo: TodoItem; onComplete: () => void }) {
  return (
    <article className="ops-desk-day-card ops-desk-ops-card">
      <div className="ops-desk-task-card-top">
        <span className={`ops-desk-priority ops-desk-priority-${todoPriorityClass(todo.priority)}`}>
          {todo.priority || 'medium'}
        </span>
        {todo.execution_status ? (
          <span className="ops-desk-category-chip">{todo.execution_status}</span>
        ) : null}
        {todo.linked_route ? (
          <span className="ops-desk-category-chip">{todo.linked_route}</span>
        ) : null}
      </div>
      <h4>{todo.title}</h4>
      {todo.plan_id ? (
        <p className="ops-desk-task-plan-ref">{truncatePlanRef(todo.plan_title, todo.plan_id)}</p>
      ) : null}
      {todo.error_trace ? <p className="ops-desk-blocked-note">{todo.error_trace}</p> : null}
      <div className="ops-desk-task-card-actions">
        <button type="button" className="ops-desk-btn ops-desk-btn-primary" onClick={onComplete}>
          Complete
        </button>
        <button
          type="button"
          className="ops-desk-btn"
          onClick={() =>
            askAgentSam(
              `Deliverable todo: ${todo.title} (${todo.id}). Status: ${todo.execution_status}. Plan: ${todo.plan_id || 'none'}. What's the fastest path to done?`,
            )
          }
        >
          <Sparkles size={12} />
          Ask Sam
        </button>
      </div>
    </article>
  );
}

function KanbanCard({ task }: { task: KanbanTask }) {
  return (
    <article className="ops-desk-day-card ops-desk-ops-card">
      <div className="ops-desk-task-card-top">
        <span className="ops-desk-category-chip">kanban</span>
        {task.client_name ? <span className="ops-desk-category-chip">{task.client_name}</span> : null}
      </div>
      <h4>{task.title}</h4>
    </article>
  );
}

const PlanCard = React.forwardRef<
  HTMLDivElement,
  { plan: ActivePlan; onCompleteTask: (id: string) => void }
>(function PlanCard({ plan, onCompleteTask }, ref) {
  const total = plan.tasks_total ?? 0;
  const done = plan.tasks_done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <article ref={ref} className="ops-desk-day-card ops-desk-plan-card ops-desk-ops-card">
      <div className="ops-desk-plan-card-head">
        <span className="ops-desk-plan-type">[{plan.plan_type || 'plan'}]</span>
        <h3>{plan.title}</h3>
      </div>
      <p className="ops-desk-plan-date">plan_date: {plan.plan_date || '—'}</p>
      <div className="ops-desk-plan-progress-wrap">
        <div className="ops-desk-plan-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="ops-desk-plan-progress-label">
        {done}/{total} tasks done · {plan.open_count} open
      </p>
      {plan.morning_brief ? <p className="ops-desk-plan-brief">{plan.morning_brief}</p> : null}
      {plan.open_tasks.length > 0 ? (
        <div className="ops-desk-plan-open-tasks">
          <h4>Open tasks</h4>
          <ul>
            {plan.open_tasks.map((t) => (
              <li key={t.id}>
                <span className={`ops-desk-priority ops-desk-priority-${priorityClass(t.priority)}`}>
                  {t.priority || 'P2'}
                </span>
                <span>{t.title}</span>
                <button type="button" className="ops-desk-inline-complete" onClick={() => onCompleteTask(t.id)}>
                  Done
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="ops-desk-plan-actions">
        <button
          type="button"
          className="ops-desk-btn"
          onClick={() => {
            const openLines = plan.open_tasks.map((t) => `${t.priority || 'P2'}  ${t.title}`).join('\n');
            askAgentSam(
              `Generate a release plan for:\n\nPlan: ${plan.title}\nProgress: ${done}/${total}\n\nMorning brief:\n${plan.morning_brief || '(none)'}\n\nOpen tasks:\n${openLines || '(none)'}`,
            );
          }}
        >
          Generate release plan
          <ExternalLink size={12} />
        </button>
        <button
          type="button"
          className="ops-desk-btn ops-desk-btn-primary"
          onClick={() => {
            const openP1 = plan.open_tasks
              .filter((t) => String(t.priority).toUpperCase() === 'P1')
              .map((t) => t.title);
            askAgentSam(
              `Active plan: ${plan.title}. ${done}/${total} tasks complete. Open P1s: ${openP1.join('; ') || 'none'}. What's the critical path to done and what should I work on right now?`,
            );
          }}
        >
          <Sparkles size={12} />
          Ask Sam
        </button>
      </div>
    </article>
  );
});
