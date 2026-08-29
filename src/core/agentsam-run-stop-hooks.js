/**
 * In-app Agent Sam stop / consecutive-fail hooks.
 * trigger='stop'|'error' with hook_key agent_run_stop / agent_run_consecutive_fail.
 * Writes agentsam_hook_execution; retries → agentsam_request_queue.
 */

const STOP_HOOK_KEY = 'agent_run_stop';
const FAIL_HOOK_KEY = 'agent_run_consecutive_fail';
const FAIL_THRESHOLD = 2;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function hexecId() {
  return `hexec_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function queueId() {
  return `arq_${crypto.randomUUID().replace(/-/g, '').slice(0, 22)}`;
}

/**
 * @param {any} env
 * @param {string} hookKey
 * @param {string} trigger
 * @param {{ tenantId?: string, workspaceId?: string }} scope
 */
async function resolveHook(env, hookKey, trigger, scope = {}) {
  if (!env?.DB) return null;
  const tid = trim(scope.tenantId) || null;
  const wid = trim(scope.workspaceId) || null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, hook_key, trigger, handler_type, handler_config, is_active
         FROM agentsam_hook
        WHERE is_active = 1
          AND hook_key = ?
          AND trigger = ?
          AND (
            workspace_id IS NULL OR trim(COALESCE(workspace_id,'')) = ''
            OR (? IS NOT NULL AND workspace_id = ?)
          )
        ORDER BY CASE WHEN workspace_id IS NOT NULL AND workspace_id != '' THEN 0 ELSE 1 END,
                 COALESCE(priority, 100) ASC
        LIMIT 1`,
    )
      .bind(hookKey, trigger, wid, wid)
      .first();
    return row?.id ? row : null;
  } catch (e) {
    console.warn('[run-stop-hooks] resolveHook', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} fields
 */
async function insertHookExecution(env, fields) {
  if (!env?.DB || !fields.hook_id) return null;
  const id = hexecId();
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_hook_execution (
         id, tenant_id, workspace_id, hook_id, user_id,
         agent_run_id, conversation_id, session_id,
         source, event_type, action, actor, status,
         payload_json, metadata_json, error, ran_at, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),unixepoch())`,
    )
      .bind(
        id,
        trim(fields.tenant_id) || 'system',
        trim(fields.workspace_id) || null,
        String(fields.hook_id),
        trim(fields.user_id) || 'system',
        trim(fields.agent_run_id) || null,
        trim(fields.conversation_id) || null,
        trim(fields.session_id) || trim(fields.conversation_id) || null,
        trim(fields.source) || 'in_app_agent',
        trim(fields.event_type) || 'agent_run_stop',
        trim(fields.action) || 'stop',
        trim(fields.actor) || 'agentsam_run_stop_hooks',
        fields.status === 'fail' ? 'fail' : 'success',
        JSON.stringify(fields.payload || {}),
        JSON.stringify(fields.metadata || {}),
        fields.error ? String(fields.error).slice(0, 2000) : null,
      )
      .run();
    await env.DB.prepare(
      `UPDATE agentsam_hook
          SET run_count = COALESCE(run_count, 0) + 1,
              last_run_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(String(fields.hook_id))
      .run()
      .catch(() => {});
    return id;
  } catch (e) {
    console.warn('[run-stop-hooks] insertHookExecution', e?.message ?? e);
    return null;
  }
}

/**
 * Count consecutive recent agent_run_stop fails for session (includes just-written rows).
 * @param {any} env
 * @param {string} sessionId
 */
