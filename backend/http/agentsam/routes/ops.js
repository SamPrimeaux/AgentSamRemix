/**
 * Ops / health / routing / compat routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_43ac75f20fe24f33
 * Families: health, alignment-sync, retired db/*, pty/health, conversations/search,
 *           rag/query, workers-ai/image, telemetry, cicd, mcp, routing/*
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import { authUserFromRequest, fetchAuthUserTenantId, resolveCanonicalUserId } from '../../../identity/index.js';
import { verifyBridgeKey } from '../../../auth/bridge-key-auth.js';
import {
  routePingPtyServiceHealth as pingPtyServiceHealth,
  routeIsEtoThompsonOwner as isEtoThompsonOwner,
  routeApplyEtoToRoutingArms as applyEtoToRoutingArms,
  routeDispatchSemanticRetrieval as dispatchSemanticRetrieval,
  routeResolveWorkersAiImageModelFromCatalog as resolveWorkersAiImageModelFromCatalog,
  routeExtractWorkersAiImageBytes as extractWorkersAiImageBytes,
} from './route-ops-runtime.js';

export async function handleAgentOpsApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  // GET /api/agent/health — first thing Agent Sam queries on session start
  if (path === '/api/agent/health' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const { results } = await env.DB.prepare(
      `SELECT component, status, last_checked_at, last_healthy_at,
              error_message, metadata_json
       FROM iam_system_health
       ORDER BY status DESC, component ASC`
    ).all();
    const down = (results || []).filter((r) => r.status === 'down').length;
    const degraded = (results || []).filter((r) => r.status === 'degraded').length;
    return jsonResponse({
      overall: down > 0 ? 'down' : degraded > 0 ? 'degraded' : 'healthy',
      components: results || [],
      queried_at: new Date().toISOString()
    });
  }

  // ── /api/agent/alignment-sync — alignment execution + agentsam_memory ──
  if (path === '/api/agent/alignment-sync' && method === 'POST') {
    if (!identity?.userId || !identity?.tenantId || !identity?.workspaceId) {
      return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
    }
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const { recordAlignmentSnapshot } = await import('../../../agentsam/alignment/snapshot.js');
    const out = await recordAlignmentSnapshot(env, ctx, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      sessionId: body.session_id ?? body.sessionId ?? null,
      todoId: body.todo_id ?? body.todoId ?? null,
      planTaskId: body.plan_task_id ?? body.planTaskId ?? null,
      planId: body.plan_id ?? body.planId ?? null,
      summary: body.summary != null ? String(body.summary) : '',
      filesChanged: Array.isArray(body.files_changed)
        ? body.files_changed
        : Array.isArray(body.filesChanged)
          ? body.filesChanged
          : [],
      memory: body.memory !== false,
    });
    if (!out.ok) return jsonResponse(out, 400);
    return jsonResponse(out);
  }

  // ── /api/agent/db/* — retired (unscoped platform D1 leak for any authed caller)
  // Canonical Studio: GET /api/d1/tables (+ query/row APIs) via requireScopedD1.
  if (
    path === '/api/agent/db/tables' ||
    path === '/api/agent/db/query-history' ||
    path === '/api/agent/db/snippets'
  ) {
    return jsonResponse(
      {
        error: 'gone',
        message:
          'Use /api/d1/* (scoped via requireScopedD1). This agent path always queried platform env.DB for every caller and is removed.',
        use: '/api/d1/tables',
      },
      410,
    );
  }

  // ── GET /api/agent/pty/health ─────────────────────────────────────────────
  if (path === '/api/agent/pty/health' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    return jsonResponse(await pingPtyServiceHealth(env));
  }

  // Agent startup is owned by GET /api/agent/bootstrap in backend/http/agentsam/bootstrap.js.

  // ── /api/agent/conversations/search ──────────────────────────────────────
  if (path === '/api/agent/conversations/search' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const userId = await resolveCanonicalUserId(String(authUser.id || ''), env);
    if (!userId) return jsonResponse({ error: 'auth_user_id_required' }, 401);
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
    if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return jsonResponse([]);
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const { results } = await env.DB.prepare(
      `SELECT conversation_id AS id, COALESCE(title, '') AS title
       FROM agentsam_chat_sessions
       WHERE user_id = ? AND tenant_id = ?
         AND COALESCE(is_archived, 0) = 0
         AND title LIKE ? ESCAPE '\\'
       ORDER BY COALESCE(last_turn_at, updated_at) DESC
       LIMIT 20`,
    )
      .bind(userId, tenantId, like)
      .all();
    return jsonResponse(
      (results || []).map((r) => ({
        id: r.id,
        title: r.title && String(r.title).trim() ? String(r.title).trim() : 'New Conversation',
      })),
    );
  }

  // ── /api/agent/rag/query (compat → semantic-retrieval-dispatch) ────────────
  if (path === '/api/agent/rag/query' && method === 'POST') {
    const body  = await request.json().catch(() => ({}));
    const query = (body.query || body.q || '').trim();
    if (!query) return jsonResponse({ error: 'query required', matches: [], results: [], count: 0 }, 400);
    const workspaceId = identity?.workspaceId ?? null;
    if (!workspaceId) {
      return jsonResponse({ error: 'workspace_id_required', matches: [], results: [], count: 0 }, 400);
    }
    const lane = String(body.lane || 'docs').trim() || 'docs';
    const out = await dispatchSemanticRetrieval(env, {
      lane,
      query,
      workspace_id: workspaceId,
      tenant_id: identity?.tenantId ?? null,
      user_id: identity?.userId ?? null,
      top_k: body.top_k || 8,
    });
    const hits = Array.isArray(out?.results) ? out.results : [];
    if (out?.ok === false) {
      return jsonResponse(
        {
          error: out.error || 'semantic_retrieval_failed',
          lane: out.lane || lane,
          matches: [],
          results: [],
          count: 0,
        },
        503,
      );
    }
    return jsonResponse({
      lane: out.lane || lane,
      matches: hits.map((h) => String(h.content || h.title || '').trim()).filter(Boolean),
      results: hits,
      count: hits.length,
    });
  }

  // ── /api/agent/workers-ai/image ───────────────────────────────────────────
  if (path === '/api/agent/workers-ai/image' && method === 'POST') {
    if (!env.AI) return jsonResponse({ error: 'Workers AI not configured' }, 503);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    if (!identity?.tenantId) return jsonResponse({ error: 'unauthenticated' }, 401);
    const body   = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);
    const requestedModel =
      body.model_key != null
        ? String(body.model_key).trim()
        : body.model != null
          ? String(body.model).trim()
          : '';
    const catalogModel = await resolveWorkersAiImageModelFromCatalog(env, {
      modelKey: requestedModel || null,
    });
    if (!catalogModel) {
      return jsonResponse(
        {
          error: requestedModel
            ? 'workers_ai_image_model_not_in_catalog'
            : 'No active Workers AI image model in agentsam_model_catalog',
          model_key: requestedModel || null,
        },
        503,
      );
    }
    try {
      const result = await env.AI.run(catalogModel.provider_model_id, { prompt });
      const { bytes, contentType } = await extractWorkersAiImageBytes(result, {
        fallbackContentType: 'image/jpeg',
      });
      return new Response(bytes, {
        headers: {
          'Content-Type': contentType,
          'X-IAM-Model-Key': catalogModel.model_key,
        },
      });
    } catch (e) { return jsonResponse({ error: e?.message }, 500); }
  }

  // ── /api/agent/telemetry ──────────────────────────────────────────────────
  if (path === '/api/agent/telemetry') {
    if (!env.DB) return jsonResponse([]);
    const { results } = await env.DB.prepare(`SELECT provider, SUM(tokens_in) as total_input, SUM(tokens_out) as total_output, COUNT(*) as total_calls FROM agentsam_usage_events WHERE created_at > unixepoch('now','-7 days') GROUP BY provider`).all().catch(() => ({ results: [] }));
    return jsonResponse(results || []);
  }

  // ── /api/agent/cicd ───────────────────────────────────────────────────────
  if (path === '/api/agent/cicd') {
    if (!env.DB) return jsonResponse([]);
    const { results } = await env.DB.prepare(`SELECT r.id, r.worker_name, r.environment, r.status, r.git_branch, r.git_commit_sha, r.queued_at, r.completed_at, COUNT(e.id) AS activity_count FROM cicd_runs r LEFT JOIN cicd_events e ON e.webhook_event_id = r.id GROUP BY r.id ORDER BY r.queued_at DESC LIMIT 50`).all().catch(() => ({ results: [] }));
    return jsonResponse(results || []);
  }

  // ── /api/agent/mcp ────────────────────────────────────────────────────────
  if (path === '/api/agent/mcp') {
    if (!env.DB) return jsonResponse([]);
    const { results } = await env.DB.prepare(`SELECT id, service_name, service_type, endpoint_url, is_active, health_status FROM mcp_services WHERE is_active=1 ORDER BY service_name`).all().catch(() => ({ results: [] }));
    return jsonResponse(results || []);
  }

  // ── GET /api/agent/routing/recent — last N intent/routing decisions (D1 ground truth) ──
  if (path === '/api/agent/routing/recent' && method === 'GET') {
    if (!identity?.userId) return jsonResponse({ error: 'unauthenticated' }, 401);
    if (!env?.DB) return jsonResponse({ error: 'D1 unavailable' }, 503);
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') || 12);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 12, 1), 40);
    const workspaceId =
      String(url.searchParams.get('workspace_id') || identity.workspaceId || '').trim() || null;
    const scopeUser = String(identity.userId).trim();
    try {
      let rows = [];
      if (workspaceId) {
        const { results } = await env.DB.prepare(
          `SELECT id, tenant_id, workspace_id, user_id, conversation_id, task_type,
                  message_excerpt, matched_by, is_match, confidence, model_key, provider,
                  routing_arm_id, reason, latency_ms, created_at
           FROM agentsam_intent_decisions
           WHERE workspace_id = ? AND user_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
          .bind(workspaceId, scopeUser, limit)
          .all();
        rows = results || [];
      } else {
        const { results } = await env.DB.prepare(
          `SELECT id, tenant_id, workspace_id, user_id, conversation_id, task_type,
                  message_excerpt, matched_by, is_match, confidence, model_key, provider,
                  routing_arm_id, reason, latency_ms, created_at
           FROM agentsam_intent_decisions
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
          .bind(scopeUser, limit)
          .all();
        rows = results || [];
      }
      return jsonResponse({
        ok: true,
        count: rows.length,
        decisions: rows.map((r) => ({
          id: r.id,
          task_type: r.task_type,
          matched_by: r.matched_by,
          is_match: Number(r.is_match) === 1,
          confidence: r.confidence,
          model_key: r.model_key,
          provider: r.provider,
          routing_arm_id: r.routing_arm_id,
          reason: r.reason,
          message_excerpt: r.message_excerpt,
          latency_ms: r.latency_ms,
          conversation_id: r.conversation_id,
          workspace_id: r.workspace_id,
          created_at: r.created_at,
        })),
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  // ── POST /api/agent/routing/apply-eto — flush pending ETO → Thompson arms (test batches) ──
  if (path === '/api/agent/routing/apply-eto' && method === 'POST') {
    const internal = verifyBridgeKey(request, env);
    if (!internal && !identity?.userId) return jsonResponse({ error: 'unauthenticated' }, 401);
    if (!env?.DB) return jsonResponse({ error: 'D1 unavailable' }, 503);
    const owner = await isEtoThompsonOwner(env);
    if (!owner) return jsonResponse({ error: 'eto_table_missing' }, 503);
    try {
      const applied = await applyEtoToRoutingArms(env, {});
      return jsonResponse({ ok: true, ...applied });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  return null;
}
