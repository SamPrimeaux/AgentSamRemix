/**
 * POST /api/internal/summarize-session — Worker R2→memory bridge (Wave 2).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import { summarizeSessionFromR2 } from '../core/agentsam-session-summarize.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {any} [ctx]
 */
export async function handleSummarizeSession(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internalOk = verifyBridgeKey(request, env);
  if (!internalOk) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sessionId = String(
    body.session_id || body.conversation_id || new URL(request.url).searchParams.get('session_id') || '',
  ).trim();
  let workspaceId = String(body.workspace_id || '').trim();
  let tenantId = body.tenant_id != null ? String(body.tenant_id).trim() : null;
  let userId = body.user_id != null ? String(body.user_id).trim() : null;
  const force = body.force === true;

  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'session_id required' }, 400);
  }

  if ((!workspaceId || !userId) && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT user_id, workspace_id, tenant_id
           FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
      )
        .bind(sessionId)
        .first();
      if (row) {
        workspaceId = workspaceId || String(row.workspace_id || '').trim();
        userId = userId || (row.user_id != null ? String(row.user_id) : null);
        tenantId = tenantId || (row.tenant_id != null ? String(row.tenant_id) : null);
      }
    } catch (e) {
      console.warn('[summarize-session] d1 lookup', e?.message ?? e);
    }
  }

  if (!workspaceId) {
    return jsonResponse({ ok: false, error: 'workspace_id required (or session must exist in D1)' }, 400);
  }

  const result = await summarizeSessionFromR2(env, {
    sessionId,
    workspaceId,
    tenantId,
    userId,
    force,
    maxMessages: body.max_messages,
    ctx,
  });

  const status = result.ok || result.skipped ? 200 : result.reason === 'below_message_threshold' ? 422 : 500;
  return jsonResponse({ ok: Boolean(result.ok || result.skipped), ...result }, status);
}
