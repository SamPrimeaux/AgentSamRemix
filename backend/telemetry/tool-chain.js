/**
 * Lean agentsam_tool_chain row writer (call index only — no JSON payloads).
 */
import { resolveCanonicalUserId } from '../identity/users/index.js';
import { scheduleAgentsamErrorLog } from './error-log.js';
import { normalizeToolChainParentId, resolveToolChainOutcome } from './tool-chain-outcome.js';

/**
 * Fire-and-forget lean agentsam_tool_chain row.
 * Rejects workflow:* tool keys (webhook/workflow ledgers live elsewhere).
 * @param {any} env
 * @param {Record<string, unknown>} opts
 * @returns {Promise<string|null>} chain id
 */
export async function fireForgetAgentToolChainRow(env, opts) {
  const {
    error,
    durationMs,
    tenantId = null,
    userId = null,
    ctx = null,
    agentRunId = null,
    agent_run_id = null,
    conversationId = null,
    conversation_id = null,
    routingArmId = null,
    routing_arm_id = null,
  } = opts || {};
  if (!env?.DB) return null;

  const ws =
    opts?.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : '';
  const tenant =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : '';
  const toolKey = String(
    opts?.toolKey ?? opts?.tool_key ?? opts?.toolName ?? opts?.tool_name ?? '',
  ).trim();
  if (!ws || !tenant || !toolKey) return null;
  if (toolKey.startsWith('workflow:')) return null;

  let uid =
    userId != null && String(userId).trim() !== '' ? String(userId).trim() : '';
  if (!uid) return null;
  uid = await resolveCanonicalUserId(uid, env);
  if (!uid) return null;

  const completedAt = Math.floor(Date.now() / 1000);
  const durMs = Math.max(0, Math.floor(Number(durationMs) || 0));
  const startedAt = Math.max(0, completedAt - Math.max(0, Math.ceil(durMs / 1000)));
  const toolStatus = error ? 'failed' : 'completed';
  const explicitId = normalizeToolChainParentId(opts?.chainId ?? opts?.chain_id ?? null);
  const chainId = explicitId || `atc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const parentChainId = normalizeToolChainParentId(
    opts?.parentChainId ?? opts?.parent_chain_id ?? null,
  );
  const arId =
    (agentRunId ?? agent_run_id) != null && String(agentRunId ?? agent_run_id).trim() !== ''
      ? String(agentRunId ?? agent_run_id).trim()
      : null;
  const convId =
    (conversationId ?? conversation_id) != null &&
    String(conversationId ?? conversation_id).trim() !== ''
      ? String(conversationId ?? conversation_id).trim()
      : null;
  const armId =
    (routingArmId ?? routing_arm_id) != null &&
    String(routingArmId ?? routing_arm_id).trim() !== ''
      ? String(routingArmId ?? routing_arm_id).trim()
      : null;
  const modelKey =
    opts?.modelKey != null && String(opts.modelKey).trim() !== ''
      ? String(opts.modelKey).trim().slice(0, 200)
      : opts?.model_key != null && String(opts.model_key).trim() !== ''
        ? String(opts.model_key).trim().slice(0, 200)
        : null;

  const { outcome, outcome_reason: outcomeReason } = resolveToolChainOutcome({
    execErr: error,
    ok: opts?.ok,
    body: opts?.resultJson ?? opts?.body ?? opts?.toolOutput ?? null,
    nestedOutcomes: opts?.nestedOutcomes ?? null,
  });

  const errorMessage =
    error != null ? String(error?.message ?? error).slice(0, 8000) : null;

  const p = env.DB.prepare(
    `INSERT INTO agentsam_tool_chain
      (id, workspace_id, tenant_id, user_id, tool_key, tool_status,
       agent_run_id, conversation_id, routing_arm_id, model_key,
       parent_chain_id,
       outcome, outcome_reason,
       started_at, completed_at, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      chainId,
      ws,
      tenant,
      uid,
      toolKey,
      toolStatus,
      arId,
      convId,
      armId,
      modelKey,
      parentChainId,
      outcome,
      outcomeReason,
      startedAt,
      completedAt,
      durMs,
    )
    .run()
    .then(() => {
      if (!error || !ctx || typeof ctx.waitUntil !== 'function') return;
      scheduleAgentsamErrorLog(env, ctx, {
        workspaceId: ws,
        tenantId: tenant,
        sessionId: convId,
        errorCode: 'tool_chain_failed',
        errorType: 'tool_execution',
        errorMessage: errorMessage || 'tool_execution_failed',
        source: 'agentsam_tool_chain',
        sourceId: chainId,
        contextJson: JSON.stringify({ tool_key: toolKey }),
      });
    })
    .catch((e) => console.warn('[agentsam_tool_chain]', e?.message ?? e));

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  else void p;

  return chainId;
}
