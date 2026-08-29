/**
 * POST /api/internal/artifacts/purge — AGENTSAM_BRIDGE_KEY only (no browser session).
 */
import { jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { purgeWorkspaceArtifacts, PURGE_CONFIRM } from '../core/artifact-purge.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleArtifactPurgeInternal(request, env) {
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
  if (String(body?.confirm || '') !== PURGE_CONFIRM) {
    return jsonResponse({ ok: false, error: 'confirm_required', expected: PURGE_CONFIRM }, 400);
  }

  const workspaceId =
    String(body?.workspace_id || env.WORKSPACE_ID || '').trim() || null;
  const out = await purgeWorkspaceArtifacts(
    env,
    { isSa: true, tenantId: null, userId: null, workspaceId: null },
    {
      workspaceId,
      dryRun: !!body?.dry_run,
      deleteR2: body?.delete_r2 !== false,
    },
  );

  if (!out.ok) return jsonResponse({ ok: false, ...out }, 400);
  return jsonResponse({ ok: true, ...out });
}
