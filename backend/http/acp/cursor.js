/**
 * Transitional Cursor ACP facade — migration evidence only.
 *
 * Standards-compliant ACP core lives at `/api/acp` (`backend/http/acp/handler.js`).
 * This module keeps `cursor/*` vendor methods and delegates baseline session
 * methods to the ACP core domain (conversation session ≠ agent run).
 */

import { resolveIdentity } from '../../identity/index.js';
import { handleAcpRequest } from './handler.js';
import { createAcpChatSession, assertNotAgentRunIdAsSession } from './session.js';

/**
 * @param {string|number|null|undefined} id
 * @param {unknown} result
 * @param {{ code: number, message: string } | null} [error]
 */
function jsonRpc(id, result, error = null) {
  const body = error
    ? { jsonrpc: '2.0', id: id ?? null, error }
    : { jsonrpc: '2.0', id: id ?? null, result: result ?? {} };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} identity
 * @param {Array<Record<string, unknown>>} todos
 * @param {boolean} merge
 * @param {string} sessionId
 */
async function upsertAcpTodos(env, identity, todos, merge, sessionId) {
  if (!env?.DB || !Array.isArray(todos) || todos.length === 0) return;

  for (let i = 0; i < todos.length; i += 1) {
    const t = todos[i] || {};
    const title = String(t.content ?? t.title ?? t.name ?? `ACP todo ${i + 1}`).slice(0, 500);
    const todoId = `todo_acp_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const status = String(t.status ?? 'open').slice(0, 40);
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO agentsam_todo (
        id, tenant_id, title, status, execution_status, plan_id,
        category, created_by, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, 'cursor_acp', 'cursor_acp', ?, ?, ?)`,
    )
      .bind(
        todoId,
        identity.tenant?.id ?? identity.tenantId,
        title,
        status,
        sessionId,
        i * 10,
        now,
        now,
      )
      .run()
      .catch(() => {});
  }
  void merge;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCursorAcpMessage(request, env, ctx, { identity: suppliedIdentity, chatServices } = {}) {
  if (request.method !== 'POST') {
    return jsonRpc(null, null, { code: -32600, message: 'Method not allowed' });
  }

  const identity = suppliedIdentity || await resolveIdentity(request, env);
  const userId = identity?.user?.id ?? identity?.userId;
  const tenantId = identity?.tenant?.id ?? identity?.tenantId;
  const workspaceId = identity?.workspace?.id ?? identity?.workspaceId;
  if (!userId || !tenantId || !workspaceId) {
    return jsonRpc(null, null, { code: -32001, message: 'Unauthorized' });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonRpc(null, null, { code: -32700, message: 'Parse error' });
  }

  const method = String(body?.method || '').trim();
  const params =
    body?.params != null && typeof body.params === 'object' ? body.params : {};
  const id = body?.id ?? null;

  // Baseline ACP methods → core surface (same request identity).
  if (
    method === 'initialize' ||
    method === 'authenticate' ||
    method === 'session/prompt' ||
    method === 'session/load' ||
    method === 'session/cancel'
  ) {
    const coreReq = new Request(new URL('/api/acp', request.url).toString(), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(body),
    });
    return handleAcpRequest(coreReq, env, ctx, { identity, chatServices });
  }

  switch (method) {
    case 'session/new': {
      // Correct domain: conversation session — never arun_* as sessionId.
      const created = await createAcpChatSession(env, {
        userId,
        tenantId,
        workspaceId,
        title: 'Cursor ACP session',
      });
      return jsonRpc(id, {
        sessionId: created.sessionId,
        _meta: {
          iam: {
            conversation_id: created.conversationId,
            facade: 'cursor_acp',
            core: '/api/acp',
          },
        },
      });
    }

    case 'cursor/update_todos': {
      const sessionId = params?.sessionId != null ? String(params.sessionId).trim() : 'acp';
      try {
        assertNotAgentRunIdAsSession(sessionId);
      } catch (e) {
        return jsonRpc(id, null, {
          code: -32602,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      const todos = Array.isArray(params?.todos) ? params.todos : [];
      await upsertAcpTodos(env, identity, todos, params?.merge === true, sessionId);
      return jsonRpc(id, { outcome: { outcome: 'accepted', todos } });
    }

    case 'cursor/create_plan': {
      const planName = String(params?.name ?? 'ACP plan').slice(0, 200);
      const planId = `plan_acp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const today = new Date().toISOString().slice(0, 10);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO agentsam_plans (
          id, tenant_id, workspace_id, plan_date, plan_type, title, status,
          tasks_total, tasks_done, tasks_blocked, session_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'feature', ?, 'pending_approval', ?, 0, 0, ?, ?, ?)`,
      )
        .bind(
          planId,
          tenantId,
          workspaceId,
          today,
          planName,
          Array.isArray(params?.todos) ? params.todos.length : 0,
          JSON.stringify({ source: 'cursor_acp', plan: params?.plan ?? null }).slice(0, 4000),
          now,
          now,
        )
        .run()
        .catch((e) => console.warn('[cursor-acp] plan insert', e?.message ?? e));

      if (Array.isArray(params?.todos) && params.todos.length) {
        await upsertAcpTodos(env, identity, params.todos, false, planId);
      }

      return jsonRpc(id, { outcome: { outcome: 'accepted' }, planId });
    }

    case 'session/request_permission': {
      // Facade must not auto-allow. Defer to client / PermissionBroker.
      return jsonRpc(id, null, {
        code: -32000,
        message:
          'session/request_permission must be handled by ACP Client via PermissionBroker; facade does not auto-allow',
      });
    }

    default:
      return jsonRpc(id, null, { code: -32601, message: 'Method not found' });
  }
}
