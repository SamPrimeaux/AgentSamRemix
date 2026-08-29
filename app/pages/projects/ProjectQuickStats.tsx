import React, { useMemo } from 'react';
import { Calendar, CheckSquare, Clock, ExternalLink } from 'lucide-react';
import {
  calendarBreakdownGradient,
  progressDonutGradient,
  taskMinutesGradient,
} from '../../src/lib/chartDonut';
import type { AgentTodo, TasksInsightsPayload } from '../launch-desk/ops-desk-types';
import { fmtMinutes } from '../launch-desk/ops-desk-types';

export type ProjectStatsMetric = 'time' | 'cost' | 'progress';
export type ProjectStatsPeriod = 'week' | 'month';

type Props = {
  todos: AgentTodo[];
  todosLoading: boolean;
  tasksInsights: TasksInsightsPayload | null;
  timerRunning: boolean;
  timerBusy: boolean;
  timerMinutesToday: number;
  onToggleTimer: () => void;
  onOpenTasks: () => void;
  onOpenCalendar: () => void;
  metric: ProjectStatsMetric;
  onMetricChange: (m: ProjectStatsMetric) => void;
  period: ProjectStatsPeriod;
  onPeriodChange: (p: ProjectStatsPeriod) => void;
  compact?: boolean;
};

export function ProjectQuickStats({
  todos,
  todosLoading,
  tasksInsights,
  timerRunning,
  timerBusy,
  timerMinutesToday,
  onToggleTimer,
  onOpenTasks,
  onOpenCalendar,
  metric,
  onMetricChange,
  period,
  onPeriodChange,
  compact = false,
}: Props) {
  const openTodos = useMemo(
    () =>
      todos.filter((t) => {
        const s = String(t.status || '').toLowerCase();
        return s !== 'done' && s !== 'completed' && s !== 'cancelled';
      }),
    [todos],
  );
  const doneCount = Math.max(0, todos.length - openTodos.length);
  const totalCount = todos.length || openTodos.length;
  const pctComplete = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  const byTask = tasksInsights?.by_task || [];
  const breakdown = useMemo(() => {
    if (metric === 'progress') {
      return {
        gradient: progressDonutGradient(openTodos.length, doneCount),
        rows: [
          { label: 'Open', value: String(openTodos.length), dot: 'open' as const },
          { label: 'Done', value: String(doneCount), dot: 'done' as const },
          { label: 'Complete', value: `${pctComplete}%`, dot: 'pct' as const },
        ],
      };
    }
    if (metric === 'cost') {
      const hours = (timerMinutesToday / 60).toFixed(1);
      return {
        gradient: progressDonutGradient(1, 0),
        rows: [
          { label: 'Today (time)', value: fmtMinutes(timerMinutesToday), dot: 'open' as const },
          { label: 'Est. hours', value: `${hours}h`, dot: 'done' as const },
          { label: 'Invoiced', value: '—', dot: 'pct' as const },
        ],
      };
    }
    const taskRows = byTask.map((r) => ({ title: r.title, minutes: r.minutes }));
    return {
      gradient: taskRows.length
        ? taskMinutesGradient(taskRows)
        : calendarBreakdownGradient({ task: timerMinutesToday, focus: 0 }),
      rows: [
        { label: 'Tracked today', value: fmtMinutes(timerMinutesToday), dot: 'open' as const },
        { label: 'Open tasks', value: String(openTodos.length), dot: 'done' as const },
        { label: period === 'week' ? 'This week' : 'This month', value: fmtMinutes(tasksInsights?.today_minutes || 0), dot: 'pct' as const },
      ],
    };
  }, [metric, openTodos.length, doneCount, pctComplete, timerMinutesToday, byTask, period, tasksInsights?.today_minutes]);

  return (
    <div className={`cpd-insights${compact ? ' cpd-insights--compact' : ''}`}>
      <div className="cpd-insights-head">
        <div>
          <div className="cpd-insights-kicker">{period === 'week' ? 'This week' : 'This month'}</div>
          <div className="cpd-insights-title">Project insights</div>
        </div>
        {timerRunning ? <span className="cpd-insights-live">Live</span> : null}
      </div>

      <div className="cpd-insights-switch">
        <button type="button" className={period === 'week' ? 'active' : ''} onClick={() => onPeriodChange('week')}>
          Week
        </button>
        <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => onPeriodChange('month')}>
          Month
        </button>
      </div>

      <div className="cpd-insights-metric-switch">
        {(['time', 'cost', 'progress'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={metric === m ? 'active' : ''}
            onClick={() => onMetricChange(m)}
          >
            {m === 'time' ? 'Time' : m === 'cost' ? 'Cost' : 'Progress'}
          </button>
        ))}
      </div>

      <div className="cpd-insights-timer-row">
        <button
          type="button"
          className={`cpd-timer-btn${timerRunning ? ' cpd-timer-btn--stop' : ' cpd-timer-btn--start'}`}
          disabled={timerBusy}
          onClick={onToggleTimer}
        >
          <Clock size={14} strokeWidth={1.75} aria-hidden />
          {timerBusy ? '…' : timerRunning ? 'Stop' : 'Start'}
        </button>
        <span className="cpd-insights-today">
          Today <strong>{fmtMinutes(timerMinutesToday)}</strong>
        </span>
      </div>

      <div className="cpd-insights-donut" style={{ background: breakdown.gradient }} aria-hidden />

      <div className="cpd-insights-breakdown">
        {breakdown.rows.map((row) => (
          <div key={row.label} className="cpd-insights-break-row">
            <span className={`cpd-insights-dot cpd-insights-dot--${row.dot}`} />
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>

      <div className="cpd-insights-rule" />

      <div className="cpd-insights-subhead">
        <h3>Open tasks</h3>
        <span>{todosLoading ? '…' : openTodos.length}</span>
      </div>
      {todosLoading ? (
        <p className="cpd-insights-empty">Loading tasks…</p>
      ) : openTodos.length === 0 ? (
        <p className="cpd-insights-empty">No open tasks for this project.</p>
      ) : (
        <ul className="cpd-insights-task-list">
          {openTodos.slice(0, compact ? 4 : 8).map((t) => (
            <li key={t.id}>
              <button type="button" className="cpd-insights-task-btn" onClick={onOpenTasks}>
                <span className="cpd-insights-task-title">{t.title}</span>
                {t.category ? <span className="cpd-insights-task-cat">{t.category}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="cpd-insights-links">
        <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onOpenTasks}>
          <CheckSquare size={13} aria-hidden />
          Tasks
        </button>
        <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onOpenCalendar}>
          <Calendar size={13} aria-hidden />
          Calendar
        </button>
        <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onOpenTasks}>
          <ExternalLink size={13} aria-hidden />
          Collaborate
        </button>
      </div>
    </div>
  );
}
