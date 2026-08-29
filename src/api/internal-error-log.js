/**
 * POST /api/internal/error-log
 * Durable agentsam_error_log insert for surfaces without a D1 binding (ExecOS on VM).
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer / X-Internal-Secret / X-ExecOS-Key aliases).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { writeAgentsamErrorLog } from '../../backend/telemetry/error-log.js';

function authorized(request, env) {
  return verifyBridgeKey(request, env);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 */
export async function handleInternalErrorLog(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!authorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const errorType = String(body.error_type || body.errorType || '').trim() || 'unknown';
  const errorCode = String(body.error_code || body.errorCode || '').trim() || null;
  const errorMessage = String(body.error_message || body.errorMessage || '').trim();
  const source = String(body.source || '').trim() || 'unknown';
  if (!errorMessage) {
    return jsonResponse({ error: 'error_message_required' }, 400);
  }

  const workspaceId =
    String(body.workspace_id || body.workspaceId || '').trim() || 'unknown';
  const tenantId = String(body.tenant_id || body.tenantId || '').trim() || 'system';
  const sessionId = body.session_id != null ? String(body.session_id) : body.sessionId != null ? String(body.sessionId) : null;
  const sourceId = body.source_id != null ? String(body.source_id) : body.sourceId != null ? String(body.sourceId) : null;

  let contextJson = body.context_json ?? body.contextJson ?? null;
  if (contextJson != null && typeof contextJson === 'object') {
    contextJson = JSON.stringify(contextJson);
  } else if (contextJson != null) {
    contextJson = String(contextJson);
  }

  const payload = {
    workspaceId,
    tenantId,
    sessionId,
    errorCode,
    errorType,
    errorMessage,
    source,
    sourceId,
    contextJson,
    resolved: 0,
  };

  if (ctx?.waitUntil) {
  const { scheduleAgentsamErrorLog } = await import('../../backend/telemetry/error-log.js');
    scheduleAgentsamErrorLog(env, ctx, payload);
    return jsonResponse({ ok: true, queued: true });
  }

  const written = await writeAgentsamErrorLog(env, payload);
  if (!written.ok) {
    return jsonResponse({ ok: false, error: written.error || 'insert_failed' }, 500);
  }
  return jsonResponse({ ok: true, id: written.id });
}
