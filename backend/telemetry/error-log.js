/**
 * Structured errors → agentsam_error_log (fire-and-forget).
 */

import { scheduleErrorLogEscalation } from './error-log-escalation.js';

/**
 * Awaited insert into agentsam_error_log.
 * Prefer this from Workers/queue paths that must leave a durable row before exit.
 *
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   tenantId: string,
 *   sessionId?: string | null,
 *   errorCode?: string | null,
 *   errorType: string,
 *   errorMessage: string,
 *   source: string,
 *   sourceId?: string | null,
 *   contextJson?: string | null,
 *   stackTrace?: string | null,
 *   resolved?: boolean | number | null,
 * }} o
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function writeAgentsamErrorLog(env, o) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const ws = o.workspaceId != null ? String(o.workspaceId).trim() : '';
  const tid = o.tenantId != null ? String(o.tenantId).trim() : '';
  if (!ws || !tid) return { ok: false, error: 'workspace_and_tenant_required' };
  const msg = o.errorMessage != null ? String(o.errorMessage).slice(0, 8000) : '';
  if (!msg) return { ok: false, error: 'error_message_required' };

  try {
    const id = `aerr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT INTO agentsam_error_log (
         id, workspace_id, tenant_id, session_id, error_code, error_type,
         error_message, source, source_id, context_json, stack_trace, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        ws,
        tid,
        o.sessionId != null ? String(o.sessionId).slice(0, 200) : null,
        o.errorCode != null ? String(o.errorCode).slice(0, 120) : null,
        String(o.errorType || 'unknown').slice(0, 120),
        msg,
        String(o.source || 'unknown').slice(0, 200),
        o.sourceId != null ? String(o.sourceId).slice(0, 200) : null,
        o.contextJson != null ? String(o.contextJson).slice(0, 50000) : '{}',
        o.stackTrace != null ? String(o.stackTrace).slice(0, 12000) : null,
        o.resolved === true || o.resolved === 1 ? 1 : 0,
      )
      .run();
    return { ok: true, id };
  } catch (e) {
    console.warn('[agentsam_error_log]', e?.message ?? e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   workspaceId: string,
 *   tenantId: string,
 *   sessionId?: string | null,
 *   errorCode?: string | null,
 *   errorType: string,
 *   errorMessage: string,
 *   source: string,
 *   sourceId?: string | null,
 *   contextJson?: string | null,
 *   stackTrace?: string | null,
 * }} o
 */
export function scheduleAgentsamErrorLog(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return;
  const ws = o.workspaceId != null ? String(o.workspaceId).trim() : '';
  const tid = o.tenantId != null ? String(o.tenantId).trim() : '';
  if (!ws || !tid) return;
  const msg = o.errorMessage != null ? String(o.errorMessage).slice(0, 8000) : '';
  if (!msg) return;

  ctx.waitUntil(
    (async () => {
      const written = await writeAgentsamErrorLog(env, o);
      if (!written.ok || !written.id) return;
      scheduleErrorLogEscalation(env, ctx, {
        id: written.id,
        tenant_id: tid,
        workspace_id: ws,
        error_type: String(o.errorType || 'unknown').slice(0, 120),
        error_message: msg,
        source_id: o.sourceId != null ? String(o.sourceId).slice(0, 200) : null,
        context_json: o.contextJson != null ? String(o.contextJson).slice(0, 50000) : null,
      });
    })(),
  );
}

/**
 * Write agentsam_error_log for a failed agentsam_tool_call_log row.
 * Sets source/source_id so Problems/analytics can join both ways:
 *   error_log.source = 'agentsam_tool_call_log' AND source_id = atcl_*
 *   tool_call_log.error_log_id = error_log.id
 *
 * @param {any} env
 * @param {{
 *   toolCallLogId: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   errorMessage: string,
 *   sessionId?: string | null,
 *   errorType?: string | null,
 *   errorCode?: string | null,
 *   contextJson?: string | null,
 *   stackTrace?: string | null,
 * }} o
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function writeErrorLogForToolCall(env, o) {
  const toolCallLogId = o.toolCallLogId != null ? String(o.toolCallLogId).trim() : '';
  if (!toolCallLogId) return { ok: false, error: 'tool_call_log_id_required' };
  return writeAgentsamErrorLog(env, {
    workspaceId: o.workspaceId,
    tenantId: o.tenantId,
    sessionId: o.sessionId,
    errorCode: o.errorCode,
    errorType: o.errorType || 'tool_call_failed',
    errorMessage: o.errorMessage,
    source: 'agentsam_tool_call_log',
    sourceId: toolCallLogId,
    contextJson: o.contextJson,
    stackTrace: o.stackTrace,
  });
}
