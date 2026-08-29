import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { purgeArchivedChatSessions, PURGE_ARCHIVED_CHAT_CONFIRM } from '../../agentsam/sessions/purge.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';

export async function handleInternalChatSessionPurge(request, env) {
  if (request.method.toUpperCase() !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!verifyBridgeKey(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env?.DB) return jsonResponse({ ok: false, error: 'Database not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  if (String(body?.confirm || '') !== PURGE_ARCHIVED_CHAT_CONFIRM) {
    return jsonResponse({ ok: false, error: 'confirm_required', expected: PURGE_ARCHIVED_CHAT_CONFIRM }, 400);
  }
  const out = await purgeArchivedChatSessions(env, {
    dryRun: body?.dry_run !== false,
    limit: body?.limit,
  });
  return out.ok ? jsonResponse({ ok: true, ...out }) : jsonResponse({ ok: false, ...out }, 400);
}
