/**
 * Phase 3b routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_agent_js_phase3b_memory_2026_08
 * Family: /api/agent/memory/*
 *
 * alignment-sync stays in agent.js; chat SSE lives in chat.js (Phase 4).
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import {
  authUserFromRequest,
  fetchAuthUserTenantId,
} from '../../../identity/index.js';
import { userCanAdminWorkspace } from '../../../identity/workspace/authority.js';
import {
  routeHandleAgentMemorySync as handleAgentMemorySync,
  routeInsertCuratedAgentMemory as insertCuratedAgentMemory,
  routeSearchCuratedAgentMemory as searchCuratedAgentMemory,
} from './route-memory-runtime.js';

export async function handleAgentMemoryApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  if (!path.startsWith('/api/agent/memory')) {
    return null;
  }

  // ── /api/agent/memory/list — D1 compatibility (edge cache keys) ─────────
  if (path === '/api/agent/memory/list' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB)   return jsonResponse({ items: [], surface: 'd1_compat' });
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
    if (!tenantId) return jsonResponse({ items: [], surface: 'd1_compat' });
    const surface = String(url.searchParams.get('surface') || 'd1').toLowerCase();
    if (surface === 'private' && identity?.workspaceId && identity?.userId) {
      const { routeSearchPrivateAgentsamMemory: searchPrivateAgentsamMemory } = await import('./route-memory-runtime.js');
      const priv = await searchPrivateAgentsamMemory(env, {
        tenantId,
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        limit: 200,
      });
      return jsonResponse({
        surface: 'private',
        items: (priv.results ?? []).map((r) => ({
          key: r.memory_key,
          memory_type: r.memory_type,
          summary: r.summary,
          importance: r.importance,
          updated_at: r.updated_at,
        })),
      });
    }
    const includeResolved = url.searchParams.get('include_resolved') === '1';
    const activeFilter = includeResolved
      ? '1=1'
      : 'COALESCE(is_archived, 0) = 0 AND COALESCE(is_resolved, 0) = 0';
    const { results } = await env.DB.prepare(
      `SELECT key, memory_type, COALESCE(importance, importance_score, 5) AS importance_score,
              sync_key, COALESCE(is_resolved, 0) AS is_resolved, resolved_at
       FROM agentsam_memory WHERE tenant_id = ? AND ${activeFilter}
       ORDER BY COALESCE(importance, importance_score, 0) DESC LIMIT 200`,
    )
      .bind(tenantId)
      .all()
      .catch(() => ({ results: [] }));
    return jsonResponse({ surface: 'd1_compat', items: (results || []).filter((r) => r.key) });
  }

  // ── GET /api/agent/memory/private/list — canonical private managed memory ─
  if (path === '/api/agent/memory/private/list' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId || !identity?.userId || !identity?.tenantId) {
      return jsonResponse({ error: 'no_workspace' }, 403);
    }
    const { routeSearchPrivateAgentsamMemory: searchPrivateAgentsamMemory } = await import('./route-memory-runtime.js');
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 200);
    const memoryType = url.searchParams.get('memory_type') || undefined;
    const out = await searchPrivateAgentsamMemory(env, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      memoryType,
      limit,
    });
    return jsonResponse({ ok: out.ok, surface: 'private', count: out.results?.length ?? 0, items: out.results ?? [] });
  }

  // ── POST /api/agent/memory/private/search — no Vectorize ─────────────────
  if (path === '/api/agent/memory/private/search' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId || !identity?.userId || !identity?.tenantId) {
      return jsonResponse({ error: 'no_workspace' }, 403);
    }
    const body = await request.json().catch(() => ({}));
    const q = String(body.query ?? body.q ?? '').trim();
    const { routeSearchPrivateAgentsamMemory: searchPrivateAgentsamMemory } = await import('./route-memory-runtime.js');
    const out = await searchPrivateAgentsamMemory(env, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      query: q || undefined,
      memoryType: body.memory_type ?? body.memoryType,
      memoryKey: body.memory_key ?? body.key,
      limit: body.limit ?? 20,
    });
    return jsonResponse({
      ok: out.ok,
      surface: 'private',
      tier: out.tier,
      query: q,
      count: out.results?.length ?? 0,
      results: out.results ?? [],
    });
  }

  // ── POST /api/agent/memory/private/upsert — D1 + private PG mirror ─────
  if (path === '/api/agent/memory/private/upsert' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId || !identity?.userId || !identity?.tenantId) {
      return jsonResponse({ error: 'no_workspace' }, 403);
    }
    const body = await request.json().catch(() => ({}));
    const key = String(body.key ?? body.memory_key ?? '').trim();
    const value = String(body.value ?? body.content ?? '').trim();
    if (!key || !value) return jsonResponse({ error: 'key_and_value_required' }, 400);
    const { routeMemoryWrite: memoryWrite } = await import('./route-memory-runtime.js');
    const out = await memoryWrite(
      {
        key,
        value,
        memory_type: body.memory_type ?? 'fact',
        tags: body.tags ?? [],
        source: body.source ?? 'dashboard_private_api',
        confidence: body.confidence ?? 1,
        ttl_days: body.ttl_days,
      },
      env,
      {
        tenantId: identity.tenantId,
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        sessionId: body.session_id ?? null,
      },
    );
    return jsonResponse({ ...out, surface: 'private' }, out.error ? 400 : 200);
  }

  // ── POST /api/agent/memory/maintenance — report only ─────────────────────
  if (path === '/api/agent/memory/maintenance' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId || !identity?.tenantId) {
      return jsonResponse({ error: 'no_workspace' }, 403);
    }
    const { routeRunAgentsamMemoryMaintenance: runAgentsamMemoryMaintenance } = await import('./route-memory-runtime.js');
    const report = await runAgentsamMemoryMaintenance(env, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
    });
    return jsonResponse(report);
  }

  // ── POST /api/agent/memory/resolve — mark memory closed (excluded from briefs) ─
  if (path === '/api/agent/memory/resolve' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'no_db' }, 503);
    let tenantId =
      identity?.tenantId ||
      (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null);
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    const userId = identity?.userId || authUser.id;
    if (!tenantId || !userId) return jsonResponse({ error: 'no_identity' }, 403);

    const body = await request.json().catch(() => ({}));
    const { routeResolveAgentsamMemory: resolveAgentsamMemory } = await import('./route-memory-runtime.js');
    const out = await resolveAgentsamMemory(env, {
      tenantId,
      userId,
      key: body.key ?? body.memory_key,
      keys: body.keys,
      id: body.id,
      resolvedBy: authUser.id,
      note: body.note ?? body.reason,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  // ── POST /api/agent/memory/private/backfill — D1 → private PG (owner) ───
  if (path === '/api/agent/memory/private/backfill' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!(await userCanAdminWorkspace(env, authUser, identity.workspaceId))) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }
    if (!identity?.workspaceId || !identity?.tenantId || !identity?.userId) {
      return jsonResponse({ error: 'no_workspace' }, 403);
    }
    const body = await request.json().catch(() => ({}));
    const { routeBackfillPrivateMemoryFromD1: backfillPrivateMemoryFromD1 } = await import('./route-memory-runtime.js');
    const report = await backfillPrivateMemoryFromD1(env, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      userId: body.all_users ? undefined : identity.userId,
      limit: body.limit ?? 500,
      dryRun: body.dry_run === true,
    });
    return jsonResponse(report, report.ok ? 200 : 500);
  }

  // ── POST /api/agent/memory/upsert — LEGACY public.agent_memory + embedding
  if (path === '/api/agent/memory/upsert' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId) {
      return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
    }
    const { routeIsHyperdriveUsable: isHyperdriveUsable } = await import('./route-memory-runtime.js');
    if (!isHyperdriveUsable(env)) {
      return jsonResponse({ error: 'HYPERDRIVE not configured' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const session_id = String(body.session_id ?? body.sessionId ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (!session_id) return jsonResponse({ error: 'session_id required' }, 400);
    if (!content) return jsonResponse({ error: 'content required' }, 400);

    const workspace_id = String(body.workspace_id ?? identity.workspaceId ?? '').trim();
    const tenant_id = String(body.tenant_id ?? identity.tenantId ?? '').trim();
    const user_id = String(body.user_id ?? identity.userId ?? '').trim();

    const meta =
      body.metadata && typeof body.metadata === 'object' && body.metadata !== null && !Array.isArray(body.metadata)
        ? body.metadata
        : {};

    try {
      const result = await insertCuratedAgentMemory(env, {
        content,
        session_id,
        role: body.role,
        agent_id: body.agent_id,
        metadata: meta,
        workspace_id,
        tenant_id,
        user_id,
      });
      const dims = result.embedding_dims;
      return jsonResponse({
        ok: true,
        id: result.id,
        session_id,
        has_embedding: dims === 1536,
        embedding_dims: dims,
        embed_model: result.embed_model,
        workspace_id,
        tenant_id,
        memory_lane: 'legacy_public_agent_memory',
        deprecation:
          'Use POST /api/agent/memory/private/upsert for managed operational memory (agentsam.agentsam_memory).',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      const status =
        lower.includes('not configured') || lower.includes('hyperdrive') ? 503 : 400;
      return jsonResponse({ ok: false, error: msg }, status);
    }
  }

  // ── POST /api/agent/memory/search — LEGACY semantic search on public.agent_memory
  if (path === '/api/agent/memory/search' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!identity?.workspaceId) {
      return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
    }
    const { routeIsHyperdriveUsable: isHyperdriveUsable } = await import('./route-memory-runtime.js');
    if (!isHyperdriveUsable(env)) {
      return jsonResponse({ error: 'HYPERDRIVE not configured' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const q = String(body.query ?? body.q ?? '').trim();
    if (!q) return jsonResponse({ error: 'query required' }, 400);

    const workspace_id = String(body.workspace_id ?? identity.workspaceId ?? '').trim();
    const tenant_id = String(body.tenant_id ?? identity.tenantId ?? '').trim();
    const session_id = body.session_id != null ? String(body.session_id).trim() : '';
    const user_id = body.user_id != null ? String(body.user_id).trim() : '';
    const filter_user_id = body.filter_user_id === true;
    const limit = body.limit;

    try {
      const { embed_model, results } = await searchCuratedAgentMemory(env, {
        query: q,
        workspace_id,
        tenant_id: tenant_id || null,
        user_id: filter_user_id ? String(identity.userId || '').trim() || null : user_id || null,
        session_id: session_id || null,
        limit,
      });
      return jsonResponse({
        ok: true,
        query: q,
        embed_model,
        workspace_id,
        tenant_id: tenant_id || null,
        count: results.length,
        results,
        memory_lane: 'legacy_public_agent_memory',
        deprecation:
          'Use POST /api/agent/memory/private/search for managed memory without Vectorize.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      const status =
        lower.includes('not configured') || lower.includes('hyperdrive') ? 503 : 400;
      return jsonResponse({ ok: false, error: msg }, status);
    }
  }

  // ── /api/agent/memory/sync — Supabase webhook OR manual D1→pgvector sync ──
  if (path === '/api/agent/memory/sync' && method === 'POST') {
    const webhookSig =
      request.headers.get('x-supabase-signature') ||
      request.headers.get('X-Supabase-Signature') ||
      '';
    if (webhookSig) {
      return handleAgentMemorySync(request, env);
    }
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    const bearer = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const bridgeOk =
      env.AGENTSAM_BRIDGE_KEY && bearer === String(env.AGENTSAM_BRIDGE_KEY).trim();
    if (!authUser && !bridgeOk) return jsonResponse({ error: 'Unauthorized' }, 401);
    const { routeRunAgentsamMemoryVectorSync: runAgentsamMemoryVectorSync } = await import('./route-memory-runtime.js');
    try {
      const out = await runAgentsamMemoryVectorSync(env, { skipLedger: true });
      return jsonResponse(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ ok: false, error: msg, embedded: 0, skipped: 0, failed: 0 }, 500);
    }
  }

  return null;
}
