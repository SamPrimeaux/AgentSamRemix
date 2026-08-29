/**
 * Calendar API — workspace events, booking pages, insights, working hours.
 */
import { jsonResponse, getAuthUser } from '../core/auth.js';
import { usHolidaysInWindow } from '../core/calendar-holidays.js';
import {
  createGoogleCalendarEvent,
  removeGoogleCalendarEvent,
  resolveDefaultGoogleCalendarAccount,
  updateGoogleCalendarEvent,
  hasGoogleCalendarWriteScope,
} from '../core/google-calendar-write.js';
import { insertMeetRoomRow, meetJoinUrl, normalizeInviteEmails, sendMeetInvites } from '../core/meet-shared.js';
import {
  heartbeatActiveTimer,
  insertManualTimeEntry,
  startProjectTimer,
  stopActiveTimer,
  summarizeUserTime,
} from '../core/time-tracking-spine.js';

function resolveWorkspaceIdLoose(authUser, env, url) {
  const fromSession = authUser?.workspace_id ?? authUser?.workspaceId ?? null;
  if (fromSession && String(fromSession).trim()) return String(fromSession).trim();
  const fromQuery = url?.searchParams?.get('workspace_id') ?? null;
  if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();
  const fromEnv = env?.WORKSPACE_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

function clampView(viewRaw) {
  const v = String(viewRaw || '').toLowerCase();
  return v === 'day' || v === 'week' || v === 'month' || v === 'year' ? v : 'month';
}

function toSqlDateTime(d) {
  return new Date(d.getTime() - d.getMilliseconds()).toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqlDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return new Date(NaN);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T'));
}

function eventDurationMinutes(ev) {
  const start = parseSqlDate(ev.start_datetime);
  const end = parseSqlDate(ev.end_datetime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function computeWindow(view, url, anchorDate) {
  const qpFrom = url.searchParams.get('from');
  const qpTo = url.searchParams.get('to');
  if (qpFrom && qpTo) return { from: qpFrom, to: qpTo };

  const now = anchorDate ? new Date(anchorDate) : new Date();
  const from = new Date(now);
  const to = new Date(now);

  if (view === 'day') {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else if (view === 'week') {
    const dow = from.getDay();
    from.setDate(from.getDate() - dow);
    from.setHours(0, 0, 0, 0);
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 7);
    to.setMilliseconds(to.getMilliseconds() - 1);
  } else if (view === 'year') {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    to.setMonth(11, 31);
    to.setHours(23, 59, 59, 999);
  } else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const spill = from.getDay();
    from.setDate(from.getDate() - spill);
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 42);
    to.setMilliseconds(to.getMilliseconds() - 1);
  }

  return { from: toSqlDateTime(from), to: toSqlDateTime(to) };
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function parseSourcesParam(raw) {
  const all = new Set(['primary', 'tasks', 'holidays', 'birthdays', 'google_calendar']);
  if (!raw || raw === 'all') return all;
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function createMeetRoomForEvent(env, request, { title, workspaceId, tenantId, createdBy, calendarEventId, status = 'scheduled' }) {
  const roomId = `room_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await insertMeetRoomRow(env, {
    roomId,
    title: title || 'Client call',
    userId: createdBy,
    workspaceId,
    tenantId,
    calendarEventId,
    status,
  });
  return roomId;
}

async function fetchTaskCalendarEvents(env, workspaceId, tenantId, from, to) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, description, status, priority, linked_route, notes, due_date, created_at
       FROM agentsam_todo
       WHERE workspace_id = ?
         AND tenant_id = ?
         AND (status IS NULL OR LOWER(TRIM(status)) NOT IN ('done', 'completed', 'cancelled'))
       ORDER BY priority ASC, sort_order ASC
       LIMIT 200`,
    )
      .bind(workspaceId, tenantId)
      .all();
    const fromMs = parseSqlDate(from).getTime();
    const toMs = parseSqlDate(to).getTime();
    return (results || [])
      .map((row) => {
        const dueRaw = row.due_date != null ? String(row.due_date).trim() : '';
        const anchorRaw = dueRaw || (row.created_at != null ? String(row.created_at).trim() : '');
        if (!anchorRaw) return null;
        const parsed = parseSqlDate(anchorRaw);
        if (Number.isNaN(parsed.getTime())) return null;
        const start = new Date(parsed);
        const hasTime = dueRaw.includes(':') || dueRaw.includes('T');
        if (!hasTime) {
          start.setHours(9, 0, 0, 0);
        }
        if (start.getTime() < fromMs || start.getTime() > toMs) return null;
        const end = new Date(start.getTime() + 30 * 60000);
        return {
          id: `task_${row.id}`,
          title: row.title || 'Task',
          description: row.description || row.notes || null,
          event_type: 'task',
          calendar_source: 'tasks',
          start_datetime: toSqlDateTime(start),
          end_datetime: toSqlDateTime(end),
          color: '#4285f4',
          status: row.status || 'open',
          all_day: hasTime ? 0 : 1,
          todo_id: String(row.id),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchBirthdayEvents(env, workspaceId) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT display_name, email FROM workspace_members
       WHERE workspace_id = ? AND COALESCE(is_active, 1) = 1`,
    )
      .bind(workspaceId)
      .all();
    const year = new Date().getFullYear();
    return (results || []).map((m, i) => {
      const day = (i % 28) + 1;
      const month = (i % 12) + 1;
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return {
        id: `bday_${m.email || i}`,
        title: `${m.display_name || m.email || 'Member'} birthday`,
        event_type: 'birthday',
        calendar_source: 'birthdays',
        all_day: 1,
        start_datetime: `${key} 00:00:00`,
        end_datetime: `${key} 23:59:59`,
        color: '#33a852',
        status: 'scheduled',
      };
    });
  } catch {
    return [];
  }
}

function computeInsights(events, workingHours) {
  const byType = {
    focus: 0,
    task: 0,
    one_on_one: 0,
    multi_guest: 0,
    need_response: 0,
    meeting: 0,
    event: 0,
    other: 0,
  };
  const people = new Map();

  for (const ev of events) {
    if (ev.calendar_source === 'holidays') continue;
    const mins = eventDurationMinutes(ev);
    const type = String(ev.event_type || 'event').toLowerCase();
    if (type === 'focus') byType.focus += mins;
    else if (type === 'task') byType.task += mins;
    else if (type === 'meeting' || type === 'client_call') byType.meeting += mins;
    else if (type === 'event') byType.event += mins;
    else byType.other += mins;

    let attendees = [];
    try {
      attendees = ev.attendees ? (typeof ev.attendees === 'string' ? JSON.parse(ev.attendees) : ev.attendees) : [];
    } catch {
      attendees = [];
    }
    if (Array.isArray(attendees)) {
      if (attendees.length === 1) byType.one_on_one += mins;
      if (attendees.length >= 3) byType.multi_guest += mins;
      for (const email of attendees) {
        const key = String(email).toLowerCase();
        people.set(key, (people.get(key) || 0) + mins);
      }
    }
  }

  const workMins =
    workingHours?.start_minutes != null && workingHours?.end_minutes != null
      ? Math.max(0, Number(workingHours.end_minutes) - Number(workingHours.start_minutes))
      : 480;

  return {
    breakdown_minutes: byType,
    meeting_minutes: byType.meeting + byType.one_on_one + byType.multi_guest,
    people: [...people.entries()]
      .map(([email, minutes]) => ({ email, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 12),
    working_minutes_per_day: workMins,
  };
}

async function getWorkingHours(env, workspaceId, userId) {
  try {
    const row = await env.DB.prepare(
      `SELECT timezone, start_minutes, end_minutes, work_days_json
       FROM calendar_working_hours WHERE workspace_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(workspaceId, userId)
      .first();
    if (row) return row;
  } catch {
    /* table may not exist yet */
  }
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
    start_minutes: 540,
    end_minutes: 1020,
    work_days_json: '[1,2,3,4,5]',
  };
}

async function upsertWorkingHours(env, workspaceId, userId, body) {
  const id = `cwh_${workspaceId}_${userId}`.slice(0, 64);
  const timezone = String(body.timezone || 'America/Chicago').slice(0, 64);
  const start_minutes = Number(body.start_minutes ?? 540);
  const end_minutes = Number(body.end_minutes ?? 1020);
  const work_days_json =
    typeof body.work_days_json === 'string'
      ? body.work_days_json
      : JSON.stringify(body.work_days_json || [1, 2, 3, 4, 5]);
  await env.DB.prepare(
    `INSERT INTO calendar_working_hours (id, workspace_id, user_id, timezone, start_minutes, end_minutes, work_days_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET
       timezone = excluded.timezone,
       start_minutes = excluded.start_minutes,
       end_minutes = excluded.end_minutes,
       work_days_json = excluded.work_days_json,
       updated_at = datetime('now')`,
  )
    .bind(id, workspaceId, userId, timezone, start_minutes, end_minutes, work_days_json)
    .run();
  return getWorkingHours(env, workspaceId, userId);
}

export async function handleCalendarApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/$/, '');
  const parts = path.replace('/api/calendar', '').split('/').filter(Boolean);

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const workspaceId = resolveWorkspaceIdLoose(authUser, env, url);
  const tenantId =
    authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : null;
  const userId = String(authUser?.id || authUser?.user_id || authUser?.email || '').trim();

  // GET /api/calendar/google/status
  if (parts[0] === 'google' && parts[1] === 'status' && method === 'GET') {
    const { listGoogleCalendarTokenRowsForUser } = await import('../core/google-calendar-user-tokens.js');
    const rows = await listGoogleCalendarTokenRowsForUser(env, authUser);
    const accounts = [];
    for (const row of rows) {
      let last_sync_at = null;
      let last_sync_count = 0;
      try {
        const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
        last_sync_at = meta.last_sync_at || null;
        last_sync_count = Number(meta.last_sync_count) || 0;
      } catch {
        /* ignore */
      }
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM calendar_events
         WHERE workspace_id = ? AND calendar_source = 'google_calendar'
           AND lower(sync_account) = ?`,
      )
        .bind(workspaceId, String(row.account_identifier || '').toLowerCase())
        .first()
        .catch(() => null);
      accounts.push({
        account: row.account_identifier || row.account_email,
        last_sync_at,
        last_sync_count,
        event_count: Number(countRow?.cnt) || 0,
        write_scope: hasGoogleCalendarWriteScope(row.scope),
        needs_reconnect: !hasGoogleCalendarWriteScope(row.scope),
      });
    }
    return jsonResponse({ connected: accounts.length > 0, accounts }, 200);
  }

  // POST /api/calendar/google/sync — on-demand sync for demo
  if (parts[0] === 'google' && parts[1] === 'sync' && method === 'POST') {
    const { listGoogleCalendarTokenRowsForUser } = await import('../core/google-calendar-user-tokens.js');
    const { syncGoogleCalendarForTokenRow } = await import('../core/google-calendar-sync.js');
    const rows = await listGoogleCalendarTokenRowsForUser(env, authUser);
    if (!rows.length) {
      return jsonResponse(
        {
          ok: false,
          error: 'google_calendar_not_connected',
          connect_url: '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
        },
        404,
      );
    }
    let synced = 0;
    for (const row of rows) {
      const out = await syncGoogleCalendarForTokenRow(env, {
        user_id: row.user_id,
        tenant_id: tenantId || row.tenant_id,
        workspace_id: workspaceId,
        account_identifier: row.account_identifier,
        account_email: row.account_email,
      });
      if (out.ok) synced += out.synced || 0;
    }
    return jsonResponse({ ok: true, synced, accounts: rows.length }, 200);
  }

  if (!workspaceId && parts[0] !== 'book') {
    return jsonResponse({ events: [] }, 200);
  }

  // GET /api/calendar/view/:view
  if (parts[0] === 'view' && method === 'GET') {
    const view = clampView(parts[1] || 'month');
    const anchor = url.searchParams.get('anchor');
    const { from, to } = computeWindow(view, url, anchor);
    const sources = parseSourcesParam(url.searchParams.get('sources'));

    let events = [];
    if (sources.has('primary')) {
      const { results } = await env.DB.prepare(
        `SELECT ce.*, mr.id AS room_id, mr.status AS room_status
         FROM calendar_events ce
         LEFT JOIN meet_rooms mr ON mr.id = ce.meet_room_id
         WHERE ce.workspace_id = ?
           AND ce.start_datetime >= ?
           AND ce.start_datetime <= ?
           AND (ce.calendar_source IS NULL OR ce.calendar_source = 'primary' OR ce.calendar_source = '')
         ORDER BY ce.start_datetime ASC`,
      )
        .bind(workspaceId, from, to)
        .all();
      events = events.concat(results || []);
    }

    if (sources.has('tasks') && tenantId) {
      events = events.concat(await fetchTaskCalendarEvents(env, workspaceId, tenantId, from, to));
    }
    if (sources.has('holidays')) {
      events = events.concat(usHolidaysInWindow(from, to));
    }
    if (sources.has('birthdays')) {
      events = events.concat(await fetchBirthdayEvents(env, workspaceId));
    }
    if (sources.has('google_calendar')) {
      const { results: gcalRows } = await env.DB.prepare(
        `SELECT ce.*, mr.id AS room_id, mr.status AS room_status
         FROM calendar_events ce
         LEFT JOIN meet_rooms mr ON mr.id = ce.meet_room_id
         WHERE ce.workspace_id = ?
           AND ce.calendar_source = 'google_calendar'
           AND ce.start_datetime >= ?
           AND ce.start_datetime <= ?
         ORDER BY ce.start_datetime ASC`,
      )
        .bind(workspaceId, from, to)
        .all()
        .catch(() => ({ results: [] }));
      events = events.concat(gcalRows || []);
    }

    return jsonResponse({ events, window: { from, to }, view }, 200);
  }

  // GET /api/calendar/insights
  if (parts[0] === 'insights' && method === 'GET') {
    const anchor = url.searchParams.get('anchor');
    const { from, to } = computeWindow('week', url, anchor);
    const viewUrl = new URL(url);
    viewUrl.searchParams.set('from', from);
    viewUrl.searchParams.set('to', to);
    const sources = parseSourcesParam('primary,tasks');
    let events = [];
    if (sources.has('primary')) {
      const { results } = await env.DB.prepare(
        `SELECT * FROM calendar_events
         WHERE workspace_id = ? AND start_datetime >= ? AND start_datetime <= ?
         ORDER BY start_datetime ASC`,
      )
        .bind(workspaceId, from, to)
        .all();
      events = results || [];
    }
    if (tenantId) {
      events = events.concat(await fetchTaskCalendarEvents(env, workspaceId, tenantId, from, to));
    }
    const workingHours = await getWorkingHours(env, workspaceId, userId);
    const insights = computeInsights(events, workingHours);

    const weeks = [];
    const anchorDate = anchor ? new Date(anchor) : new Date();
    for (let i = -2; i <= 2; i += 1) {
      const wStart = new Date(anchorDate);
      wStart.setDate(wStart.getDate() - wStart.getDay() + i * 7);
      wStart.setHours(0, 0, 0, 0);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 7);
      const wFrom = toSqlDateTime(wStart);
      const wTo = toSqlDateTime(wEnd);
      const { results } = await env.DB.prepare(
        `SELECT start_datetime, end_datetime, event_type FROM calendar_events
         WHERE workspace_id = ? AND start_datetime >= ? AND start_datetime < ?`,
      )
        .bind(workspaceId, wFrom, wTo)
        .all();
      const mins = (results || []).reduce((sum, ev) => sum + eventDurationMinutes(ev), 0);
      weeks.push({
        label: `${wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(wEnd.getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        minutes: mins,
        active: i === 0,
      });
    }

    return jsonResponse({ window: { from, to }, insights, weeks, working_hours: workingHours }, 200);
  }

  // GET /api/calendar/tasks-insights — today/week time by project + task
  if (parts[0] === 'tasks-insights' && method === 'GET') {
    const anchor = url.searchParams.get('anchor');
    const dayWindow = computeWindow('day', url, anchor);
    const weekWindow = computeWindow('week', url, anchor);

    const summary = await summarizeUserTime(env, userId, {
      fromIso: dayWindow.from.slice(0, 10),
      toIso: dayWindow.to.slice(0, 10),
      projectRef: url.searchParams.get('project_id')?.trim() || null,
    });

    let todayMinutes = summary.todayMinutes;
    let activeTracking = summary.activeTracking;
    const byProjectMap = new Map(summary.byProject.map((r) => [r.project_id, r.minutes]));
    const byTaskMap = new Map(summary.byTask.map((r) => [r.todo_id, r.minutes]));
    let project_active_tracking = summary.projectActiveTracking;
    let project_today_minutes = summary.projectTodayMinutes;
    let active_entry = summary.projectActiveEntry;

    // Calendar task events for the week add scheduled task minutes
    try {
      let taskEvents = [];
      if (tenantId) {
        taskEvents = await fetchTaskCalendarEvents(env, workspaceId, tenantId, weekWindow.from, weekWindow.to);
      }
      for (const ev of taskEvents) {
        const mins = eventDurationMinutes(ev);
        const tid = ev.todo_id || String(ev.id || '').replace(/^task_/, '');
        if (tid.startsWith('todo_')) {
          byTaskMap.set(tid, (byTaskMap.get(tid) || 0) + mins);
        }
      }
    } catch {
      /* non-fatal */
    }

    const projectIds = [...byProjectMap.keys()];
    const projectNames = new Map();
    if (projectIds.length) {
      try {
        const placeholders = projectIds.map(() => '?').join(',');
        const { results: prows } = await env.DB.prepare(
          `SELECT id, name FROM projects WHERE id IN (${placeholders})`,
        )
          .bind(...projectIds)
          .all();
        for (const p of prows || []) projectNames.set(String(p.id), String(p.name || p.id));
        const { results: tprows } = await env.DB.prepare(
          `SELECT project_key, label, projects_id FROM time_projects
           WHERE project_key IN (${placeholders}) OR projects_id IN (${placeholders})`,
        )
          .bind(...projectIds, ...projectIds)
          .all();
        for (const tp of tprows || []) {
          if (tp.project_key) projectNames.set(String(tp.project_key), String(tp.label || tp.project_key));
          if (tp.projects_id) projectNames.set(String(tp.projects_id), String(tp.label || tp.projects_id));
        }
      } catch {
        /* ignore */
      }
    }

    const todoIds = [...byTaskMap.keys()].filter((id) => id.startsWith('todo_'));
    const todoTitles = new Map();
    if (todoIds.length) {
      try {
        const placeholders = todoIds.map(() => '?').join(',');
        const { results: todos } = await env.DB.prepare(
          `SELECT id, title FROM agentsam_todo WHERE id IN (${placeholders})`,
        )
          .bind(...todoIds)
          .all();
        for (const t of todos || []) todoTitles.set(String(t.id), String(t.title || t.id));
      } catch {
        /* ignore */
      }
    }

    const by_project = [...byProjectMap.entries()]
      .map(([project_id, minutes]) => ({
        project_id,
        name: projectNames.get(project_id) || project_id,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    const by_task = [...byTaskMap.entries()]
      .map(([todo_id, minutes]) => ({
        todo_id,
        title: todoTitles.get(todo_id) || todo_id,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    const focusProjectId = url.searchParams.get('project_id')?.trim() || null;

    let agentInferredMinutes = 0;
    let usageRollup = null;
    let scheduledTodayMinutes = 0;
    try {
      const runRow = await env.DB.prepare(
        `SELECT ROUND(COALESCE(SUM(
           CASE WHEN completed_at_unix > created_at_unix
             THEN (completed_at_unix - created_at_unix) / 60.0
             ELSE 4 END
         ), 0)) as minutes
         FROM agentsam_agent_run
         WHERE workspace_id = ?
           AND created_at_unix > unixepoch('now', '-24 hours')`,
      )
        .bind(workspaceId)
        .first();
      agentInferredMinutes = Math.max(0, Math.round(Number(runRow?.minutes) || 0));
    } catch {
      /* non-fatal */
    }

    try {
      usageRollup = await env.DB.prepare(
        `SELECT MAX(cost_usd) as cost_usd, MAX(ai_calls) as ai_calls,
                MAX(tool_calls) as tool_calls, MAX(deployments) as deployments
         FROM agentsam_usage_rollups_daily
         WHERE day = date('now')`,
      ).first();
    } catch {
      /* non-fatal */
    }

    try {
      if (tenantId) {
        const taskEventsToday = await fetchTaskCalendarEvents(
          env,
          workspaceId,
          tenantId,
          dayWindow.from,
          dayWindow.to,
        );
        scheduledTodayMinutes = (taskEventsToday || []).reduce(
          (sum, ev) => sum + eventDurationMinutes(ev),
          0,
        );
      }
    } catch {
      /* non-fatal */
    }

    const combinedTodayMinutes = Math.max(
      todayMinutes,
      agentInferredMinutes > 0 ? Math.min(agentInferredMinutes, todayMinutes + agentInferredMinutes) : 0,
    );

    return jsonResponse(
      {
        today_minutes: todayMinutes,
        agent_inferred_minutes: agentInferredMinutes,
        scheduled_today_minutes: scheduledTodayMinutes,
        combined_today_minutes: combinedTodayMinutes || todayMinutes || agentInferredMinutes,
        usage_rollup: usageRollup,
        active_tracking: activeTracking,
        by_project,
        by_task,
        window: dayWindow,
        project_id: focusProjectId,
        project_active_tracking,
        project_today_minutes,
        active_entry,
      },
      200,
    );
  }

  // POST /api/calendar/project-timer — explicit start/stop for project detail page
  if (parts[0] === 'project-timer' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const projectId = String(body.project_id || '').trim().slice(0, 120);
    if (!projectId) return jsonResponse({ ok: false, error: 'project_id_required' }, 400);
    if (action !== 'start' && action !== 'stop') {
      return jsonResponse({ ok: false, error: 'action_must_be_start_or_stop' }, 400);
    }

    try {
      if (action === 'start') {
        const out = await startProjectTimer(env, {
          userId,
          tenantId,
          workspaceId,
          projectRef: projectId,
          source: 'auto',
        });
        if (!out.ok) return jsonResponse(out, 400);
        return jsonResponse({
          ok: true,
          action: 'start',
          entry_id: out.entry_id,
          project_id: out.project_id,
        }, 201);
      }

      const out = await stopActiveTimer(env, userId, { projectRef: projectId });
      if (!out.ok) {
        return jsonResponse({ ok: false, error: out.error || 'no_active_timer', project_id: projectId }, 404);
      }
      return jsonResponse({
        ok: true,
        action: 'stop',
        entry: out.entry,
        project_id: projectId,
      }, 200);
    } catch (e) {
      console.warn('[calendar/project-timer]', e?.message ?? e);
      return jsonResponse({ ok: false, error: 'project_timer_failed' }, 500);
    }
  }

  // POST /api/calendar/time-entry — manual time log
  if (parts[0] === 'time-entry' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const projectId = String(body.project_id || '').trim().slice(0, 120);
    const todoId = body.todo_id ? String(body.todo_id).trim().slice(0, 64) : null;
    const minutes = Math.min(Math.max(Math.round(Number(body.minutes) || 0), 1), 480);
    const note = body.note ? String(body.note).trim().slice(0, 500) : null;
    if (!projectId) return jsonResponse({ ok: false, error: 'project_id_required' }, 400);

    try {
      const out = await insertManualTimeEntry(env, {
        userId,
        tenantId,
        workspaceId,
        projectRef: projectId,
        minutes,
        todoId,
        note,
        entryDate: body.entry_date ? String(body.entry_date).trim().slice(0, 10) : null,
      });
      if (!out.ok) return jsonResponse(out, 400);
      return jsonResponse({ ok: true, entry_id: out.entry_id, minutes: out.minutes }, 201);
    } catch (e) {
      console.warn('[calendar/time-entry]', e?.message ?? e);
      return jsonResponse({ ok: false, error: 'time_entry_failed' }, 500);
    }
  }

  // POST /api/calendar/activity/stop — close active timer row
  if (parts[0] === 'activity' && parts[1] === 'stop' && method === 'POST') {
    try {
      const out = await stopActiveTimer(env, userId);
      return jsonResponse({ ok: true, stopped: !!out.ok, entry: out.entry || null }, 200);
    } catch (e) {
      console.warn('[calendar/activity/stop]', e?.message ?? e);
      return jsonResponse({ ok: false, error: 'activity_stop_failed' }, 200);
    }
  }

  // POST /api/calendar/activity/heartbeat — autonomous active time while on collaborate
  if (parts[0] === 'activity' && parts[1] === 'heartbeat' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const projectIdRaw = body.project_id != null ? String(body.project_id).trim().slice(0, 120) : '';
    const projectId = projectIdRaw || '_session';
    const todoId = body.todo_id ? String(body.todo_id).trim().slice(0, 64) : null;
    const surface = String(body.surface || 'collaborate').trim().slice(0, 64);

    try {
      const out = await heartbeatActiveTimer(env, {
        userId,
        tenantId,
        workspaceId,
        projectRef: projectId,
        todoId,
        surface,
      });
      return jsonResponse({ ok: true, tracked_seconds: 60, ...out }, 200);
    } catch (e) {
      console.warn('[calendar/activity/heartbeat]', e?.message ?? e);
      return jsonResponse({ ok: false, error: 'activity_unavailable' }, 200);
    }
  }

  // GET /api/calendar/people?q=
  if (parts[0] === 'people' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const { results } = await env.DB.prepare(
      `SELECT id, display_name, email, role, user_id
       FROM workspace_members
       WHERE workspace_id = ? AND COALESCE(is_active, 1) = 1
       ORDER BY display_name ASC, email ASC`,
    )
      .bind(workspaceId)
      .all();
    const filtered = (results || []).filter((m) => {
      if (!q) return true;
      return (
        String(m.display_name || '').toLowerCase().includes(q) ||
        String(m.email || '').toLowerCase().includes(q)
      );
    });
    return jsonResponse({ people: filtered.slice(0, 20) }, 200);
  }

  // GET|PUT /api/calendar/preferences
  if (parts[0] === 'preferences') {
    if (method === 'GET') {
      const wh = await getWorkingHours(env, workspaceId, userId);
      return jsonResponse({ working_hours: wh, timezone: wh.timezone }, 200);
    }
    if (method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const wh = await upsertWorkingHours(env, workspaceId, userId, body.working_hours || body);
      return jsonResponse({ working_hours: wh }, 200);
    }
  }

  // GET|POST /api/calendar/booking-pages
  if (parts[0] === 'booking-pages' && !parts[1]) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, slug, title, duration_min, description, location, is_active, created_at
         FROM calendar_booking_pages WHERE workspace_id = ? ORDER BY title ASC`,
      )
        .bind(workspaceId)
        .all();
      return jsonResponse({ pages: results || [] }, 200);
    }
    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const title = String(body.title || '').trim().slice(0, 200);
      const slug = String(body.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 80);
      const duration_min = Number(body.duration_min || 30);
      if (!title || !slug) return jsonResponse({ error: 'title and slug required' }, 400);
      const id = newId('cbp');
      await env.DB.prepare(
        `INSERT INTO calendar_booking_pages (id, workspace_id, tenant_id, user_id, slug, title, duration_min, description, location, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
        .bind(
          id,
          workspaceId,
          tenantId,
          userId,
          slug,
          title,
          duration_min,
          body.description || null,
          body.location || null,
        )
        .run();
      return jsonResponse({ success: true, id, slug }, 201);
    }
  }

  // PATCH|DELETE /api/calendar/booking-pages/:id
  if (parts[0] === 'booking-pages' && parts[1]) {
    const pageId = String(parts[1]).trim();
    const existing = await env.DB.prepare(
      `SELECT * FROM calendar_booking_pages WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(pageId, workspaceId)
      .first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);

    if (method === 'PATCH' || method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const fields = [];
      const binds = [];
      const set = (col, val) => {
        if (val !== undefined) {
          fields.push(`${col} = ?`);
          binds.push(val);
        }
      };
      set('title', body.title != null ? String(body.title).trim().slice(0, 200) : undefined);
      set('slug', body.slug != null ? String(body.slug).trim().slice(0, 80) : undefined);
      set('duration_min', body.duration_min != null ? Number(body.duration_min) : undefined);
      set('description', body.description != null ? String(body.description).slice(0, 2000) : undefined);
      set('location', body.location != null ? String(body.location).slice(0, 400) : undefined);
      set('is_active', body.is_active != null ? (body.is_active ? 1 : 0) : undefined);
      if (!fields.length) return jsonResponse({ error: 'No fields to update' }, 400);
      binds.push(pageId, workspaceId);
      await env.DB.prepare(
        `UPDATE calendar_booking_pages SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`,
      )
        .bind(...binds)
        .run();
      const row = await env.DB.prepare(
        `SELECT id, slug, title, duration_min, description, location, is_active FROM calendar_booking_pages WHERE id = ?`,
      )
        .bind(pageId)
        .first();
      return jsonResponse({ success: true, page: row }, 200);
    }

    if (method === 'DELETE') {
      await env.DB.prepare(
        `UPDATE calendar_booking_pages SET is_active = 0 WHERE id = ? AND workspace_id = ?`,
      )
        .bind(pageId, workspaceId)
        .run();
      return jsonResponse({ success: true, deactivated: true, id: pageId }, 200);
    }
  }

  // POST /api/calendar/book/:slug — public book flow (auth required)
  if (parts[0] === 'book' && parts[1] && method === 'POST') {
    const slug = String(parts[1]).trim();
    const body = await request.json().catch(() => ({}));
    const page = await env.DB.prepare(
      `SELECT * FROM calendar_booking_pages WHERE workspace_id = ? AND slug = ? AND is_active = 1 LIMIT 1`,
    )
      .bind(workspaceId, slug)
      .first();
    if (!page) return jsonResponse({ error: 'Booking page not found' }, 404);
    const start_datetime = String(body.start_datetime || '').trim();
    if (!start_datetime) return jsonResponse({ error: 'start_datetime required' }, 400);
    const start = parseSqlDate(start_datetime);
    const end = new Date(start.getTime() + Number(page.duration_min || 30) * 60000);
    const title = `${page.title} · ${authUser.email || userId}`;
    const id = newId('cev');
    await env.DB.prepare(
      `INSERT INTO calendar_events
        (id, tenant_id, workspace_id, event_type, title, description, location,
         start_datetime, end_datetime, status, attendees, created_by, calendar_source, created_at, updated_at)
       VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?, 'scheduled', ?, ?, 'primary', datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        title,
        page.description,
        page.location,
        toSqlDateTime(start),
        toSqlDateTime(end),
        JSON.stringify([authUser.email].filter(Boolean)),
        page.user_id || userId,
      )
      .run();
    const meetRoomId = await createMeetRoomForEvent(env, request, {
      title,
      workspaceId,
      tenantId,
      createdBy: page.user_id || userId,
      calendarEventId: id,
    });
    await env.DB.prepare(`UPDATE calendar_events SET meet_room_id = ? WHERE id = ?`).bind(meetRoomId, id).run();
    return jsonResponse({
      success: true,
      id,
      meet_room_id: meetRoomId,
      join_url: meetJoinUrl(env, meetRoomId, request),
    }, 201);
  }

  // POST /api/calendar/events
  if (parts[0] === 'events' && !parts[1] && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const title = String(body?.title || '').trim().slice(0, 200);
    const description = body?.description != null ? String(body.description).slice(0, 4000) : null;
    const location = body?.location != null ? String(body.location).slice(0, 400) : null;
    const start_datetime = body?.start_datetime != null ? String(body.start_datetime).trim() : null;
    const end_datetime = body?.end_datetime != null ? String(body.end_datetime).trim() : null;
    const status = body?.status != null ? String(body.status).trim().slice(0, 40) : 'scheduled';
    const event_type = body?.event_type != null ? String(body.event_type).trim().slice(0, 40) : 'event';
    const color = body?.color != null ? String(body.color).trim().slice(0, 20) : null;
    const all_day = body?.all_day === true || body?.all_day === 1 ? 1 : 0;
    const timezone = body?.timezone != null ? String(body.timezone).slice(0, 64) : null;
    const recurrence_rule = body?.recurrence_rule != null ? String(body.recurrence_rule).slice(0, 200) : null;
    const calendar_source = body?.calendar_source != null ? String(body.calendar_source).slice(0, 40) : 'primary';
    const guest_permissions_json =
      body?.guest_permissions != null
        ? JSON.stringify(body.guest_permissions)
        : body?.guest_permissions_json != null
          ? typeof body.guest_permissions_json === 'string'
            ? body.guest_permissions_json
            : JSON.stringify(body.guest_permissions_json)
          : null;
    const attendeesJson =
      body?.attendees != null
        ? typeof body.attendees === 'string'
          ? body.attendees
          : JSON.stringify(body.attendees)
        : null;

    if (!title || !start_datetime || !end_datetime) {
      return jsonResponse({ success: false, error: 'title, start_datetime, end_datetime required' }, 400);
    }

    const syncToGoogle = body?.sync_to_google !== false;
    const googleAccount =
      body?.google_account != null
        ? String(body.google_account).trim().toLowerCase()
        : syncToGoogle
          ? await resolveDefaultGoogleCalendarAccount(env, authUser)
          : null;

    let externalEventId = null;
    let syncAccount = null;
    let effectiveSource = calendar_source;

    if (googleAccount && syncToGoogle) {
      const gOut = await createGoogleCalendarEvent(
        env,
        userId,
        {
          title,
          description,
          location,
          start_datetime,
          end_datetime,
          all_day,
          timezone,
          attendees: attendeesJson,
        },
        { account: googleAccount },
      );
      if (!gOut.ok) {
        if (gOut.needs_reconnect) {
          return jsonResponse(
            {
              success: false,
              error: gOut.error,
              needs_reconnect: true,
              connect_url: gOut.connect_url || '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
            },
            gOut.error === 'google_calendar_not_connected' ? 404 : 403,
          );
        }
        return jsonResponse({ success: false, error: gOut.error || 'google_create_failed' }, gOut.status || 502);
      }
      externalEventId = gOut.external_event_id;
      syncAccount = gOut.sync_account;
      effectiveSource = 'google_calendar';
    }

    const id = externalEventId
      ? `gce_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
      : newId('cev');
    await env.DB.prepare(
      `INSERT INTO calendar_events
        (id, tenant_id, workspace_id, event_type, title, description, location,
         start_datetime, end_datetime, color, status, attendees, created_by,
         all_day, timezone, recurrence_rule, calendar_source, guest_permissions_json,
         external_event_id, sync_account, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        event_type,
        title,
        description,
        location,
        start_datetime,
        end_datetime,
        color,
        status,
        attendeesJson,
        userId,
        all_day,
        timezone,
        recurrence_rule,
        effectiveSource,
        guest_permissions_json,
        externalEventId,
        syncAccount,
      )
      .run();

    let attendeeList = [];
    try {
      if (Array.isArray(body?.attendees)) attendeeList = body.attendees;
      else if (attendeesJson) attendeeList = JSON.parse(attendeesJson);
    } catch {
      attendeeList = [];
    }
    const attendees = normalizeInviteEmails(attendeeList);
    const withMeet =
      body?.with_meet === true ||
      event_type === 'meeting' ||
      event_type === 'client_call' ||
      body?.add_meet === true;

    let meetRoomId = null;
    if (withMeet) {
      meetRoomId = await createMeetRoomForEvent(env, request, {
        title,
        workspaceId,
        tenantId,
        createdBy: userId,
        calendarEventId: id,
      });
      await env.DB.prepare(`UPDATE calendar_events SET meet_room_id = ? WHERE id = ?`).bind(meetRoomId, id).run();
      if (attendees.length > 0) {
        await sendMeetInvites(env, {
          roomId: meetRoomId,
          emails: attendees,
          invitedBy: userId,
          workspaceId,
          tenantId,
          calendarEventId: id,
          meetingName: title,
          inviterLabel: authUser?.email || userId,
          link: meetJoinUrl(env, meetRoomId, request),
          scheduledLabel: `${start_datetime} → ${end_datetime}`,
          description,
        }).catch(() => {});
      }
    }

    return jsonResponse({
      success: true,
      id,
      google_synced: Boolean(externalEventId),
      external_event_id: externalEventId,
      meet_room_id: meetRoomId,
      join_url: meetRoomId ? meetJoinUrl(env, meetRoomId, request) : null,
    }, 200);
  }

  // GET /api/calendar/events/:id
  if (parts[0] === 'events' && parts[1] && !parts[2] && method === 'GET') {
    const id = String(parts[1]).trim();
    const row = await env.DB.prepare(
      `SELECT ce.*, mr.id AS room_id FROM calendar_events ce
       LEFT JOIN meet_rooms mr ON mr.id = ce.meet_room_id
       WHERE ce.id = ? AND ce.workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ event: row }, 200);
  }

  // PUT /api/calendar/events/:id
  if (parts[0] === 'events' && parts[1] && method === 'PUT') {
    const id = String(parts[1] || '').trim();
    const body = await request.json().catch(() => ({}));
    const existing = await env.DB.prepare(
      `SELECT * FROM calendar_events WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);

    const fields = [];
    const binds = [];

    const setField = (col, val) => {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        binds.push(val);
      }
    };

    setField('title', body.title != null ? String(body.title).trim().slice(0, 200) : undefined);
    setField('description', body.description != null ? String(body.description).slice(0, 4000) : undefined);
    setField('location', body.location != null ? String(body.location).slice(0, 400) : undefined);
    setField('start_datetime', body.start_datetime != null ? String(body.start_datetime).trim() : undefined);
    setField('end_datetime', body.end_datetime != null ? String(body.end_datetime).trim() : undefined);
    setField('status', body.status != null ? String(body.status).trim().slice(0, 40) : undefined);
    setField('completed_at', body.completed_at != null ? String(body.completed_at).trim() : undefined);
    setField('event_type', body.event_type != null ? String(body.event_type).trim().slice(0, 40) : undefined);
    setField('color', body.color != null ? String(body.color).slice(0, 20) : undefined);
    setField('all_day', body.all_day != null ? (body.all_day ? 1 : 0) : undefined);
    setField('timezone', body.timezone != null ? String(body.timezone).slice(0, 64) : undefined);
    setField('recurrence_rule', body.recurrence_rule != null ? String(body.recurrence_rule).slice(0, 200) : undefined);
    if (body.attendees != null) {
      setField(
        'attendees',
        typeof body.attendees === 'string' ? body.attendees : JSON.stringify(body.attendees),
      );
    }
    if (body.guest_permissions != null || body.guest_permissions_json != null) {
      setField(
        'guest_permissions_json',
        body.guest_permissions_json != null
          ? typeof body.guest_permissions_json === 'string'
            ? body.guest_permissions_json
            : JSON.stringify(body.guest_permissions_json)
          : JSON.stringify(body.guest_permissions),
      );
    }

    if (!fields.length) return jsonResponse({ success: false, error: 'No fields to update' }, 400);

    const merged = { ...existing };
    if (body.title != null) merged.title = String(body.title).trim().slice(0, 200);
    if (body.description != null) merged.description = String(body.description).slice(0, 4000);
    if (body.location != null) merged.location = String(body.location).slice(0, 400);
    if (body.start_datetime != null) merged.start_datetime = String(body.start_datetime).trim();
    if (body.end_datetime != null) merged.end_datetime = String(body.end_datetime).trim();
    if (body.all_day != null) merged.all_day = body.all_day ? 1 : 0;
    if (body.timezone != null) merged.timezone = String(body.timezone).slice(0, 64);
    if (body.attendees != null) {
      merged.attendees =
        typeof body.attendees === 'string' ? body.attendees : JSON.stringify(body.attendees);
    }

    const externalId = existing.external_event_id ? String(existing.external_event_id) : '';
    const syncAcct = existing.sync_account ? String(existing.sync_account) : '';

    if (externalId && syncAcct) {
      const gOut = await updateGoogleCalendarEvent(env, userId, externalId, merged, { account: syncAcct });
      if (!gOut.ok) {
        if (gOut.needs_reconnect) {
          return jsonResponse(
            {
              success: false,
              error: gOut.error,
              needs_reconnect: true,
              connect_url: gOut.connect_url || '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
            },
            403,
          );
        }
        return jsonResponse({ success: false, error: gOut.error || 'google_update_failed' }, gOut.status || 502);
      }
    } else if (body.sync_to_google !== false) {
      const googleAccount =
        body?.google_account != null
          ? String(body.google_account).trim().toLowerCase()
          : await resolveDefaultGoogleCalendarAccount(env, authUser);
      if (googleAccount) {
        const gOut = await createGoogleCalendarEvent(env, userId, merged, { account: googleAccount });
        if (gOut.ok && gOut.external_event_id) {
          setField('external_event_id', gOut.external_event_id);
          setField('sync_account', gOut.sync_account);
          setField('calendar_source', 'google_calendar');
        } else if (gOut.needs_reconnect) {
          return jsonResponse(
            {
              success: false,
              error: gOut.error,
              needs_reconnect: true,
              connect_url: gOut.connect_url || '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
            },
            403,
          );
        }
      }
    }

    fields.push("updated_at = datetime('now')");
    binds.push(id, workspaceId);
    await env.DB.prepare(
      `UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...binds)
      .run();

    if (body.with_meet === true) {
      const ev = await env.DB.prepare(`SELECT * FROM calendar_events WHERE id = ?`).bind(id).first();
      if (ev && !ev.meet_room_id) {
        const meetRoomId = await createMeetRoomForEvent(env, request, {
          title: ev.title,
          workspaceId,
          tenantId,
          createdBy: userId,
          calendarEventId: id,
        });
        await env.DB.prepare(`UPDATE calendar_events SET meet_room_id = ? WHERE id = ?`).bind(meetRoomId, id).run();
      }
    }

    return jsonResponse({ success: true }, 200);
  }

  // DELETE /api/calendar/events/:id
  if (parts[0] === 'events' && parts[1] && method === 'DELETE') {
    const id = String(parts[1] || '').trim();
    const existing = await env.DB.prepare(
      `SELECT id, external_event_id, sync_account FROM calendar_events
       WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first()
      .catch(() => null);

    if (!existing) {
      return jsonResponse({ success: false, error: 'not_found' }, 404);
    }

    const externalId = existing.external_event_id ? String(existing.external_event_id) : '';
    const syncAcct = existing.sync_account ? String(existing.sync_account) : '';

    if (externalId && syncAcct) {
      const gOut = await removeGoogleCalendarEvent(env, userId, externalId, { account: syncAcct });
      if (!gOut.ok) {
        if (gOut.needs_reconnect) {
          return jsonResponse(
            {
              success: false,
              error: gOut.error,
              needs_reconnect: true,
              connect_url: '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
            },
            403,
          );
        }
        if (gOut.status !== 404) {
          return jsonResponse({ success: false, error: gOut.error || 'google_delete_failed' }, gOut.status || 502);
        }
      }
    }

    await env.DB.prepare(`DELETE FROM calendar_events WHERE id = ? AND workspace_id = ?`)
      .bind(id, workspaceId)
      .run();
    return jsonResponse({ success: true, google_deleted: Boolean(externalId) }, 200);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
