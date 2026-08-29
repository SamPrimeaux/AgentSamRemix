/**
 * Canonical agentsam_agent_run lifecycle writer.
 *
 * This table is intentionally a narrow 22-column execution envelope. Keep
 * routing provenance, spawn hierarchy, and execution steps in their owning
 * tables instead of widening this writer with legacy columns.
 */

import { applyThompsonLoopFromAgentRun } from '../services/learning/agent-run.js';

const RUN_MODES = new Set(['ask', 'plan', 'agent', 'debug', 'multitask']);
const RUN_STATUSES = new Set([
  'queued',
  'running',
  'completed',
  'failed',
  'partial',
  'cancelled',
]);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function normalizeMode(value) {
  const mode = trim(value).toLowerCase();
  if (mode === 'auto') return 'agent';
  return RUN_MODES.has(mode) ? mode : 'agent';
}

function normalizeSelectedBy(value) {
  const selectedBy = trim(value).toLowerCase();
  if (selectedBy === 'requested') return 'manual';
  return selectedBy === 'manual' || selectedBy === 'thompson' || selectedBy === 'fallback'
    ? selectedBy
    : null;
}

function normalizeStatus(value, fallback = 'running') {
  const status = trim(value).toLowerCase();
  return RUN_STATUSES.has(status) ? status : fallback;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(numberOrZero(value)));
}

function boundedText(value, max) {
  const text = trim(value);
  return text ? text.slice(0, max) : null;
}

function requiredScope(p) {
  const userId = trim(p?.userId ?? p?.user_id);
  const tenantId = trim(p?.tenantId ?? p?.tenant_id);
  const workspaceId = trim(p?.workspaceId ?? p?.workspace_id);
  if (!userId || !tenantId || !workspaceId) return null;
  return { userId, tenantId, workspaceId };
}

async function applyRunLearning(env, runId, scope) {
  try {
    await applyThompsonLoopFromAgentRun(env, runId, scope);
  } catch (error) {
    console.warn('[agent-run] learning', error?.message ?? error);
  }
}

/**
 * @param {{ label?: string|null }} [opts]
 * @returns {string}
 */
export function createAgentRunId(opts = {}) {
  const rawLabel = trim(opts.label)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return rawLabel ? `arun_${rawLabel}_${suffix}` : `arun_${suffix}`;
}

/**
 * Insert or preserve a running agentsam_agent_run row.
 *
 * @param {any} env
 * @param {{
 *   runId?: string|null,
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   conversationId?: string|null,
 *   mode?: string|null,
 *   modelKey?: string|null,
 *   routingArmId?: string|null,
 *   selectedBy?: string|null,
 *   routingStrategy?: string|null,
 * }} p
 */
