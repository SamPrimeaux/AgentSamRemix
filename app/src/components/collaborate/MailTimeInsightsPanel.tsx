/**
 * Mail insights rail — same GCP Time insights panel as /dashboard/collaborate tasks.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollaborateTasksInsights } from '../../../pages/launch-desk/CollaborateTasksInsights';
import {
  donutGradient,
  remainingWorkMinutes,
  weekLabelForAnchor,
} from '../../../pages/launch-desk/collaborate-insights-utils';
import {
  AgentTodo,
  CalendarInsightsPayload,
  TasksInsightsPayload,
  fetchInsights,
  fetchTasksInsights,
  fetchTodos,
  fetchProjects,
  ProjectRow,
  postActivityHeartbeat,
  postActivityStop,
} from '../../../pages/launch-desk/ops-desk-types';
import '../../../pages/launch-desk/collaborate-calendar.css';

export function MailTimeInsightsPanel() {
  const anchor = useMemo(() => new Date(), []);
  const [insights, setInsights] = useState<CalendarInsightsPayload | null>(null);
  const [tasksInsights, setTasksInsights] = useState<TasksInsightsPayload | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [insightsMode, setInsightsMode] = useState<'week' | 'month'>('week');
  const [trackingActive, setTrackingActive] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cal, tasks, prows, todoRows] = await Promise.all([
        fetchInsights(anchor),
        fetchTasksInsights(anchor),
        fetchProjects(),
        fetchTodos(),
      ]);
      setInsights(cal);
      setTasksInsights(tasks);
      setProjects(prows);
      setTodos(todoRows);
    } catch {
      /* non-fatal */
    }
  }, [anchor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await postActivityHeartbeat({ surface: 'mail' });
        if (!cancelled) setTrackingActive(true);
      } catch {
        if (!cancelled) setTrackingActive(false);
      }
    };
    const stop = () => {
      void postActivityStop().catch(() => {});
    };
    void beat();
    const id = window.setInterval(() => void beat(), 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void beat();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, []);

  const weekLabel = weekLabelForAnchor(anchor);
  const remainingMins = remainingWorkMinutes(insights);

  return (
    <CollaborateTasksInsights
      insights={insights}
      tasksInsights={tasksInsights}
      insightsMode={insightsMode}
      onInsightsModeChange={setInsightsMode}
      weekLabel={weekLabel}
      donutGradient={donutGradient}
      remainingMins={remainingMins}
      trackingActive={trackingActive}
      projects={projects}
      todos={todos}
      onTimeLogged={reload}
    />
  );
}
