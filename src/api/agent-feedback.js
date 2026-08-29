/**
 * POST /api/agent/feedback — thumbs up/down → deduped reward event (never rewrites experience).
 */
import { jsonResponse, getAuthUser } from '../core/auth.js';
import { applyRewardEvent, resolveTenantIdForReward } from '../core/reward-events.js';
import { tableExists } from '../../backend/services/retention.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function feedbackId() {
  return `afb_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleAgentFeedback(request, env) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  const user = await getAuthUser(request, env);
  if (!user) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  if (!env?.DB) return jsonResponse({ ok: false, error: 'db_not_configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const agentRunId = trim(body.agent_run_id || body.agentRunId);
  const feedbackType = trim(body.feedback_type || body.type).toLowerCase();
  if (!agentRunId) return jsonResponse({ ok: false, error: 'agent_run_id_required' }, 400);
  if (feedbackType !== 'thumbs_up' && feedbackType !== 'thumbs_down') {
    return jsonResponse({ ok: false, error: 'feedback_type_invalid' }, 400);
  }

  const userId = trim(user.id || user.user_id);
  const workspaceId = trim(user.active_workspace_id || user.workspace_id || body.workspace_id);
  let tenantId = trim(user.active_tenant_id || user.tenant_id);
  if (!tenantId && workspaceId) {
    tenantId = (await resolveTenantIdForReward(env, { workspaceId })) || '';
  }
  if (!tenantId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'scope_required' }, 400);
  }

  const dedupKey = `feedback:${agentRunId}:${userId}:${feedbackType}`;
  if (await tableExists(env.DB, 'agentsam_agent_feedback')) {
    const prior = await env.DB.prepare(
      `SELECT id FROM agentsam_agent_feedback WHERE dedup_key = ? LIMIT 1`,
    )
      .bind(dedupKey)
      .first()
      .catch(() => null);
    if (prior?.id) {
      return jsonResponse({ ok: true, status: 'duplicate', feedback_id: prior.id });
    }
  }

  const run = await env.DB.prepare(
    `SELECT routing_arm_id, task_type, model_key, provider FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(agentRunId)
    .first()
    .catch(() => null);

  const signalType = feedbackType === 'thumbs_up' ? 'user_thumbs_up' : 'user_thumbs_down';
  const rewardOut = await applyRewardEvent(env, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    task_type: trim(run?.task_type) || 'ask',
    signal_type: signalType,
    signal_value: 1,
    signal_source: 'user',
    routing_arm_id: trim(run?.routing_arm_id) || null,
    model_key: trim(run?.model_key) || null,
    provider: trim(run?.provider) || null,
    apply_execution: true,
    agent_run_id: agentRunId,
    dedup_key: dedupKey,
    reason: 'user_feedback',
  });

  const id = feedbackId();
  if (await tableExists(env.DB, 'agentsam_agent_feedback')) {
    await env.DB.prepare(
      `INSERT INTO agentsam_agent_feedback (
         id, agent_run_id, tenant_id, workspace_id, user_id, feedback_type, dedup_key, reward_event_id, created_at_unix
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
      .bind(
        id,
        agentRunId,
        tenantId,
        workspaceId,
        userId,
        feedbackType,
        dedupKey,
        rewardOut?.event_id ?? null,
      )
      .run()
      .catch(() => {});
  }

  return jsonResponse({
    ok: true,
    feedback_id: id,
    reward: rewardOut,
  });
}
