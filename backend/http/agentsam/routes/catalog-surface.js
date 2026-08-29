/**
 * Catalog / picker surface routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_43ac75f20fe24f33
 * Families: quickstart/templates, catalog-invoke, subagent-profiles, tools,
 *           models, modes, commands, session/mode
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import {
  authUserFromRequest,
  fetchAuthUserTenantId,
  resolveRequestContext,
} from '../../../identity/index.js';
import { listPlatformQuickstartTemplates } from './quickstart.js';
import { listAgentsamSlashCommands } from '../../../agentsam/catalog/commands.js';
import { listAgentModels } from '../../../agentsam/catalog/models.js';

export async function handleAgentCatalogSurfaceApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  // GET /api/agent/quickstart/templates — platform-global subagent gallery (D1-driven)
  if (path === '/api/agent/quickstart/templates' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const { templates, source } = await listPlatformQuickstartTemplates(env);
    return jsonResponse({
      ok: true,
      source,
      count: templates.length,
      templates,
    });
  }

  // POST /api/agent/catalog-invoke — same dispatch path as /api/mcp/catalog-invoke
  if (path === '/api/agent/catalog-invoke' && method === 'POST') {
    const { handleCatalogInvokeApi } = await import('./catalog-invoke-handler.js');
    return handleCatalogInvokeApi(request, env, ctx);
  }

  if (path === '/api/agent/subagent-profiles' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const reqCtx = await resolveRequestContext(request, env);
    if (reqCtx.error || !reqCtx.workspaceId) {
      return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
    }
    const effectiveWs = String(reqCtx.workspaceId).trim();
    const uid = String(authUser.id || '').trim();
    let tid =
      identity?.tenantId != null && String(identity.tenantId).trim() !== ''
        ? String(identity.tenantId).trim()
        : authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : '';
    if (!tid) tid = await fetchAuthUserTenantId(env, uid);
    const personUuid =
      identity?.personUuid != null && String(identity.personUuid).trim() !== ''
        ? String(identity.personUuid).trim()
        : authUser.person_uuid != null && String(authUser.person_uuid).trim() !== ''
          ? String(authUser.person_uuid).trim()
          : '';
    const scopedSql = `
      SELECT id, slug, display_name,
             COALESCE(description, '') AS description,
             COALESCE(icon, '') AS icon,
             COALESCE(agent_type, 'custom') AS agent_type,
             default_model_id, is_active,
             COALESCE(sort_order, 0) AS sort_order,
             COALESCE(sandbox_mode, '') AS sandbox_mode,
             mcp_servers_json, modes_json, tool_invocation_style,
             instructions_markdown, allowed_tool_globs, user_id, workspace_id,
             tenant_id, person_uuid
        FROM agentsam_subagent_profile
       WHERE is_active = 1
         AND (
              (user_id = ? AND (workspace_id = ? OR workspace_id = ''))
           OR (tenant_id IS NOT NULL AND tenant_id != '' AND tenant_id = ? AND (workspace_id = ? OR workspace_id = ''))
           OR (person_uuid IS NOT NULL AND person_uuid != '' AND person_uuid = ?)
         )
       ORDER BY sort_order ASC`;

    let rows = [];
    try {
      const q = await env.DB.prepare(scopedSql)
        .bind(uid, effectiveWs, tid, effectiveWs, personUuid)
        .all();
      rows = q.results || [];
    } catch (e) {
      console.warn('[subagent-profiles] scoped query failed, falling back', e?.message ?? e);
      const fb = await env.DB.prepare(
        `SELECT * FROM agentsam_subagent_profile
         WHERE is_active = 1 AND user_id = ? AND (workspace_id = ? OR workspace_id = '')
         ORDER BY COALESCE(sort_order, 9999) ASC`,
      )
        .bind(uid, effectiveWs)
        .all()
        .catch(() => ({ results: [] }));
      rows = fb.results || [];
    }

    try {
      const q2 = await env.DB.prepare(
        `SELECT id, slug, display_name,
                COALESCE(description, '') AS description,
                COALESCE(icon, '') AS icon,
                COALESCE(agent_type, 'custom') AS agent_type,
                default_model_id, is_active,
                COALESCE(sort_order, 0) AS sort_order,
                COALESCE(sandbox_mode, '') AS sandbox_mode,
                mcp_servers_json, modes_json, tool_invocation_style,
                instructions_markdown, allowed_tool_globs, user_id, workspace_id,
                tenant_id, person_uuid, COALESCE(is_platform_global, 0) AS is_platform_global
           FROM agentsam_subagent_profile
          WHERE is_active = 1 AND COALESCE(is_platform_global, 0) = 1
            AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
            AND (? = 1)`,
      )
        .bind(tid, 0)
        .all();
      const extra = q2.results || [];
      const seen = new Set(rows.map((r) => r.id));
      for (const r of extra) {
        if (r?.id && !seen.has(r.id)) {
          seen.add(r.id);
          rows.push(r);
        }
      }
    } catch (_) {
      /* is_platform_global not migrated yet */
    }
    return jsonResponse(rows);
  }

  // GET /api/agent/tools — thin authenticated mirror of session profile menu or find_tools.
  // Never dumps the full agentsam_tools catalog. Query params:
  //   ?mode=agent|ask|plan|…     → profile tools (default; soft-capped by profile max_tools)
  //   ?q=… / ?query=… [&limit]   → find_tools keyword discovery (capped ≤40)
  if (path === '/api/agent/tools' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const q = String(url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    const modeRaw = String(url.searchParams.get('mode') || 'agent').trim().toLowerCase() || 'agent';
    const limitParam = Number(url.searchParams.get('limit'));
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 24, 40),
    );

    const reqCtx = await resolveRequestContext(request, env).catch(() => ({ error: 'unauthenticated' }));
    const workspaceId =
      !reqCtx.error && reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';

    if (q) {
      const { routeExecuteFindToolsMetaTool: executeFindToolsMetaTool } = await import('./route-catalog-runtime.js');
      const out = await executeFindToolsMetaTool(
        env,
        { query: q, mode: modeRaw, workspace_id: workspaceId || undefined, limit },
        {
          workspaceId: workspaceId || undefined,
          workspace_id: workspaceId || undefined,
          userId: authUser.id,
        },
      );
      if (!out?.ok) {
        return jsonResponse({ error: out?.error || 'find_tools_failed', source: 'find_tools' }, 500);
      }
      const result = out.result || {};
      const tools = Array.isArray(result.tools) ? result.tools : [];
      return jsonResponse({
        source: 'find_tools',
        mode: modeRaw,
        query: q,
        workspace_id: workspaceId || null,
        tools,
        total: tools.length,
        top_scores: Array.isArray(result.top_scores) ? result.top_scores : [],
      });
    }

    const { routeNormalizeAgentRuntimeMode: normalizeAgentRuntimeMode } = await import('./route-catalog-runtime.js');
    const mode = normalizeAgentRuntimeMode(modeRaw);
    const { loadOauthVisibleToolsForSession } = await import('../../../agentsam/sessions/session-context.js');
    const packed = await loadOauthVisibleToolsForSession(env, mode);
    const tools = (packed.tools || []).map((t) => ({
      name: t.name,
      tool_key: t.tool_key,
      description: t.description,
      category: t.tool_category ?? null,
      handler_type: t.handler_type ?? null,
      risk_level: t.risk_level ?? null,
      requires_approval: !!t.requires_approval,
      input_schema: t.input_schema ?? null,
    }));
    return jsonResponse({
      source: 'profile',
      mode: packed.profile_task_type || mode,
      profile_key: packed.profile_key,
      query: null,
      tools,
      total: tools.length,
    });
  }

  // ── /api/agent/models — compatibility read over backend/agentsam/catalog
  if (path === '/api/agent/models') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    if (method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    let tenantForModels =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantForModels && authUser.id) tenantForModels = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantForModels && authUser.email) tenantForModels = await fetchAuthUserTenantId(env, authUser.email);
    if (!tenantForModels) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);

    try {
      const rows = await listAgentModels(env, {
        showInPicker: url.searchParams.get('show_in_picker') === '1',
      });
      return jsonResponse(rows);
    } catch (e) {
      return jsonResponse({ error: e?.message }, 500);
    }
  }

  // ── /api/agent/modes ──────────────────────────────────────────────────────
  if (path === '/api/agent/modes' && method === 'GET') {
    const { routeListAgentModesForApi: listAgentModesForApi } = await import('./route-catalog-runtime.js');
    return jsonResponse(listAgentModesForApi());
  }

  // ── /api/agent/commands/execute — slash palette dispatch (command_run + use_count)
  if (path === '/api/agent/commands/execute' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const slug = String(body.slug ?? body.command_slug ?? '').trim();
    const commandId = String(body.command_id ?? body.commandId ?? '').trim();
    if (!slug && !commandId) {
      return jsonResponse({ error: 'slug_or_command_id_required' }, 400);
    }
    const reqCtx = await resolveRequestContext(request, env);
    if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
    const workspaceId = reqCtx.workspaceId != null ? String(reqCtx.workspaceId).trim() : '';
    if (!workspaceId) return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
    let tenantId =
      reqCtx.tenantId != null && String(reqCtx.tenantId).trim() !== ''
        ? String(reqCtx.tenantId).trim()
        : authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    let cmdRow = null;
    if (commandId) {
      cmdRow = await env.DB.prepare(
        `SELECT * FROM agentsam_commands WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      )
        .bind(commandId)
        .first();
    } else {
      cmdRow = await env.DB.prepare(
        `SELECT * FROM agentsam_commands WHERE slug = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      )
        .bind(slug.startsWith('/') ? slug : `/${slug}`)
        .first();
      if (!cmdRow) {
        cmdRow = await env.DB.prepare(
          `SELECT * FROM agentsam_commands WHERE slug = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
        )
          .bind(slug.replace(/^\//, ''))
          .first();
      }
    }
    if (!cmdRow?.id) return jsonResponse({ error: 'command_not_found' }, 404);
    const { routeExecuteCommand: executeCommand } = await import('./route-catalog-runtime.js');
    const cmdArgs = body.args && typeof body.args === 'object' ? { ...body.args } : {};
    if (Array.isArray(body.messages)) cmdArgs.messages = body.messages;
    const out = await executeCommand(env, ctx, {
      commandId: String(cmdRow.id),
      userId: authUser.id,
      tenantId,
      workspaceId,
      sessionId: body.session_id ?? body.conversation_id ?? body.sessionId ?? null,
      agentRunId: body.agent_run_id ?? body.agentRunId ?? null,
      args: cmdArgs,
      taskType: body.task_type ?? cmdRow.task_type ?? null,
      skipApprovalGate: body.skip_approval === true,
    });
    return jsonResponse(out, out?.ok ? 200 : out?.error === 'pending_approval' ? 202 : 400);
  }

  // ── /api/agent/commands — agentsam_commands (show_in_slash); legacy agentsam_slash_commands retired
  if (path === '/api/agent/commands' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
      let tenantId =
        authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId && authUser?.id) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId && authUser?.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
      const reqCtx = authUser ? await resolveRequestContext(request, env) : { error: 'unauthenticated' };
      const results = await listAgentsamSlashCommands(env.DB, {
        tenantId,
        workspaceId: reqCtx.error ? null : (reqCtx.workspaceId ?? null),
        limit: 200,
      });
      return jsonResponse(results || []);
    } catch (e) { return jsonResponse({ error: e?.message }, 500); }
  }

  // ── /api/agent/session/mode ───────────────────────────────────────────────
  if (path === '/api/agent/session/mode' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body           = await request.json().catch(() => ({}));
    const mode           = String(body.mode || '').toLowerCase().trim();
    const conversationId = String(body.conversation_id || body.session_id || '');
    if (!conversationId) return jsonResponse({ error: 'conversation_id required' }, 400);
    if (!env.SESSION_CACHE) return jsonResponse({ error: 'SESSION_CACHE not configured' }, 503);
    await env.SESSION_CACHE.put(`session_mode:${conversationId}`, JSON.stringify({ mode, updated_at: Date.now() }), { expirationTtl: 86400 * 14 });
    return jsonResponse({ mode, persisted: true });
  }

  return null;
}
