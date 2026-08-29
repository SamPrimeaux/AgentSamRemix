import React, { useMemo, useState } from 'react';
import type { PlatformTicket } from '../../client-api/tickets';
import {
  CalendarInsightsPayload,
  ProjectRow,
  TasksInsightsPayload,
  fmtMinutes,
  postManualTimeEntry,
} from './ops-desk-types';

type Props = {
  insights: CalendarInsightsPayload | null;
  tasksInsights: TasksInsightsPayload | null;
  insightsMode: 'week' | 'month';
  onInsightsModeChange: (mode: 'week' | 'month') => void;
  weekLabel: string;
  donutGradient: (breakdown: Record<string, number>) => string;
  remainingMins: number;
  trackingActive?: boolean;
  projects?: ProjectRow[];
  tickets?: PlatformTicket[];
  selectedTaskId?: string | null;
  onTimeLogged?: () => void | Promise<void>;
  onClose?: () => void;
};

export function CollaborateTasksInsights({
  insights,
  tasksInsights,
  insightsMode,
  onInsightsModeChange,
  weekLabel,
  donutGradient,
  remainingMins,
  trackingActive = false,
  projects = [],
  tickets = [],
  selectedTaskId = null,
  onTimeLogged,
  onClose,
}: Props) {
  const breakdown = insights?.insights.breakdown_minutes || {};
  const trackedToday = tasksInsights?.today_minutes || 0;
  const agentInferred = tasksInsights?.agent_inferred_minutes || 0;
  const scheduledToday = tasksInsights?.scheduled_today_minutes || 0;
  const displayToday =
    trackedToday > 0
      ? trackedToday
      : tasksInsights?.combined_today_minutes || agentInferred || scheduledToday;
  const usageRollup = tasksInsights?.usage_rollup;
  const byProject = tasksInsights?.by_project || [];
  const byTask = tasksInsights?.by_task || [];

  const [manualOpen, setManualOpen] = useState(false);
  const [manualProjectId, setManualProjectId] = useState('');
  const [manualTodoId, setManualTodoId] = useState('');
  const [manualMinutes, setManualMinutes] = useState('30');
  const [manualNote, setManualNote] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualOk, setManualOk] = useState<string | null>(null);

  const openTickets = useMemo(
    () =>
      tickets.filter((ticket) => ticket.status !== 'shipped' && ticket.status !== 'abandoned'),
    [tickets],
  );

  const submitManualTime = async () => {
    const projectId = manualProjectId.trim();
    const minutes = Math.round(Number(manualMinutes));
    if (!projectId) {
      setManualError('Pick a project');
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
      setManualError('Enter 1–480 minutes');
      return;
    }
    setManualSaving(true);
    setManualError(null);
    setManualOk(null);
    try {
      await postManualTimeEntry({
        project_id: projectId,
        todo_id: manualTodoId.trim() || null,
        minutes,
        note: manualNote.trim() || null,
      });
      setManualOk(`Logged ${fmtMinutes(minutes)}`);
      setManualMinutes('30');
      setManualNote('');
      await onTimeLogged?.();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Could not log time');
    } finally {
      setManualSaving(false);
    }
  };

  const openManualForm = () => {
    const defaultProject =
      projects.find((p) => p.id === manualProjectId)?.id ||
      projects[0]?.id ||
      '';
    const defaultTodo = selectedTaskId || openTickets[0]?.id || '';
    setManualProjectId(defaultProject);
    setManualTodoId(defaultTodo);
    setManualOpen(true);
    setManualError(null);
    setManualOk(null);
  };

  return (
    <aside className="colab-cal-right colab-tasks-insights">
      <div className="colab-cal-insights-head">
        <div>
          <div className="colab-cal-insights-date">{weekLabel}</div>
          <div className="colab-cal-insights-title">Time insights</div>
        </div>
        <div className="colab-cal-insights-head-actions">
          {trackingActive ? (
            <span className="colab-tasks-tracking-pill" title="Tracking active time while you work">
              Live
            </span>
          ) : null}
          {onClose ? (
            <button type="button" className="colab-cal-icon-btn colab-cal-insights-close" aria-label="Close insights" onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="colab-cal-switch">
        <button type="button" className={insightsMode === 'week' ? 'active' : ''} onClick={() => onInsightsModeChange('week')}>
          Week
        </button>
        <button type="button" className={insightsMode === 'month' ? 'active' : ''} onClick={() => onInsightsModeChange('month')}>
          Month
        </button>
      </div>

      <div className="colab-tasks-insights-today">
        <span>Today tracked</span>
        <strong>{fmtMinutes(displayToday)}</strong>
      </div>
      {(trackedToday === 0 && (agentInferred > 0 || scheduledToday > 0)) ? (
        <div className="colab-tasks-insights-lanes">
          {agentInferred > 0 ? (
            <div className="colab-tasks-insights-lane">
              <span>Agent sessions</span>
              <strong>{fmtMinutes(agentInferred)}</strong>
            </div>
          ) : null}
          {scheduledToday > 0 ? (
            <div className="colab-tasks-insights-lane">
              <span>Scheduled tasks</span>
              <strong>{fmtMinutes(scheduledToday)}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      {usageRollup?.cost_usd != null && Number(usageRollup.cost_usd) > 0 ? (
        <div className="colab-tasks-insights-usage">
          <span>AI spend today</span>
          <strong>${Number(usageRollup.cost_usd).toFixed(2)}</strong>
          {usageRollup.ai_calls ? (
            <span className="colab-tasks-insights-usage-meta">{usageRollup.ai_calls} calls</span>
          ) : null}
        </div>
      ) : null}

      <div className="colab-tasks-manual-time">
        {!manualOpen ? (
          <button type="button" className="colab-cal-outline-btn colab-tasks-manual-time-btn" onClick={openManualForm}>
            Log time manually
          </button>
        ) : (
          <div className="colab-tasks-manual-time-form">
            <div className="colab-tasks-manual-time-head">
              <strong>Manual time entry</strong>
              <button type="button" className="colab-cal-text-btn" onClick={() => setManualOpen(false)}>
                Close
              </button>
            </div>
            <label className="colab-tasks-manual-label">
              Project
              <select
                className="colab-tasks-project-select"
                value={manualProjectId}
                onChange={(e) => setManualProjectId(e.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="colab-tasks-manual-label">
              Task (optional)
              <select
                className="colab-tasks-project-select"
                value={manualTodoId}
                onChange={(e) => setManualTodoId(e.target.value)}
              >
                <option value="">No task</option>
                {openTickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="colab-tasks-manual-label">
              Minutes
              <input
                type="number"
                min={1}
                max={480}
                className="colab-tasks-inline-due"
                value={manualMinutes}
                onChange={(e) => setManualMinutes(e.target.value)}
              />
            </label>
            <label className="colab-tasks-manual-label">
              Note (optional)
              <input
                className="colab-tasks-inline-due"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="What did you work on?"
              />
            </label>
            {manualError ? <p className="colab-tasks-compose-error">{manualError}</p> : null}
            {manualOk ? <p className="colab-tasks-manual-ok">{manualOk}</p> : null}
            <button
              type="button"
              className="colab-cal-save-btn"
              disabled={manualSaving}
              onClick={() => void submitManualTime()}
            >
              {manualSaving ? 'Saving…' : 'Log time'}
            </button>
          </div>
        )}
      </div>

      <div className="colab-cal-donut" style={{ background: donutGradient(breakdown) }} />

      <div className="colab-cal-breakdown">
        <div className="colab-cal-break-row">
          <span className="colab-cal-dot focus" />
          <span>Focus time</span>
          <strong>{fmtMinutes(breakdown.focus || 0)}</strong>
        </div>
        <div className="colab-cal-break-row">
          <span className="colab-cal-dot tasks" />
          <span>Tasks</span>
          <strong>{fmtMinutes(breakdown.task || 0)}</strong>
        </div>
        <div className="colab-cal-break-row">
          <span className="colab-cal-dot one" />
          <span>1:1 meetings</span>
          <strong>{fmtMinutes(breakdown.one_on_one || 0)}</strong>
        </div>
        <div className="colab-cal-break-row">
          <span className="colab-cal-dot guests" />
          <span>Meetings with 3+ guests</span>
          <strong>{fmtMinutes(breakdown.multi_guest || 0)}</strong>
        </div>
        <div className="colab-cal-break-row">
          <span className="colab-cal-dot remaining" />
          <span>Remaining work time</span>
          <strong>{fmtMinutes(remainingMins)}</strong>
        </div>
      </div>

      <div className="colab-cal-rule" />

      <div className="colab-cal-subhead">
        <h3>By project</h3>
      </div>
      {byProject.length === 0 ? (
        <p className="colab-tasks-insights-empty">No project time logged today yet.</p>
      ) : (
        byProject.slice(0, 8).map((row) => (
          <div key={row.project_id} className="colab-cal-cal-row">
            <span>{row.name || row.project_id}</span>
            <span>{fmtMinutes(row.minutes)}</span>
          </div>
        ))
      )}

      <div className="colab-cal-rule" />

      <div className="colab-cal-subhead">
        <h3>By task</h3>
      </div>
      {byTask.length === 0 ? (
        <p className="colab-tasks-insights-empty">Select a task or schedule work to see task time.</p>
      ) : (
        byTask.slice(0, 6).map((row) => (
          <div key={row.todo_id || row.title} className="colab-cal-cal-row">
            <span>{row.title}</span>
            <span>{fmtMinutes(row.minutes)}</span>
          </div>
        ))
      )}
    </aside>
  );
}