export async function startAgentRun(env, p = {}) {
  if (!env?.DB) return { ok: false, runId: null, reason: 'no_db' };
  const scope = requiredScope(p);
  const runId = trim(p.runId ?? p.run_id);
  if (!scope || !runId) {
    return { ok: false, runId: null, reason: 'agent_run_scope_required' };
  }

  const now = unixNow();
  const mode = normalizeMode(p.mode);
  const selectedBy = normalizeSelectedBy(p.selectedBy ?? p.selected_by ?? p.routingStrategy);
  const modelKey = boundedText(p.modelKey ?? p.model_key, 200);
  const routingArmId = boundedText(p.routingArmId ?? p.routing_arm_id, 120);
  const conversationId = boundedText(p.conversationId ?? p.conversation_id, 200);

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_agent_run (
        id, user_id, tenant_id, workspace_id, conversation_id,
        mode, model_key, selected_by, routing_arm_id,
        status, error_code, error_message,
        created_at_unix, started_at_unix, completed_at_unix, updated_at_unix,
        latency_ms, input_tokens, output_tokens, cached_input_tokens,
        reasoning_tokens, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, 0)`,
    )
      .bind(
        runId,
        scope.userId,
        scope.tenantId,
        scope.workspaceId,
        conversationId,
        mode,
        modelKey,
        selectedBy,
        routingArmId,
        now,
        now,
        now,
      )
      .run();
  } catch (error) {
    return { ok: false, runId, reason: error?.message ?? String(error) };
  }

  return { ok: true, runId, reason: null };
}

/**
 * Write a terminal agentsam_agent_run state. If a start raced behind the
 * finalize, create the complete 22-column row instead of leaving a ghost.
 *
 * @param {any} env
 * @param {{
 *   runId: string,
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   conversationId?: string|null,
 *   mode?: string|null,
 *   modelKey?: string|null,
 *   routingArmId?: string|null,
 *   status?: string|null,
 *   success?: boolean,
 *   cancelled?: boolean,
 *   errorCode?: string|null,
 *   errorMessage?: string|null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   cachedInputTokens?: number,
 *   reasoningTokens?: number,
 *   costUsd?: number,
 *   latencyMs?: number,
 * }} p
 */
export async function finalizeAgentRun(env, p = {}) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const scope = requiredScope(p);
  const runId = trim(p.runId ?? p.run_id);
  if (!scope || !runId) return { ok: false, reason: 'agent_run_scope_required' };

  const status = p.cancelled === true
    ? 'cancelled'
    : normalizeStatus(p.status, p.success === false ? 'failed' : 'completed');
  const now = unixNow();
  const latencyMs = nonNegativeInteger(p.latencyMs ?? p.latency_ms);
  const inputTokens = nonNegativeInteger(p.inputTokens ?? p.input_tokens);
  const outputTokens = nonNegativeInteger(p.outputTokens ?? p.output_tokens);
  const cachedInputTokens = nonNegativeInteger(
    p.cachedInputTokens ?? p.cached_input_tokens ?? p.cacheReadTokens,
  );
  const reasoningTokens = nonNegativeInteger(p.reasoningTokens ?? p.reasoning_tokens);
  const costUsd = Math.max(0, numberOrZero(p.costUsd ?? p.cost_usd));
  const modelKey = boundedText(p.modelKey ?? p.model_key, 200);
  const routingArmId = boundedText(p.routingArmId ?? p.routing_arm_id, 120);
  const mode = normalizeMode(p.mode);
  const conversationId = boundedText(p.conversationId ?? p.conversation_id, 200);
  const errorCode = boundedText(p.errorCode ?? p.error_code, 200);
  const errorMessage = boundedText(p.errorMessage ?? p.error_message, 8000);

  try {
    const result = await env.DB.prepare(
      `UPDATE agentsam_agent_run SET
         conversation_id = COALESCE(?, conversation_id),
         mode = COALESCE(?, mode),
         model_key = COALESCE(?, model_key),
         routing_arm_id = COALESCE(?, routing_arm_id),
         status = ?,
         error_code = ?,
         error_message = ?,
         completed_at_unix = ?,
         updated_at_unix = ?,
         latency_ms = ?,
         input_tokens = ?,
         output_tokens = ?,
         cached_input_tokens = ?,
         reasoning_tokens = ?,
         cost_usd = ?
       WHERE id = ? AND user_id = ? AND tenant_id = ? AND workspace_id = ?`,
    )
      .bind(
        conversationId,
        mode,
        modelKey,
        routingArmId,
        status,
        errorCode,
        errorMessage,
        now,
        now,
        latencyMs,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
        costUsd,
        runId,
        scope.userId,
        scope.tenantId,
        scope.workspaceId,
      )
      .run();

    const changed = Number(result?.meta?.changes ?? result?.changes ?? 0) || 0;
    if (changed > 0) {
      await applyRunLearning(env, runId, scope);
      return { ok: true, runId, status, reason: null };
    }

    const startedAt = Math.max(0, now - Math.floor(latencyMs / 1000));
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_agent_run (
        id, user_id, tenant_id, workspace_id, conversation_id,
        mode, model_key, selected_by, routing_arm_id,
        status, error_code, error_message,
        created_at_unix, started_at_unix, completed_at_unix, updated_at_unix,
        latency_ms, input_tokens, output_tokens, cached_input_tokens,
        reasoning_tokens, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        scope.userId,
        scope.tenantId,
        scope.workspaceId,
        conversationId,
        mode,
        modelKey,
        routingArmId,
        status,
        errorCode,
        errorMessage,
        startedAt,
        startedAt,
        now,
        now,
        latencyMs,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
        costUsd,
      )
      .run();
    await applyRunLearning(env, runId, scope);
  } catch (error) {
    return { ok: false, runId, status, reason: error?.message ?? String(error) };
  }

  return { ok: true, runId, status, reason: null };
}

/**
 * Terminal-cancel all active runs owned by a user in one conversation.
 *
 * @param {any} env
 * @param {{
 *   conversationId: string,
 *   userId: string,
 *   tenantId?: string|null,
 *   reason?: string|null,
 *   limit?: number,
 * }} p
 */
export async function cancelAgentRunsForConversation(env, p = {}) {
  if (!env?.DB) return { ok: false, count: 0, reason: 'no_db' };
  const conversationId = trim(p.conversationId ?? p.conversation_id);
  const userId = trim(p.userId ?? p.user_id);
  const tenantId = trim(p.tenantId ?? p.tenant_id);
  if (!conversationId || !userId) {
    return { ok: false, count: 0, reason: 'conversation_and_user_required' };
  }

  const limit = Math.min(50, Math.max(1, nonNegativeInteger(p.limit) || 20));
  const reason = boundedText(p.reason, 500) || 'agent_run_cancelled_by_conversation';
  const now = unixNow();
  let sql = `
    UPDATE agentsam_agent_run
       SET status = 'cancelled',
           error_message = COALESCE(NULLIF(TRIM(error_message), ''), ?),
           completed_at_unix = COALESCE(completed_at_unix, ?),
           updated_at_unix = ?
     WHERE id IN (
       SELECT id
         FROM agentsam_agent_run
        WHERE conversation_id = ?
          AND user_id = ?
          AND status IN ('queued', 'running')`;
  const binds = [reason, now, now, conversationId, userId];
  if (tenantId) {
    sql += ' AND tenant_id = ?';
    binds.push(tenantId);
  }
  sql += ' ORDER BY created_at_unix DESC LIMIT ?)';
  binds.push(limit);

  try {
    const result = await env.DB.prepare(sql).bind(...binds).run();
    return {
      ok: true,
      count: Number(result?.meta?.changes ?? result?.changes ?? 0) || 0,
      conversationId,
      reason: null,
    };
  } catch (error) {
    return { ok: false, count: 0, reason: error?.message ?? String(error) };
  }
}
