/**
 * Ops Desk day bundle — calendar_events, agentsam_plans/tasks, agentsam_todo, meet_rooms.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';

function resolveWorkspaceId(authUser, env, url) {
  const fromSession = authUser?.workspace_id ?? authUser?.workspaceId ?? null;
  if (fromSession && String(fromSession).trim()) return String(fromSession).trim();
  const fromQuery = url?.searchParams?.get('workspace_id') ?? null;
  if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();
  const fromEnv = env?.WORKSPACE_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

function resolveTenantId(authUser, env) {
  const tid = authUser?.tenant_id ?? authUser?.tenantId ?? null;
  if (tid != null && String(tid).trim() !== '') return String(tid).trim();
  return env?.TENANT_ID ? String(env.TENANT_ID).trim() : null;
}

function normalizeDateParam(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function dayBounds(dateStr) {
  return {
    from: `${dateStr} 00:00:00`,
    to: `${dateStr} 23:59:59`,
  };
}

async function attachLivePlanCounts(db, plan) {
  const counts = await db.prepare(
    `SELECT
       COUNT(*) AS tasks_total,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS tasks_done,
       SUM(CASE WHEN status IN ('todo', 'in_progress', 'blocked') THEN 1 ELSE 0 END) AS open_count
     FROM agentsam_plan_tasks
     WHERE plan_id = ?`,
  )
    .bind(plan.id)
    .first();

  const { results: openTasks } = await db.prepare(
    `SELECT id, title, status, priority, category, blocked_reason, order_index
     FROM agentsam_plan_tasks
     WHERE plan_id = ?
       AND status IN ('todo', 'in_progress', 'blocked')
     ORDER BY
       CASE priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
       order_index ASC`,
  )
    .bind(plan.id)
    .all();

  return {
    ...plan,
    tasks_total: Number(counts?.tasks_total ?? 0),
    tasks_done: Number(counts?.tasks_done ?? 0),
    open_count: Number(counts?.open_count ?? 0),
    open_tasks: openTasks || [],
  };
}

async function fetchDayEvents(db, workspaceId, dateStr) {
  const { from, to } = dayBounds(dateStr);
  const { results } = await db.prepare(
    `SELECT
       ce.*,
       mr.id AS room_id,
       mr.status AS room_status,
       mr.engine AS room_engine,
       mr.participant_count AS room_participant_count
     FROM calendar_events ce
     LEFT JOIN meet_rooms mr ON mr.id = ce.meet_room_id
     WHERE ce.workspace_id = ?
       AND ce.start_datetime >= ?
       AND ce.start_datetime <= ?
     ORDER BY ce.start_datetime ASC`,
  )
    .bind(workspaceId, from, to)
    .all();
  return results || [];
}

async function fetchFocusPlans(db, workspaceId, tenantId, dateStr) {
  const { results } = await db.prepare(
    `SELECT id, title, plan_type, plan_date, status, morning_brief
     FROM agentsam_plans
     WHERE plan_date = ?
       AND status = 'active'
       AND (workspace_id = ? OR (? IS NOT NULL AND tenant_id = ?))
     ORDER BY title ASC`,
  )
    .bind(dateStr, workspaceId, tenantId, tenantId)
    .all();

  const out = [];
  for (const plan of results || []) {
    out.push(await attachLivePlanCounts(db, plan));
  }
  return out;
}

async function fetchOpenPlanTasks(db, workspaceId, tenantId) {
  const { results } = await db.prepare(
    `SELECT
       pt.id, pt.plan_id, pt.title, pt.status, pt.priority, pt.category,
       pt.blocked_reason, pt.estimated_minutes, pt.completed_at, pt.todo_id,
       p.title AS plan_title, p.plan_type
     FROM agentsam_plan_tasks pt
     LEFT JOIN agentsam_plans p ON p.id = pt.plan_id
     WHERE pt.status NOT IN ('done', 'skipped', 'carried')
       AND (pt.workspace_id = ? OR (? IS NOT NULL AND pt.tenant_id = ?))
     ORDER BY
       CASE pt.priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
       pt.order_index ASC
     LIMIT 80`,
  )
    .bind(workspaceId, tenantId, tenantId)
    .all();
  return results || [];
}

async function fetchOpenTodos(db, workspaceId, tenantId) {
  const { results } = await db.prepare(
    `SELECT
       t.id, t.title, t.status, t.execution_status, t.priority, t.category,
       t.plan_id, t.project_key, t.linked_route, t.linked_commit, t.output_summary,
       t.error_trace, t.sort_order,
       p.title AS plan_title
     FROM agentsam_todo t
     LEFT JOIN agentsam_plans p ON p.id = t.plan_id
     WHERE (t.workspace_id = ? OR (? IS NOT NULL AND t.tenant_id = ?))
       AND t.execution_status NOT IN ('done', 'skipped', 'cancelled')
       AND t.status NOT IN ('done', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM agentsam_plan_tasks pt
         WHERE pt.todo_id = t.id
           AND pt.status NOT IN ('done', 'skipped', 'carried')
       )
     ORDER BY
       CASE t.priority
         WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'high' THEN 3
         WHEN 'medium' THEN 4 ELSE 5
       END,
       t.sort_order ASC,
       t.updated_at DESC
     LIMIT 60`,
  )
    .bind(workspaceId, tenantId, tenantId)
    .all();
  return results || [];
}

async function fetchKanbanDueOnDay(db, tenantId, dateStr) {
  const { results } = await db.prepare(
    `SELECT
       kt.id, kt.title, kt.priority, kt.due_date, kt.completed_at,
       kt.client_name, kt.tags, kt.column_id, kt.category
     FROM kanban_tasks kt
     WHERE kt.tenant_id = ?
       AND kt.completed_at IS NULL
       AND kt.due_date IS NOT NULL
       AND date(kt.due_date, 'unixepoch') = ?
     ORDER BY kt.priority DESC, kt.due_date ASC`,
  )
    .bind(tenantId, dateStr)
    .all();
  return results || [];
}

function normalizeQueuePriority(raw) {
  const p = String(raw || '')
    .trim()
    .toLowerCase();
  if (p === 'p0' || p === 'critical' || p === 'urgent') return 'P0';
  if (p === 'p1' || p === 'high') return 'P1';
  if (p === 'p3' || p === 'low') return 'P3';
  if (p === 'p2' || p === 'medium') return 'P2';
  return 'P2';
}

function isQueueItemBlocked(item) {
  return item.status === 'blocked' || Boolean(item.blocked_reason);
}

function isKanbanDueToday(item, dateStr) {
  if (item.source !== 'kanban') return false;
  return true;
}

function isPlanTaskDueToday(_item, _dateStr) {
  return false;
}

function executionQueueSortKey(item, dateStr) {
  const priority = normalizeQueuePriority(item.priority);
  const blocked = isQueueItemBlocked(item);
  const dueToday =
    item.source === 'kanban' ? isKanbanDueToday(item, dateStr) : isPlanTaskDueToday(item, dateStr);

  if (priority === 'P0' && blocked) return 0;
  if (priority === 'P0' && dueToday) return 1;
  if (priority === 'P1' && dueToday) return 2;
  if (priority === 'P0') return 3;
  return 99;
}

function buildExecutionQueue(kanbanDue, focusPlans, dateStr, limit) {
  const items = [];

  for (const row of kanbanDue || []) {
    items.push({
      id: `kanban:${row.id}`,
      title: String(row.title || ''),
      priority: normalizeQueuePriority(row.priority),
      status: 'due_today',
      status_label: 'Due today',
      source: 'kanban',
      kanban_task_id: String(row.id),
      highlight_id: String(row.id),
    });
  }

  for (const plan of focusPlans || []) {
    for (const task of plan.open_tasks || []) {
      const status = String(task.status || 'todo');
      items.push({
        id: `plan_task:${task.id}`,
        title: String(task.title || ''),
        priority: normalizeQueuePriority(task.priority),
        status,
        status_label: status.replace(/_/g, ' '),
        source: 'plan_task',
        kanban_task_id: null,
        highlight_id: null,
        blocked_reason: task.blocked_reason || null,
      });
    }
  }

  items.sort((a, b) => {
    const ka = executionQueueSortKey(a, dateStr);
    const kb = executionQueueSortKey(b, dateStr);
    if (ka !== kb) return ka - kb;
    return String(a.title).localeCompare(String(b.title));
  });

  return items.slice(0, limit);
}

function parseDaySourceFilter(url) {
  const raw = url.searchParams.get('source') || '';
  const sources = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const limitRaw = parseInt(url.searchParams.get('limit') || '5', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, limitRaw)) : 5;
  const slim =
    sources.size > 0 &&
    [...sources].every((s) => s === 'kanban_due' || s === 'focus_plans');
  return { sources, limit, slim };
}

async function fetchActivePlansWithTasks(db, workspaceId, tenantId) {
  const { results: plans } = await db.prepare(
    `SELECT
       p.id, p.title, p.plan_type, p.plan_date, p.status,
       p.morning_brief, p.session_notes
     FROM agentsam_plans p
     WHERE p.status = 'active'
       AND (p.workspace_id = ? OR (? IS NOT NULL AND p.tenant_id = ?))
     ORDER BY p.plan_date DESC, p.title ASC`,
  )
    .bind(workspaceId, tenantId, tenantId)
    .all();

  const out = [];
  for (const plan of plans || []) {
    out.push(await attachLivePlanCounts(db, plan));
  }
  return out;
}

async function handleDayBundle(request, url, env, authUser) {
  const workspaceId = resolveWorkspaceId(authUser, env, url);
  const tenantId = resolveTenantId(authUser, env);
  if (!workspaceId) return jsonResponse({ error: 'no_workspace' }, 403);
  if (!tenantId) return jsonResponse({ error: 'tenant_required' }, 403);

  const dateStr = normalizeDateParam(url.searchParams.get('date'));
  if (!dateStr) return jsonResponse({ error: 'date required (YYYY-MM-DD)' }, 400);

  const { limit, slim } = parseDaySourceFilter(url);

  if (slim) {
    const [focus_plans, kanban_due] = await Promise.all([
      fetchFocusPlans(env.DB, workspaceId, tenantId, dateStr),
      fetchKanbanDueOnDay(env.DB, tenantId, dateStr),
    ]);
    const execution_queue = buildExecutionQueue(kanban_due, focus_plans, dateStr, limit);
    return jsonResponse({
      ok: true,
      date: dateStr,
      focus_plans,
      kanban_due,
      execution_queue,
    });
  }

  const [events, focus_plans, plan_tasks, todos, kanban_due, active_plans] = await Promise.all([
    fetchDayEvents(env.DB, workspaceId, dateStr),
    fetchFocusPlans(env.DB, workspaceId, tenantId, dateStr),
    fetchOpenPlanTasks(env.DB, workspaceId, tenantId),
    fetchOpenTodos(env.DB, workspaceId, tenantId),
    fetchKanbanDueOnDay(env.DB, tenantId, dateStr),
    fetchActivePlansWithTasks(env.DB, workspaceId, tenantId),
  ]);

  return jsonResponse({
    ok: true,
    date: dateStr,
    events,
    focus_plans,
    plan_tasks,
    todos,
    kanban_due,
    active_plans,
  });
}

async function handlePlanTaskPatch(request, env, authUser, taskId) {
  const workspaceId = resolveWorkspaceId(authUser, env, new URL(request.url));
  const tenantId = resolveTenantId(authUser, env);
  if (!workspaceId) return jsonResponse({ error: 'no_workspace' }, 403);

  const body = await request.json().catch(() => ({}));
  const status = body?.status != null ? String(body.status).trim() : 'done';
  if (!status) return jsonResponse({ error: 'status required' }, 400);

  const row = await env.DB.prepare(
    `SELECT id, plan_id, status, todo_id FROM agentsam_plan_tasks
     WHERE id = ?
       AND (workspace_id = ? OR (? IS NOT NULL AND tenant_id = ?))
     LIMIT 1`,
  )
    .bind(taskId, workspaceId, tenantId, tenantId)
    .first();

  if (!row) return jsonResponse({ error: 'not_found' }, 404);

  const completedAt = status === 'done' ? Math.floor(Date.now() / 1000) : null;
  await env.DB.prepare(
    `UPDATE agentsam_plan_tasks
     SET status = ?,
         completed_at = COALESCE(?, completed_at)
     WHERE id = ?`,
  )
    .bind(status, completedAt, taskId)
    .run();

  if (row.todo_id && status === 'done') {
    await env.DB.prepare(
      `UPDATE agentsam_todo
       SET status = 'done',
           execution_status = 'done',
           completed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(row.todo_id)
      .run();
  }

  return jsonResponse({ ok: true, id: taskId, status });
}

async function handleTodoPatch(request, env, authUser, todoId) {
  const workspaceId = resolveWorkspaceId(authUser, env, new URL(request.url));
  const tenantId = resolveTenantId(authUser, env);
  if (!workspaceId) return jsonResponse({ error: 'no_workspace' }, 403);

  const body = await request.json().catch(() => ({}));
  const status = body?.status != null ? String(body.status).trim() : 'done';
  if (!status) return jsonResponse({ error: 'status required' }, 400);

  const row = await env.DB.prepare(
    `SELECT id FROM agentsam_todo
     WHERE id = ?
       AND (workspace_id = ? OR (? IS NOT NULL AND tenant_id = ?))
     LIMIT 1`,
  )
    .bind(todoId, workspaceId, tenantId, tenantId)
    .first();

  if (!row) return jsonResponse({ error: 'not_found' }, 404);

  const executionStatus = status === 'done' ? 'done' : (body?.execution_status ? String(body.execution_status) : null);
  await env.DB.prepare(
    `UPDATE agentsam_todo
     SET status = ?,
         execution_status = COALESCE(?, execution_status),
         completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE completed_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(status, executionStatus, status, todoId)
    .run();

  return jsonResponse({ ok: true, id: todoId, status });
}

export async function handleOpsDeskApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const sub = pathLower.slice('/api/ops-desk'.length).replace(/^\//, '');

  if (sub === 'day' && method === 'GET') {
    return handleDayBundle(request, url, env, authUser);
  }

  const taskMatch = sub.match(/^plan-tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    return handlePlanTaskPatch(request, env, authUser, taskMatch[1]);
  }

  const todoMatch = sub.match(/^todos\/([^/]+)$/);
  if (todoMatch && method === 'PATCH') {
    return handleTodoPatch(request, env, authUser, todoMatch[1]);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
