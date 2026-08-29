/**
 * Agent chat sessions + do-history routes — peeled from agent/chat.js (Pass A).
 * Ticket: tkt_mod_peel_agent_chat_api_2026_08
 */
import {
  listUserChatSessions,
  getUserChatSession,
  patchUserChatSession,
  deleteUserChatSession,
  ensureChatSessionRow,
} from '../../agentsam/sessions/index.js';
import { initChatSessionR2 } from '../../agentsam/sessions/compaction/archive.js';
import { getChatMessages } from '../../agentsam/sessions/chat-do-client.js';
import { jsonResponse, trustedUser } from './shared.js';

/**
 * @returns {Promise<Response|null>}
 */
export async function handleChatSessionsApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };
  const authUser = trustedUser(identity) || trustedUser(ra);
  const userId = String(authUser?.id || '').trim();
  const tenantId = String(authUser?.tenant_id || identity?.tenantId || '').trim() || null;

  const isSessions = path === '/api/agent/sessions' || path.startsWith('/api/agent/sessions/');
  const isDoHistory = path === '/api/agent/do-history';
  if (!isSessions && !isDoHistory) return null;

  // ── /api/agent/sessions/:id/outbox ───────────────────────────────────────
  const sessOutboxMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)\/outbox$/);
  if (sessOutboxMatch && (method === 'GET' || method === 'POST')) {
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const convId = decodeURIComponent(sessOutboxMatch[1] || '').trim();
    if (!convId) return jsonResponse({ error: 'session id required' }, 400);
    if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION not configured' }, 503);

    const turnId = (url.searchParams.get('turn_id') || '').trim();
    if (!turnId) return jsonResponse({ error: 'turn_id required' }, 400);

    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(convId));
    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return stub.fetch(
        new Request('https://do/outbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    }

    if (url.searchParams.get('stream') === '1') {
      const sinceSeq = url.searchParams.get('since_seq') || '0';
      return stub.fetch(
        new Request(
          `https://do/outbox/stream?turn_id=${encodeURIComponent(turnId)}&since_seq=${encodeURIComponent(sinceSeq)}`,
        ),
      );
    }

    const sinceSeq = url.searchParams.get('since_seq') || '0';
    const limit = url.searchParams.get('limit') || '500';
    return stub.fetch(
      new Request(
        `https://do/outbox?turn_id=${encodeURIComponent(turnId)}&since_seq=${encodeURIComponent(sinceSeq)}&limit=${encodeURIComponent(limit)}`,
      ),
    );
  }

  // ── /api/agent/sessions/:id/messages ─────────────────────────────────────
  const sessMessagesMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)\/messages$/);
  if (sessMessagesMatch && method === 'GET') {
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    if (!userId) return jsonResponse({ error: 'auth_user_id_required' }, 401);
    if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);

    const convId = decodeURIComponent(sessMessagesMatch[1] || '').trim();
    if (!convId) return jsonResponse({ error: 'session id required' }, 400);
    const ownedSession = await env.DB.prepare(
      `SELECT 1 AS ok FROM agentsam_chat_sessions
       WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?
       LIMIT 1`,
    )
      .bind(convId, userId, tenantId)
      .first()
      .catch(() => null);
    if (!ownedSession) return jsonResponse({ error: 'Session not found' }, 404);

    // DO history can contain the user row + an empty pending assistant. Returning
    // that skips R2/outbox fill and the UI drops the empty assistant on refresh.
    const messages = await getChatMessages(env, convId);
    return jsonResponse(messages);
  }

  // ── /api/agent/sessions GET / PATCH / DELETE /:id ───────────────────
  const sessionPatchMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)$/);
  if (sessionPatchMatch && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
    if (!userId) return jsonResponse({ error: 'auth_user_id_required' }, 401);
    const convId = decodeURIComponent(sessionPatchMatch[1] || '').trim();

    if (method === 'GET') {
      const row = await getUserChatSession(env, {
        conversationId: convId,
        userId,
        tenantId,
      });
      if (!row) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse(row);
    }

    if (method === 'DELETE') {
      const deleteResult = await deleteUserChatSession(env, {
        conversationId: convId,
        userId,
        tenantId,
      });
      if (!deleteResult.ok) {
        const status = deleteResult.error === 'not_found' ? 404 : 400;
        return jsonResponse({ error: deleteResult.error || 'delete_failed' }, status);
      }
      return jsonResponse({ success: true, deleted: true });
    }

    const body = await request.json().catch(() => ({}));
    const patchResult = await patchUserChatSession(env, {
      conversationId: convId,
      userId,
      tenantId,
      patch: body,
    });
    if (!patchResult.ok) {
      const status = patchResult.error === 'not_found' ? 404 : 400;
      return jsonResponse({ error: patchResult.error || 'patch_failed' }, status);
    }
    if (patchResult.deleted) {
      return jsonResponse({ success: true, deleted: true });
    }
    return jsonResponse({ success: true });
  }

  // ── /api/agent/sessions ───────────────────────────────────────────────────
  if (path === '/api/agent/sessions') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
    if (!userId) return jsonResponse({ error: 'auth_user_id_required' }, 401);
    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const conversationId = crypto.randomUUID();
      const title =
        typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'New Conversation';
      const wsId =
        authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim() !== ''
          ? String(authUser.active_workspace_id).trim()
          : null;
      if (!wsId) {
        return jsonResponse({ error: 'workspace_required' }, 400);
      }
      const workspace = await env.DB
        .prepare('SELECT 1 AS ok FROM agentsam_workspace WHERE id = ? LIMIT 1')
        .bind(wsId)
        .first()
        .catch(() => null);
      if (!workspace) {
        return jsonResponse({ error: 'invalid_workspace' }, 400);
      }
      try {
        await ensureChatSessionRow(env, {
          conversationId,
          tenantId,
          userId,
          workspaceId: wsId,
          title,
        });
      } catch (e) {
        return jsonResponse({ error: e?.message || 'session_create_failed' }, 400);
      }
      initChatSessionR2(env, {
        conversationId,
        userId,
        workspaceId: wsId,
        tenantId,
        title,
        modelKey: body.model_key ?? body.modelKey ?? null,
      }).catch(() => {});
      return jsonResponse({ id: conversationId, status: 'active' });
    }
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 1), 200);
    const projectId = url.searchParams.get('project_id') || url.searchParams.get('projectId') || null;
    const workspaceId =
      url.searchParams.get('workspace_id') ||
      (authUser.active_workspace_id ? String(authUser.active_workspace_id) : null);
    const pinConversationId =
      url.searchParams.get('pin') ||
      url.searchParams.get('pin_conversation_id') ||
      url.searchParams.get('conversation_id') ||
      null;
    const results = await listUserChatSessions(env, {
      userId,
      tenantId,
      limit,
      projectId,
      workspaceId,
      pinConversationId,
    });
    return jsonResponse(results);
  }

  // ── /api/agent/do-history ─────────────────────────────────────────────────
  if (path === '/api/agent/do-history' && method === 'GET') {
    if (!identity?.userId) return jsonResponse({ error: 'unauthenticated' }, 401);
    const convId = url.searchParams.get('conversation_id');
    if (!convId) return jsonResponse({ error: 'conversation_id required' }, 400);
    if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION not configured' }, 503);
    const doId = env.AGENT_SESSION.idFromName(String(convId));
    const stub = env.AGENT_SESSION.get(doId);
    const lim  = url.searchParams.get('limit') || '50';
    const resp = await stub.fetch(new Request(`https://do/history?limit=${encodeURIComponent(lim)}`));
    return new Response(resp.body, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
  }

  return null;
}
