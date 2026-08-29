import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { scheduleAgentsamErrorLog, writeAgentsamErrorLog } from '../../telemetry/error-log.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';

export async function handleInternalErrorLogRoute(request, env, ctx) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!verifyBridgeKey(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
  const errorType = String(body.error_type || body.errorType || '').trim() || 'unknown';
  const errorCode = String(body.error_code || body.errorCode || '').trim() || null;
  const errorMessage = String(body.error_message || body.errorMessage || '').trim();
  const source = String(body.source || '').trim() || 'unknown';
  if (!errorMessage) return jsonResponse({ error: 'error_message_required' }, 400);

  let contextJson = body.context_json ?? body.contextJson ?? null;
  if (contextJson != null && typeof contextJson === 'object') contextJson = JSON.stringify(contextJson);
  else if (contextJson != null) contextJson = String(contextJson);
  const payload = {
    workspaceId: String(body.workspace_id || body.workspaceId || '').trim() || 'unknown',
    tenantId: String(body.tenant_id || body.tenantId || '').trim() || 'system',
    sessionId: body.session_id != null ? String(body.session_id) : body.sessionId != null ? String(body.sessionId) : null,
    errorCode,
    errorType,
    errorMessage,
    source,
    sourceId: body.source_id != null ? String(body.source_id) : body.sourceId != null ? String(body.sourceId) : null,
    contextJson,
    resolved: 0,
  };
  if (ctx?.waitUntil) {
    scheduleAgentsamErrorLog(env, ctx, payload);
    return jsonResponse({ ok: true, queued: true });
  }
  const written = await writeAgentsamErrorLog(env, payload);
  return written.ok
    ? jsonResponse({ ok: true, id: written.id })
    : jsonResponse({ ok: false, error: written.error || 'insert_failed' }, 500);
}
