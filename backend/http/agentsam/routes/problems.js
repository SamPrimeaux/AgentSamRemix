/**
 * Problems API — agentsam_error_log is SSOT (read + dismiss).
 * No overlays from tool_call_log, hook_execution, mcp, or worker_analytics_errors.
 *
 * CRUD:
 *   GET    /api/agent/problems          — Read
 *   POST   /api/agent/problems          — Create
 *   PATCH  /api/agent/problems          — Update (by id)
 *   POST   /api/agent/problems/resolve  — Delete (dismiss = DELETE row)
 *
 * @returns {Promise<Response|null>}
 */
import { jsonResponse } from '../shared.js';
import {
  authUserFromRequest,
  resolveRequestContext,
} from '../../../identity/index.js';

function workspaceFromRequest(request, url, env, bodyWs) {
  const urlWs = url?.searchParams?.get?.('workspace_id');
  const headerWs =
    request.headers.get('X-IAM-Workspace-Id') ||
    request.headers.get('x-iam-workspace-id');
  const override =
    (bodyWs != null && String(bodyWs).trim()) ||
    (urlWs != null && String(urlWs).trim()) ||
    (headerWs != null && String(headerWs).trim()) ||
    null;
  return resolveRequestContext(request, env, {
    workspaceIdOverride: override,
  });
}

