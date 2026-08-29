/**
 * agentsam_escalation — single writer for route/spawn/failover decisions.
 * Schema: migration 1123. Does not bump Thompson arms (use applyRewardEvent).
 */

import { normalizeMode } from '../../backend/agentsam/runtime/routing/route-keys.js';

const KINDS = new Set([
  'route_upgrade',
  'model_upgrade',
  'spawn',
  'handoff',
  'failover',
  'user_requested',
]);

const REASONS = new Set([
  'complexity',
  'ambiguous_scope',
  'multi_file',
  'needs_research',
  'needs_sql',
  'needs_orchestration',
  'tool_failure',
  'timeout',
  'budget',
  'context',
  'user_requested',
  'policy',
]);

const ROUTE_KEYS = new Set([
  'general',
  'quick',
  'code',
  'code_debug',
  'planning',
  'research',
  'summary',
  'vision',
  'image_generation',
  'tool_orchestration',
  'router',
  'intent_classification',
  'rag',
  'embeddings',
]);

const STATUSES = new Set([
  'proposed',
  'accepted',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * @param {unknown} env
 * @param {{
 *   tenant_id: string,
 *   workspace_id?: string|null,
 *   conversation_id?: string|null,
 *   agent_run_id: string,
 *   parent_escalation_id?: string|null,
 *   kind: string,
 *   reason: string,
 *   reason_detail?: string|null,
 *   from_route_key?: string|null,
 *   to_route_key: string,
 *   from_model_key?: string|null,
 *   to_model_key?: string|null,
 *   spawn_job_id?: string|null,
 *   spawn_session_id?: string|null,
 *   approval_queue_id?: string|null,
 *   child_profile_slug?: string|null,
 *   mode: string,
 *   status?: string,
 *   router_model_key?: string|null,
 *   confidence?: number|null,
 *   metadata?: Record<string, unknown>|null,
 * }} p
 */
export async function applyEscalationDecision(env, p) {
  if (!env?.DB) throw new Error('Database not configured');

  const tenantId = String(p.tenant_id || '').trim();
  const agentRunId = String(p.agent_run_id || '').trim();
  const kind = String(p.kind || '').trim();
  const reason = String(p.reason || '').trim();
  const toRoute = String(p.to_route_key || '').trim();
  if (!tenantId) throw new Error('tenant_id_required');
  if (!agentRunId) throw new Error('agent_run_id_required');
  if (!KINDS.has(kind)) throw new Error(`escalation_kind_invalid:${kind}`);
  if (!REASONS.has(reason)) throw new Error(`escalation_reason_invalid:${reason}`);
  if (!ROUTE_KEYS.has(toRoute)) throw new Error(`to_route_key_invalid:${toRoute}`);

  let mode;
  try {
    mode = normalizeMode(p.mode);
  } catch {
    throw new Error(`escalation_mode_invalid:${p.mode}`);
  }

  const spawnJobId =
    p.spawn_job_id != null && String(p.spawn_job_id).trim()
      ? String(p.spawn_job_id).trim()
      : null;
  const spawnSessionId =
    p.spawn_session_id != null && String(p.spawn_session_id).trim()
      ? String(p.spawn_session_id).trim()
      : null;

  if ((kind === 'spawn' || kind === 'handoff') && !spawnSessionId) {
    throw new Error('spawn_session_id_required');
  }
  if (kind === 'spawn' && !spawnJobId) {
    throw new Error('spawn_job_id_required');
  }

  const run = await env.DB.prepare(
    `SELECT id FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(agentRunId)
    .first();
  if (!run?.id) throw new Error(`agent_run_missing:${agentRunId}`);

  const conversationId =
    p.conversation_id != null && String(p.conversation_id).trim()
      ? String(p.conversation_id).trim()
      : null;
  if (conversationId) {
    const cs = await env.DB.prepare(
      `SELECT conversation_id FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
    )
      .bind(conversationId)
      .first();
    if (!cs?.conversation_id) throw new Error(`chat_session_missing:${conversationId}`);
  }

  const status = STATUSES.has(String(p.status || '').trim())
    ? String(p.status).trim()
    : 'proposed';
  const id = `esc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  const meta =
    p.metadata && typeof p.metadata === 'object' ? JSON.stringify(p.metadata) : '{}';

  await env.DB.prepare(
    `INSERT INTO agentsam_escalation (
       id, tenant_id, workspace_id, conversation_id, agent_run_id, parent_escalation_id,
       kind, reason, reason_detail,
       from_route_key, to_route_key, from_model_key, to_model_key,
       spawn_job_id, spawn_session_id, approval_queue_id, child_profile_slug,
       mode, status, router_model_key, confidence, metadata_json, created_at_unix
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      p.workspace_id != null ? String(p.workspace_id).trim() : '',
      conversationId,
      agentRunId,
      p.parent_escalation_id != null ? String(p.parent_escalation_id).trim() || null : null,
      kind,
      reason,
      p.reason_detail != null ? String(p.reason_detail).slice(0, 500) : null,
      p.from_route_key != null ? String(p.from_route_key).trim() || null : null,
      toRoute,
      p.from_model_key != null ? String(p.from_model_key).trim() || null : null,
      p.to_model_key != null ? String(p.to_model_key).trim() || null : null,
      spawnJobId,
      spawnSessionId,
      p.approval_queue_id != null ? String(p.approval_queue_id).trim() || null : null,
      p.child_profile_slug != null ? String(p.child_profile_slug).trim() || null : null,
      mode,
      status,
      p.router_model_key != null ? String(p.router_model_key).trim() || null : null,
      Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
      meta.slice(0, 4000),
      now,
    )
    .run();

  if (p.approval_queue_id) {
    try {
      await env.DB.prepare(
        `UPDATE agentsam_approval_queue SET escalation_id = ? WHERE id = ?`,
      )
        .bind(id, String(p.approval_queue_id).trim())
        .run();
    } catch {
      /* soft link best-effort */
    }
  }

  if (status === 'accepted' || status === 'running') {
    try {
      const { writeEscalationContextDigest } = await import(
        '../../backend/telemetry/escalation-context-digest.js'
      );
      await writeEscalationContextDigest(env, id, { status });
    } catch (e) {
      console.warn('[escalation-decision] context_digest', e?.message ?? e);
    }
  }

  return { ok: true, id, status, mode, to_route_key: toRoute };
}

/**
 * @param {unknown} env
 * @param {string} escalationId
 * @param {{ status: string, error_code?: string|null, error_message?: string|null, latency_ms?: number|null, cost_usd?: number|null }} patch
 */
export async function resolveEscalationDecision(env, escalationId, patch) {
  if (!env?.DB) throw new Error('Database not configured');
  const id = String(escalationId || '').trim();
  const status = String(patch?.status || '').trim();
  if (!id) throw new Error('escalation_id_required');
  if (!STATUSES.has(status)) throw new Error(`escalation_status_invalid:${status}`);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE agentsam_escalation SET
       status = ?,
       error_code = COALESCE(?, error_code),
       error_message = COALESCE(?, error_message),
       latency_ms = COALESCE(?, latency_ms),
       cost_usd = COALESCE(?, cost_usd),
       resolved_at_unix = ?
     WHERE id = ?`,
  )
    .bind(
      status,
      patch.error_code != null ? String(patch.error_code).slice(0, 120) : null,
      patch.error_message != null ? String(patch.error_message).slice(0, 500) : null,
      Number.isFinite(Number(patch.latency_ms)) ? Math.round(Number(patch.latency_ms)) : null,
      Number.isFinite(Number(patch.cost_usd)) ? Number(patch.cost_usd) : null,
      now,
      id,
    )
    .run();

  if (status === 'accepted' || status === 'running') {
    try {
      const { writeEscalationContextDigest } = await import(
        '../../backend/telemetry/escalation-context-digest.js'
      );
      await writeEscalationContextDigest(env, id, { status });
    } catch (e) {
      console.warn('[escalation-decision] context_digest', e?.message ?? e);
    }
  }

  return { ok: true, id, status };
}