async function countConsecutiveStopFails(env, sessionId) {
  const sid = trim(sessionId);
  if (!env?.DB || !sid) return 0;
  try {
    const { results } = await env.DB.prepare(
      `SELECT status FROM agentsam_hook_execution
        WHERE session_id = ?
          AND event_type = 'agent_run_stop'
        ORDER BY COALESCE(created_at, 0) DESC, ran_at DESC
        LIMIT 8`,
    )
      .bind(sid)
      .all();
    let n = 0;
    for (const row of results || []) {
      if (String(row.status || '') === 'fail') n += 1;
      else break;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Enqueue retry on agentsam_request_queue (not approval_queue).
 * @param {any} env
 * @param {Record<string, unknown>} opts
 */
export async function enqueueAgentsamRequestRetry(env, opts) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const sessionId = trim(opts.sessionId || opts.conversationId);
  if (!sessionId) return { ok: false, reason: 'missing_session' };
  const id = queueId();
  const payload = {
    reason: 'consecutive_fail_retry',
    source_agent_run_id: trim(opts.agentRunId) || null,
    fail_count: Number(opts.failCount) || null,
    error_message: opts.errorMessage ? String(opts.errorMessage).slice(0, 1000) : null,
    model_key: opts.modelKey || null,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_request_queue (
         id, tenant_id, workspace_id, user_id, session_id, conversation_id,
         agent_run_id, task_type, source, payload_json, status, position,
         created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', 0, unixepoch(), unixepoch())`,
    )
      .bind(
        id,
        trim(opts.tenantId) || 'system',
        trim(opts.workspaceId) || null,
        trim(opts.userId) || null,
        sessionId,
        sessionId,
        trim(opts.agentRunId) || null,
        trim(opts.taskType) || 'agent_chat_retry',
        'agent_run_stop',
        JSON.stringify(payload),
      )
      .run();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Fire stop (+ optional consecutive-fail retry) after an in-app agent loop ends.
 * Never throws.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   success: boolean,
 *   agentRunId?: string|null,
 *   sessionId?: string|null,
 *   conversationId?: string|null,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   modelKey?: string|null,
 *   provider?: string|null,
 *   errorMessage?: string|null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   costUsd?: number,
 *   durationMs?: number,
 *   source?: string,
 * }} opts
 */
export async function fireAgentRunStopHooks(env, ctx, opts) {
  const success = opts.success !== false;
  const sessionId = trim(opts.sessionId || opts.conversationId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = trim(opts.tenantId);
  if (!tenantId) {
    console.warn('[agent-run-stop-hooks] skipped — tenant_id_required');
    return { ok: false, error: 'tenant_id_required', stop_hook_id: null, stop_execution_id: null, fail_execution_id: null, retry: null };
  }
  const userId = trim(opts.userId) || 'system';
  const agentRunId = trim(opts.agentRunId);
  const source = trim(opts.source) || 'in_app_agent';

  const stopHook = await resolveHook(env, STOP_HOOK_KEY, 'stop', { tenantId, workspaceId });
  let stopExecId = null;
  if (stopHook) {
    stopExecId = await insertHookExecution(env, {
      hook_id: stopHook.id,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      agent_run_id: agentRunId,
      conversation_id: sessionId,
      session_id: sessionId,
      source,
      event_type: 'agent_run_stop',
      action: success ? 'stop_ok' : 'stop_fail',
      status: success ? 'success' : 'fail',
      error: success ? null : opts.errorMessage,
      payload: {
        success,
        model_key: opts.modelKey || null,
        provider: opts.provider || null,
        duration_ms: opts.durationMs ?? null,
      },
      metadata: { hook_key: STOP_HOOK_KEY, handler_type: stopHook.handler_type },
    });
  }

  let retry = null;
  let failExecId = null;
  if (!success && sessionId) {
    const streak = await countConsecutiveStopFails(env, sessionId);
    if (streak >= FAIL_THRESHOLD) {
      const failHook = await resolveHook(env, FAIL_HOOK_KEY, 'error', { tenantId, workspaceId });
      if (failHook) {
        failExecId = await insertHookExecution(env, {
          hook_id: failHook.id,
          tenant_id: tenantId,
          workspace_id: workspaceId,
          user_id: userId,
          agent_run_id: agentRunId,
          conversation_id: sessionId,
          session_id: sessionId,
          source,
          event_type: 'agent_run_consecutive_fail',
          action: 'enqueue_retry',
          status: 'success',
          payload: { fail_threshold: FAIL_THRESHOLD, streak },
          metadata: { hook_key: FAIL_HOOK_KEY, queue: 'agentsam_request_queue' },
        });
      }
      retry = await enqueueAgentsamRequestRetry(env, {
        sessionId,
        conversationId: sessionId,
        agentRunId,
        tenantId,
        workspaceId,
        userId,
        modelKey: opts.modelKey,
        errorMessage: opts.errorMessage,
        failCount: streak,
        taskType: 'agent_chat_retry',
      });
    }
  }

  return {
    ok: true,
    stop_hook_id: stopHook?.id || null,
    stop_execution_id: stopExecId,
    fail_execution_id: failExecId,
    retry,
  };
}

export { STOP_HOOK_KEY, FAIL_HOOK_KEY, FAIL_THRESHOLD };
