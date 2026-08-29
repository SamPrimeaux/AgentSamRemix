/**
 * Durable signal for agent-controller soft failures.
 * console.warn alone hid Hyperdrive/pool deaths for days — every catch that
 * continues the turn must leave a searchable agentsam_error_log row when identity exists.
 */

import { writeAgentsamErrorLog } from '../../../telemetry/error-log.js';

/**
 * @param {any} env
 * @param {string} tag — short stable code (history_hydrate, codemode_build_failed, …)
 * @param {unknown} err
 * @param {{
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   sessionId?: string|null,
 *   sourceId?: string|null,
 *   meta?: Record<string, unknown>|null,
 * }} [ctx]
 */
export function reportAgentControllerWarning(env, tag, err, ctx = {}) {
  const code = String(tag || 'agent_controller_warn').slice(0, 120);
  const message =
    err instanceof Error
      ? err.message
      : err != null
        ? String(err)
        : code;
  const stack = err instanceof Error && err.stack ? String(err.stack).slice(0, 12000) : null;
  console.warn(`[agent-controller] ${code}`, message, ctx.meta || '');

  const workspaceId = ctx.workspaceId != null ? String(ctx.workspaceId).trim() : '';
  const tenantId = ctx.tenantId != null ? String(ctx.tenantId).trim() : '';
  if (!env?.DB || !workspaceId || !tenantId) return;

  const contextJson = JSON.stringify({
    tag: code,
    ...(ctx.meta && typeof ctx.meta === 'object' ? ctx.meta : {}),
  }).slice(0, 50000);

  void writeAgentsamErrorLog(env, {
    workspaceId,
    tenantId,
    sessionId: ctx.sessionId != null ? String(ctx.sessionId) : null,
    errorCode: code,
    errorType: 'agent_controller_soft_fail',
    errorMessage: message.slice(0, 8000),
    source: 'agent-controller',
    sourceId: ctx.sourceId != null ? String(ctx.sourceId).slice(0, 200) : code,
    contextJson,
    stackTrace: stack,
    resolved: 0,
  }).catch((e) => console.warn('[agent-controller] report_write_failed', e?.message ?? e));
}