export async function handleAgentProblemsApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  // ── Read: GET /api/agent/problems ─────────────────────────────────────────
  if (path === '/api/agent/problems' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const checkedAt = new Date().toISOString();
    let agentsam_error_log = [];

    try {
      const reqCtx = await workspaceFromRequest(request, url, env, null);
      const wid = !reqCtx.error && reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';
      if (wid) {
        const q = await env.DB.prepare(
          `SELECT id, workspace_id, tenant_id, session_id, error_code, error_type, error_message,
                  source, source_id, context_json, stack_trace, resolved, created_at
           FROM agentsam_error_log
           WHERE workspace_id = ? AND COALESCE(resolved, 0) = 0
           ORDER BY created_at DESC LIMIT 50`,
        )
          .bind(wid)
          .all();
        const { routeFilterErrorLogForProblemsSurface: filterErrorLogForProblemsSurface } = await import('./route-problem-runtime.js');
        agentsam_error_log = filterErrorLogForProblemsSurface(q.results || [], { surface: 'terminal' });
      }
    } catch (_) {}

    return jsonResponse({
      checked_at: checkedAt,
      agentsam_error_log,
    });
  }

  // ── Create: POST /api/agent/problems ──────────────────────────────────────
  if (path === '/api/agent/problems' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const body = await request.json().catch(() => ({}));
    const reqCtx = await workspaceFromRequest(request, url, env, body.workspace_id);
    if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
    const wid = reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';
    const tid = reqCtx.tenantId != null ? String(reqCtx.tenantId).trim() : '';
    if (!wid) return jsonResponse({ error: 'workspace_id required' }, 400);
    if (!tid) return jsonResponse({ error: 'tenant_id required' }, 400);

    const errorType = String(body.error_type || body.type || 'error').trim().slice(0, 120) || 'error';
    const errorMessage = String(body.error_message || body.message || '').trim().slice(0, 4000);
    const source = String(body.source || 'manual').trim().slice(0, 120) || 'manual';
    if (!errorMessage) return jsonResponse({ error: 'error_message required' }, 400);

    const id =
      body.id != null && String(body.id).trim()
        ? String(body.id).trim().slice(0, 64)
        : `err_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_error_log (
           id, workspace_id, tenant_id, session_id, error_code, error_type, error_message,
           source, source_id, context_json, stack_trace, resolved, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch())`,
      )
        .bind(
          id,
          wid,
          tid,
          body.session_id != null ? String(body.session_id).trim().slice(0, 120) : null,
          body.error_code != null ? String(body.error_code).trim().slice(0, 120) : null,
          errorType,
          errorMessage,
          source,
          body.source_id != null ? String(body.source_id).trim().slice(0, 120) : null,
          body.context_json != null
            ? typeof body.context_json === 'string'
              ? body.context_json
              : JSON.stringify(body.context_json)
            : '{}',
          body.stack_trace != null ? String(body.stack_trace).slice(0, 8000) : null,
        )
        .run();
    } catch (e) {
      return jsonResponse({ error: e?.message || 'create_failed' }, 500);
    }

    return jsonResponse({ ok: true, id, workspace_id: wid }, 201);
  }

  // ── Update: PATCH /api/agent/problems ─────────────────────────────────────
  if (path === '/api/agent/problems' && method === 'PATCH') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const body = await request.json().catch(() => ({}));
    const id = body.id != null ? String(body.id).trim() : '';
    if (!id) return jsonResponse({ error: 'id required' }, 400);

    const reqCtx = await workspaceFromRequest(request, url, env, body.workspace_id);
    if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
    const wid = reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';
    if (!wid) return jsonResponse({ error: 'workspace_id required' }, 400);

    const sets = [];
    const binds = [];
    if (body.error_type != null) {
      sets.push('error_type = ?');
      binds.push(String(body.error_type).trim().slice(0, 120));
    }
    if (body.error_message != null) {
      sets.push('error_message = ?');
      binds.push(String(body.error_message).trim().slice(0, 4000));
    }
    if (body.error_code != null) {
      sets.push('error_code = ?');
      binds.push(String(body.error_code).trim().slice(0, 120));
    }
    if (body.source != null) {
      sets.push('source = ?');
      binds.push(String(body.source).trim().slice(0, 120));
    }
    if (body.context_json != null) {
      sets.push('context_json = ?');
      binds.push(
        typeof body.context_json === 'string'
          ? body.context_json
          : JSON.stringify(body.context_json),
      );
    }
    if (!sets.length) return jsonResponse({ error: 'no fields to update' }, 400);

    binds.push(id, wid);
    try {
      const q = await env.DB.prepare(
        `UPDATE agentsam_error_log SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
      )
        .bind(...binds)
        .run();
      const changes = Number(q.meta?.changes) || 0;
      if (!changes) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ ok: true, id, updated: changes, workspace_id: wid });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'update_failed' }, 500);
    }
  }

  // ── Delete (dismiss): POST /api/agent/problems/resolve ────────────────────
  if (path === '/api/agent/problems/resolve' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const body = await request.json().catch(() => ({}));
    const reqCtx = await workspaceFromRequest(request, url, env, body.workspace_id);
    if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
    const wid = reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';
    if (!wid) return jsonResponse({ error: 'workspace_id required' }, 400);

    const ids = [];
    if (Array.isArray(body.ids)) {
      for (const raw of body.ids) {
        const id = raw != null ? String(raw).trim() : '';
        if (id) ids.push(id.slice(0, 120));
      }
    } else if (body.id != null && String(body.id).trim() !== '') {
      ids.push(String(body.id).trim().slice(0, 120));
    }

    const olderThanDays = Number(body.older_than_days);
    const bulkByAge = Number.isFinite(olderThanDays) && olderThanDays > 0;
    const resolveAll = body.resolve_all === true || body.resolve_all === 1 || body.resolve_all === '1';
    if (!ids.length && !bulkByAge && !resolveAll) {
      return jsonResponse({ error: 'id, ids, older_than_days, or resolve_all required' }, 400);
    }

    // Dismiss = DELETE agentsam_error_log only.
    let deletedCount = 0;
    try {
      if (resolveAll) {
        const q = await env.DB.prepare(`DELETE FROM agentsam_error_log WHERE workspace_id = ?`)
          .bind(wid)
          .run();
        deletedCount = Number(q.meta?.changes) || 0;
      } else if (bulkByAge) {
        const cutoff = Math.floor(Date.now() / 1000) - Math.floor(olderThanDays) * 86400;
        const q = await env.DB.prepare(
          `DELETE FROM agentsam_error_log WHERE workspace_id = ? AND created_at < ?`,
        )
          .bind(wid, cutoff)
          .run();
        deletedCount = Number(q.meta?.changes) || 0;
      }
      for (const id of ids.slice(0, 100)) {
        const q = await env.DB.prepare(
          `DELETE FROM agentsam_error_log WHERE id = ? AND workspace_id = ?`,
        )
          .bind(id, wid)
          .run();
        deletedCount += Number(q.meta?.changes) || 0;
      }
    } catch (e) {
      return jsonResponse({ error: e?.message || 'delete_failed' }, 500);
    }

    if (!deletedCount) {
      return jsonResponse({ ok: false, error: 'not_found', deleted_count: 0, workspace_id: wid }, 404);
    }

    return jsonResponse({
      ok: true,
      deleted_count: deletedCount,
      workspace_id: wid,
    });
  }

  return null;
}
