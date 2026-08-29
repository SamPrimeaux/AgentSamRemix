/**
 * POST /api/internal/chat-sessions/purge-archived — AGENTSAM_BRIDGE_KEY only.
 */
import { jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { purgeArchivedChatSessions, PURGE_ARCHIVED_CHAT_CONFIRM } from '../../backend/agentsam/sessions/purge.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleChatSessionPurgeArchivedInternal(request, env) {
  if (request.method.toUpperCase() !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!env?.DB) {
    return jsonResponse({ ok: false, error: 'Database not configured' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  if (String(body?.confirm || '') !== PURGE_ARCHIVED_CHAT_CONFIRM) {
    return jsonResponse({ ok: false, error: 'confirm_required', expected: PURGE_ARCHIVED_CHAT_CONFIRM }, 400);
  }

  const out = await purgeArchivedChatSessions(env, {
    dryRun: body?.dry_run !== false,
    limit: body?.limit,
  });

  if (!out.ok) return jsonResponse({ ok: false, ...out }, 400);
  return jsonResponse({ ok: true, ...out });
}
