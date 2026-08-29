/**
 * Phase 1 leaf routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_agent_js_phase1_leaf_routes_2026_08
 * Families: todo, keyboard-shortcuts, browser/registry-tools, context-picker/catalog
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import { listActiveWorkflowOptions } from '../../../workflows/index.js';
import { authUserFromRequest, fetchAuthUserTenantId } from '../../../identity/index.js';
import { routeResolveAgentDataScope as resolveAgentDataScope } from './route-scope-runtime.js';
import { listAgentsamSlashCommands } from '../../../agentsam/catalog/commands.js';
import { loadAvailableToolsForCapability } from '../../../browser/capture/tool-registry.js';

export async function handleAgentShellCrudApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  // DELETE /api/agent/todo/:id — hard-delete task (scoped to tenant/workspace)
  const todoIdDeleteMatch = path.match(/^\/api\/agent\/todo\/([^/]+)$/);
  if (todoIdDeleteMatch && method === 'DELETE') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const scope = await resolveAgentDataScope(env, authUser, request, {});
    if (!scope.tenantId || !scope.workspaceId) return jsonResponse({ error: 'Tenant/workspace required' }, 403);
    const todoId = String(todoIdDeleteMatch[1]).trim();
    const existing = await env.DB.prepare(
      `SELECT id, title FROM agentsam_todo WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(todoId, scope.tenantId, scope.workspaceId)
      .first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);
    await env.DB.prepare(
      `DELETE FROM agentsam_todo WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
    )
      .bind(todoId, scope.tenantId, scope.workspaceId)
      .run();
    return jsonResponse({ ok: true, deleted: true, id: todoId }, 200);
  }

  // PATCH /api/agent/todo/:id — update task fields
  const todoIdPatchMatch = path.match(/^\/api\/agent\/todo\/([^/]+)$/);
  if (todoIdPatchMatch && method === 'PATCH') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const scope = await resolveAgentDataScope(env, authUser, request, {});
    if (!scope.tenantId || !scope.workspaceId) return jsonResponse({ error: 'Tenant/workspace required' }, 403);
    const todoId = String(todoIdPatchMatch[1]).trim();
    const body = await request.json().catch(() => ({}));
    const existing = await env.DB.prepare(
      `SELECT * FROM agentsam_todo WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(todoId, scope.tenantId, scope.workspaceId)
      .first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);

    const userId = String(authUser.id || authUser.user_id || authUser.email || 'user').slice(0, 64);
    const { logTaskActivity, taskActivityChangesFromPatch } = await import('../../../services/task-activity-log.js');

    const fields = [];
    const binds = [];
    const set = (col, val) => {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        binds.push(val);
      }
    };

    set('title', body.title != null ? String(body.title).trim().slice(0, 500) : undefined);
    set('description', body.description != null ? String(body.description).slice(0, 4000) : undefined);
    set('notes', body.notes != null ? String(body.notes).slice(0, 4000) : undefined);
    set(
      'agent_instructions',
      body.agent_instructions != null ? String(body.agent_instructions).slice(0, 8000) : undefined,
    );
    set('due_date', body.due_date != null ? String(body.due_date).trim().slice(0, 40) : undefined);
    set('category', body.category != null ? String(body.category).trim().slice(0, 120) : undefined);
    set(
      'project_id',
      body.project_id != null ? String(body.project_id).trim().slice(0, 120) || null : undefined,
    );
    set(
      'project_key',
      body.project_key != null ? String(body.project_key).trim().slice(0, 120) || null : undefined,
    );
    set('status', body.status != null ? String(body.status).trim().slice(0, 40) : undefined);
    if (body.status === 'done') {
      set('execution_status', 'done');
      set('completed_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
    } else if (body.status != null && body.status !== 'done') {
      set('execution_status', body.execution_status != null ? String(body.execution_status) : 'queued');
    }
    if (body.starred != null) {
      let tags = [];
      try {
        tags = JSON.parse(existing.tags || '[]');
        if (!Array.isArray(tags)) tags = [];
      } catch {
        tags = [];
      }
      tags = tags.filter((t) => t !== 'starred');
      if (body.starred) tags.push('starred');
      set('tags', JSON.stringify(tags));
    } else if (body.tags != null) {
      set('tags', typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags));
    }

    if (!fields.length) return jsonResponse({ error: 'No fields to update' }, 400);
    fields.push("updated_at = datetime('now')");
    binds.push(todoId, scope.tenantId, scope.workspaceId);
    await env.DB.prepare(
      `UPDATE agentsam_todo SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
    )
      .bind(...binds)
      .run();
    const todo = await env.DB.prepare(`SELECT * FROM agentsam_todo WHERE id = ?`).bind(todoId).first();

    const activityChanges = taskActivityChangesFromPatch(existing, body);
    if (activityChanges) {
      let action = 'updated';
      if (activityChanges.field === 'status') {
        if (body.status === 'done' || body.status === 'completed') action = 'completed';
        else if (body.status === 'in_progress') action = 'started';
        else action = 'updated';
      } else if (activityChanges.field === 'project_id') {
        action = 'project_link';
      }
      await logTaskActivity(env.DB, {
        taskId: todoId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId,
        action,
        changes: activityChanges,
      });
    }

    return jsonResponse({ ok: true, todo }, 200);
  }

  // POST /api/agent/todo — create task
  if (path === '/api/agent/todo' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const scope = await resolveAgentDataScope(env, authUser, request, {});
    if (!scope.tenantId || !scope.workspaceId) return jsonResponse({ error: 'Tenant/workspace required' }, 403);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || '').trim().slice(0, 500);
    if (!title) return jsonResponse({ error: 'title required' }, 400);
    const id = `todo_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userId = String(authUser.id || authUser.user_id || authUser.email || 'user').slice(0, 64);
    const category = String(body.category || 'My Tasks').trim().slice(0, 120) || 'My Tasks';
    const projectId =
      body.project_id != null && String(body.project_id).trim()
        ? String(body.project_id).trim().slice(0, 120)
        : null;
    const projectKey =
      body.project_key != null && String(body.project_key).trim()
        ? String(body.project_key).trim().slice(0, 120)
        : projectId;
    let clientId =
      body.client_id != null && String(body.client_id).trim()
        ? String(body.client_id).trim().slice(0, 120)
        : null;
    if (!clientId && projectId) {
      try {
        const prow = await env.DB.prepare(`SELECT client_id FROM projects WHERE id = ? LIMIT 1`)
          .bind(projectId)
          .first();
        if (prow?.client_id) clientId = String(prow.client_id).trim();
      } catch {
        /* non-fatal */
      }
    }
    const agentInstructions =
      body.agent_instructions != null ? String(body.agent_instructions).slice(0, 8000) : null;
    const tags = body.starred ? JSON.stringify(['starred']) : JSON.stringify(body.tags || []);
    await env.DB.prepare(
      `INSERT INTO agentsam_todo (
        id, tenant_id, workspace_id, title, description, status, priority, category, tags,
        due_date, notes, agent_instructions, created_by, sort_order, task_type, execution_status,
        project_id, project_key, client_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', 'medium', ?, ?, ?, ?, ?, ?, 50, 'execute', 'queued', ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        scope.tenantId,
        scope.workspaceId,
        title,
        body.description != null ? String(body.description).slice(0, 4000) : null,
        category,
        tags,
        body.due_date != null ? String(body.due_date).trim().slice(0, 40) : null,
        body.notes != null ? String(body.notes).slice(0, 4000) : null,
        agentInstructions,
        userId,
        projectId,
        projectKey,
        clientId,
      )
      .run();
    const todo = await env.DB.prepare(`SELECT * FROM agentsam_todo WHERE id = ?`).bind(id).first();
    const { logTaskActivity } = await import('../../../services/task-activity-log.js');
    await logTaskActivity(env.DB, {
      taskId: id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId,
      action: 'created',
      changes: { title, project_id: projectId, category },
    });
    return jsonResponse({ ok: true, todo }, 201);
  }

  // GET /api/agent/todo — multi-tenant agentsam_todo
  if (path === '/api/agent/todo' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const scope = await resolveAgentDataScope(env, authUser, request, {});
    if (!scope.tenantId) return jsonResponse({ error: 'Tenant could not be resolved' }, 403);
    if (!scope.workspaceId) return jsonResponse({ todos: [] });
    const reqUrl = new URL(request.url);
    const projectId = reqUrl.searchParams.get('project_id')?.trim() || null;
    const clientId = reqUrl.searchParams.get('client_id')?.trim() || null;
    const clientWork = reqUrl.searchParams.get('client_work') === '1';
    const category = reqUrl.searchParams.get('category')?.trim() || null;
    const includeLegacy = reqUrl.searchParams.get('include_legacy') === '1';
    try {
      let queryWorkspaceId = scope.workspaceId;
      const projectKeys = new Set();
      if (projectId) {
        const prow = await env.DB.prepare(
          `SELECT id, workspace_id, worker_id FROM projects WHERE id = ? LIMIT 1`,
        )
          .bind(projectId)
          .first();
        if (prow?.workspace_id) queryWorkspaceId = String(prow.workspace_id).trim();
        projectKeys.add(projectId);
        if (prow?.worker_id) projectKeys.add(String(prow.worker_id).trim());
        if (prow?.id) projectKeys.add(String(prow.id).trim());
      } else if (clientId) {
        const cpRow = await env.DB.prepare(
          `SELECT p.id, p.workspace_id, p.worker_id
           FROM client_projects cp
           INNER JOIN projects p ON p.id = cp.project_id
           WHERE cp.client_id = ?
           ORDER BY cp.updated_at DESC
           LIMIT 1`,
        )
          .bind(clientId)
          .first();
        if (cpRow?.workspace_id) queryWorkspaceId = String(cpRow.workspace_id).trim();
        if (cpRow?.id) projectKeys.add(String(cpRow.id).trim());
        if (cpRow?.worker_id) projectKeys.add(String(cpRow.worker_id).trim());
      }

      const binds = [scope.tenantId, queryWorkspaceId];
      let sql = `SELECT * FROM agentsam_todo
         WHERE tenant_id = ? AND workspace_id = ?
           AND (status IS NULL OR LOWER(TRIM(status)) NOT IN ('done', 'completed', 'cancelled'))`;
      if (!includeLegacy) {
        sql += ` AND (
             plan_id IS NULL
             OR plan_id NOT IN (
               SELECT id FROM agentsam_plans
               WHERE LOWER(COALESCE(status, '')) IN ('abandoned', 'archived')
             )
           )`;
      }
      if (projectId) {
        const keys = [...projectKeys];
        if (!keys.includes(projectId)) keys.unshift(projectId);
        const ph = keys.map(() => '?').join(', ');
        sql += ` AND (project_id IN (${ph}) OR project_key IN (${ph}))`;
        binds.push(...keys, ...keys);
      }
      if (clientId) {
        sql += ` AND client_id = ?`;
        binds.push(clientId);
      } else if (clientWork) {
        // External client work only — clients.is_internal (never hardcode platform client ids).
        sql += ` AND client_id IS NOT NULL AND TRIM(client_id) != ''
           AND EXISTS (
             SELECT 1 FROM clients c
             WHERE c.id = agentsam_todo.client_id AND COALESCE(c.is_internal, 0) = 0
           )`;
      }
      if (category) {
        sql += ` AND LOWER(TRIM(COALESCE(category, ''))) = LOWER(TRIM(?))`;
        binds.push(category);
      }
      sql += ` ORDER BY sort_order ASC, created_at DESC`;
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return jsonResponse({ todos: results || [] });
    } catch (e) {
      console.warn('[agent/todo]', e?.message ?? e);
      return jsonResponse({ error: 'Failed to load todos' }, 500);
    }
  }

  // ── /api/agent/keyboard-shortcuts ────────────────────────────────────────
  if (path === '/api/agent/keyboard-shortcuts' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB)   return jsonResponse({ error: 'DB not configured' }, 503);
    const { results } = await env.DB.prepare(`SELECT * FROM keyboard_shortcuts ORDER BY sort_order ASC, id ASC`).all();
    return jsonResponse({ shortcuts: results || [] });
  }

  const kbMatch = path.match(/^\/api\/agent\/keyboard-shortcuts\/([^/]+)$/);
  if (kbMatch && method === 'PATCH') {
    const rowId    = decodeURIComponent(kbMatch[1] || '').trim();
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB)   return jsonResponse({ error: 'DB not configured' }, 503);
    const body    = await request.json().catch(() => ({}));
    const en      = body.is_enabled;
    const turnOn  = en === true || en === 1 || en === '1';
    const turnOff = en === false || en === 0 || en === '0';
    if (!turnOn && !turnOff) return jsonResponse({ error: 'is_enabled required' }, 400);
    const existing = await env.DB.prepare(`SELECT id, is_system FROM keyboard_shortcuts WHERE id = ?`).bind(rowId).first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);
    if (Number(existing.is_system) === 1) return jsonResponse({ error: 'System shortcut cannot be disabled' }, 403);
    await env.DB.prepare(`UPDATE keyboard_shortcuts SET is_enabled = ? WHERE id = ?`).bind(turnOn ? 1 : 0, rowId).run();
    return jsonResponse({ ok: true });
  }

  // ── /api/agent/browser/registry-tools — D1 agentsam_tools for BrowserView / picker ──
  if (path === '/api/agent/browser/registry-tools' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ tools: [], pickers: {} });
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    const workspaceId = String(
      url.searchParams.get('workspace_id') || identity?.workspaceId || '',
    ).trim();
    const userId = String(authUser.id || identity?.userId || '').trim();
    const tools = await loadAvailableToolsForCapability(
      env,
      tenantId || '',
      workspaceId,
      userId,
      'browser',
    );
    const pickers = {
      navigate: ['browser_navigate', 'cdt_navigate_page'],
      content: ['browser_content'],
      console: ['cdt_list_console_messages'],
      network: ['cdt_list_network_requests'],
      snapshot: ['cdt_take_snapshot'],
      screenshot: ['browser_screenshot', 'playwright_screenshot', 'cdt_take_screenshot'],
      evaluate: ['browser_evaluate_script', 'cdt_evaluate_script'],
      hover: ['cdt_hover'],
    };
    const names = new Set(tools.map((t) => String(t.tool_name)));
    const resolved = {};
    for (const [lane, candidates] of Object.entries(pickers)) {
      resolved[lane] = candidates.find((c) => names.has(c)) || null;
    }
    return jsonResponse({ tools, pickers: resolved });
  }

  // ── /api/agent/context-picker/catalog ────────────────────────────────────
  if (path === '/api/agent/context-picker/catalog' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB)   return jsonResponse({ tables: [], workflows: [], commands: [], memory_keys: [], workspaces: [] });
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
    let tables = [], workflows = [], commands = [], memory_keys = [], workspaces = [];
    await Promise.allSettled([
      env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().then(r => { tables = (r.results||[]).map(x=>x.name); }),
      listActiveWorkflowOptions(env.DB, 100).then((rows) => { workflows = rows; }),
      tenantId
        ? listAgentsamSlashCommands(env.DB, { tenantId, limit: 200 }).then((rows) => {
            commands = (rows || []).map((r) => ({
              slug: r.slug,
              name: r.name || r.display_name,
              category: r.category,
            }));
          })
        : Promise.resolve(),
      tenantId ? env.DB.prepare(`SELECT key FROM agentsam_memory WHERE tenant_id = ? ORDER BY COALESCE(importance_score,0) DESC LIMIT 150`).bind(tenantId).all().then(r => { memory_keys = (r.results||[]).map(x=>x.key); }) : Promise.resolve(),
      env.DB.prepare(`SELECT id, name FROM workspaces WHERE id LIKE 'ws_%' ORDER BY name LIMIT 50`).all().then(r => { workspaces = r.results||[]; }),
    ]);
    return jsonResponse({ tables, workflows, commands, memory_keys, workspaces });
  }

  return null;
}
