/**
 * Dynamic handoff: checkpoint expensive agent runs and resume on a cheaper model + fresh DO session.
 */
import { sha256Hex } from './cms-theme-hashing.js';
import { estimateModelRunCostUsd } from '../../backend/telemetry/model-pricing.js';
import { createAgentRunId, startAgentRun } from '../../backend/telemetry/agent-run.js';
import { resolveRoutingArmByModelKey } from '../../backend/agentsam/runtime/routing/routing.js';
import { resolveModelMeta } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';
import { checkBudgetPressure } from './budget-sentinel.js';
import {
  buildHandoffContextDigest,
  extractRemainingGoal,
} from './handoff-context.js';

export { buildHandoffContextDigest, buildHandoffPrimingUserMessage } from './handoff-context.js';

const MAX_HANDOFF_DEPTH = 4;

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} digestText
 * @param {{
 *   digestType?: string,
 *   generationModel?: string | null,
 *   sourceMaterial?: string,
 *   sessionId?: string|null,
 *   nextSessionId?: string|null,
 *   parentRunId?: string|null,
 *   escalationId?: string|null,
 *   tenantId?: string|null,
 * }} [opts]
 */
export async function upsertHandoffContextDigest(env, workspaceId, digestText, opts = {}) {
  if (!env?.DB || !workspaceId || !digestText) return null;
  const digestType = opts.digestType != null ? String(opts.digestType) : 'handoff';
  const sourceMaterial = opts.sourceMaterial != null ? String(opts.sourceMaterial) : digestText;
  const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  try {
    const { upsertContextDigest } = await import(
      '../../backend/services/bootstrap/context-digest.js'
    );
    const row = await upsertContextDigest(env, {
      workspaceId: String(workspaceId),
      digestType,
      digestText: String(digestText),
      sourceMaterial,
      sessionId: opts.sessionId,
      nextSessionId: opts.nextSessionId,
      parentRunId: opts.parentRunId,
      escalationId: opts.escalationId,
      generationModel: opts.generationModel ?? null,
      namespace: 'agent_handoff',
      sourceUpdatedAtUnix: Math.floor(Date.now() / 1000),
    });
    return row?.id ?? null;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[agent-handoff] context_digest_upsert', msg);
    if (tenantId) {
      const { writeAgentsamErrorLog } = await import('../../backend/telemetry/error-log.js');
      await writeAgentsamErrorLog(env, {
        workspaceId: String(workspaceId),
        tenantId,
        sessionId: opts.sessionId ?? null,
        errorType: 'context_digest_upsert_failed',
        errorCode: 'handoff_digest_write',
        errorMessage: msg.slice(0, 2000),
        source: 'agent_handoff',
        sourceId: opts.parentRunId ?? opts.escalationId ?? null,
        contextJson: JSON.stringify({
          digest_type: digestType,
          escalation_id: opts.escalationId ?? null,
        }),
      });
    }
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} runId
 * @param {{ inputTokens?: number, outputTokens?: number, cachedInputTokens?: number, cacheReadTokens?: number, costUsd?: number, status?: string }} p
 */
export async function patchAgentRunBudgetProgress(env, runId, p = {}) {
  if (!env?.DB || !runId) return;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  const sets = [];
  const binds = [];
  const push = (col, val) => {
    if (!cols.has(col)) return;
    sets.push(`${col} = ?`);
    binds.push(val);
  };
  push('input_tokens', Math.max(0, Math.floor(Number(p.inputTokens) || 0)));
  push('output_tokens', Math.max(0, Math.floor(Number(p.outputTokens) || 0)));
  const cached = Math.max(
    0,
    Math.floor(Number(p.cachedInputTokens ?? p.cacheReadTokens) || 0),
  );
  push('cached_input_tokens', cached);
  push('cost_usd', Number(p.costUsd) || 0);
  push('status', p.status != null ? String(p.status) : 'running');
  if (!sets.length) return;
  binds.push(String(runId));
  try {
    await env.DB.prepare(`UPDATE agentsam_agent_run SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    console.warn('[agent-handoff] patch_run_progress', e?.message ?? e);
  }
}

/**
 * Resolve routing arm + catalog meta and evaluate handoff pressure.
 * @param {any} env
 * @param {{
 *   modelKey: string,
 *   workspaceId: string,
 *   taskType?: string,
 *   mode?: string,
 *   agentSlug?: string | null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   cacheReadTokens?: number,
 * }} p
 */
export async function evaluateAgentHandoffPressure(env, p) {
  const modelKey = p.modelKey != null ? String(p.modelKey).trim() : '';
  if (!env?.DB || !modelKey) {
    return { shouldHandoff: false, reason: null, arm: null, fallbackModelKey: null, pressure: null, runCostUsd: 0, contextWindow: 0 };
  }

  const armLookup = await resolveRoutingArmByModelKey(env, {
    modelKey,
    taskType: p.taskType ?? 'ask',
    mode: p.mode ?? 'agent',
    workspaceId: p.workspaceId ?? '',
    agentSlug: p.agentSlug ?? null,
  });
  const arm = armLookup?.arm ?? null;
  const meta = await resolveModelMeta(env, modelKey);
  const contextWindow =
    Number(meta?.context_window) ||
    Number(meta?.context_max_tokens) ||
    Number(meta?.output_max_tokens) ||
    128000;

  const inputTokens = Math.max(0, Math.floor(Number(p.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(p.outputTokens) || 0));
  const cacheRead = Math.max(0, Math.floor(Number(p.cacheReadTokens) || 0));

  let runCostUsd = 0;
  try {
    const priced = await estimateModelRunCostUsd(env.DB, {
      modelKey,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
    });
    runCostUsd = Number(priced?.costUsd) || 0;
  } catch {
    runCostUsd = 0;
  }

  const maxCost = arm?.max_cost_per_call_usd != null ? Number(arm.max_cost_per_call_usd) : 0;
  const pressure = checkBudgetPressure({
    runCostUsd,
    maxCostPerCallUsd: maxCost,
    inputTokens,
    contextWindow,
  });

  const fallbackModelKey =
    arm?.fallback_model_key != null && String(arm.fallback_model_key).trim() !== ''
      ? String(arm.fallback_model_key).trim()
      : null;

  const shouldHandoff =
    pressure.shouldHandoff &&
    fallbackModelKey &&
    fallbackModelKey !== modelKey;

  return {
    shouldHandoff,
    reason: shouldHandoff ? pressure.reason : null,
    urgency: pressure.urgency,
    pressure,
    arm,
    armId: armLookup?.armId ?? null,
    fallbackModelKey: shouldHandoff ? fallbackModelKey : null,
    runCostUsd,
    contextWindow,
  };
}

/**
 * Write spawn row + digest; mint child session ids for dashboard reconnect.
 * @param {any} env
 * @param {{
 *   parentRunId: string,
 *   parentSlug: string,
 *   fallbackModelKey: string,
 *   workspaceId: string,
 *   parentSessionId: string,
 *   rootSessionId?: string,
 *   reason?: 'budget' | 'context',
 *   urgency?: 'low' | 'medium' | 'high',
 *   goal?: string,
 *   messages?: unknown[],
 *   executedToolNames?: string[],
 *   triggeredBy?: string,
 *   depth?: number,
 *   userId?: string | null,
 *   tenantId?: string | null,
 * }} p
 */
export async function initiateHandoff(env, p) {
  const parentRunId = String(p.parentRunId || '').trim();
  const parentSlug = String(p.parentSlug || '').trim();
  const childSlug = String(p.fallbackModelKey || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  const parentSessionId = String(p.parentSessionId || '').trim();
  const tenantId = String(p.tenantId || '').trim();
  if (!env?.DB || !parentRunId || !parentSlug || !childSlug || !workspaceId || !parentSessionId || !tenantId) {
    throw new Error('initiateHandoff: missing required fields');
  }

  const depth = Math.max(1, Math.min(MAX_HANDOFF_DEPTH, Number(p.depth) || 1));
  const rootSessionId = String(p.rootSessionId || parentSessionId).trim();
  const reason = p.reason === 'context' || p.triggeredBy === 'context' ? 'context' : 'budget';
  const urgency =
    p.urgency === 'low' || p.urgency === 'high' || p.urgency === 'medium' ? p.urgency : 'medium';
  const remainingGoal = extractRemainingGoal(p.messages) || String(p.goal || '').trim();
  const digestText = buildHandoffContextDigest({
    goal: remainingGoal,
    messages: p.messages,
    executedToolNames: p.executedToolNames,
    triggeredBy: p.triggeredBy ?? reason,
    parentModelKey: parentSlug,
    childModelKey: childSlug,
  });

  const childSessionId = crypto.randomUUID();
  const childRunId = createAgentRunId({ label: 'handoff' });
  const spawnId = `spawn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const userId = p.userId != null ? String(p.userId).trim() : '';
  if (!userId) throw new Error('handoff_user_id_required');

  const { ensureChatSessionRow } = await import('../../backend/agentsam/sessions/index.js');
  // child_session_id FK → agentsam_chat_sessions.conversation_id (migration 1124)
  await ensureChatSessionRow(env, {
    conversationId: childSessionId,
    tenantId,
    userId,
    workspaceId,
    title: 'Handoff session',
    parentConversationId: parentSessionId,
  });
  // Parent session must exist for spawn_session.parent_session_id annotate; soft ensure.
  try {
    await ensureChatSessionRow(env, {
      conversationId: parentSessionId,
      tenantId,
      userId,
      workspaceId,
      title: 'Parent session',
    });
  } catch {
    /* parent may already exist under another tenant scope — child FK is the hard gate */
  }

  const digestId = await upsertHandoffContextDigest(env, workspaceId, digestText, {
    digestType: 'handoff',
    generationModel: parentSlug,
    sessionId: parentSessionId,
    nextSessionId: childSessionId,
    parentRunId,
    tenantId,
    sourceMaterial: JSON.stringify({
      parent_run_id: parentRunId,
      goal: remainingGoal,
      tools: p.executedToolNames ?? [],
    }),
  });

  await env.DB.prepare(
    `INSERT INTO agentsam_spawn_session (
       id, workspace_id, tenant_id, parent_run_id, child_run_id,
       parent_session_id, child_session_id, root_session_id,
       fallback_model_key, reason, urgency, depth, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch())`,
  )
    .bind(
      spawnId,
      workspaceId,
      tenantId,
      parentRunId,
      childRunId,
      parentSessionId,
      childSessionId,
      rootSessionId,
      childSlug,
      reason,
      urgency,
      depth,
    )
    .run();

  const childRun = await startAgentRun(env, {
    runId: childRunId, userId, workspaceId, tenantId, conversationId: childSessionId,
    mode: 'agent', modelKey: childSlug, selectedBy: 'fallback',
  });
  if (!childRun.ok) throw new Error(`handoff_agent_run_start_failed:${childRun.reason}`);

  return {
    spawnId,
    childSessionId,
    childRunId,
    digestId,
    digestText,
    remainingGoal,
    fallbackModelKey: childSlug,
    rootSessionId,
    reason,
    urgency,
    depth,
  };
}

/**
 * @param {string} digestText
 */
function parseRemainingGoalFromDigest(digestText) {
  const match = String(digestText || '').match(/^remaining_goal:\s*(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

/**
 * Pending handoff for a child session reconnect.
 * @param {any} env
 * @param {{ sessionId?: string | null, workspaceId?: string | null }} p
 */
export async function resolvePendingHandoffForSession(env, p) {
  const sessionId = p.sessionId != null ? String(p.sessionId).trim() : '';
  const workspaceId = p.workspaceId != null ? String(p.workspaceId).trim() : '';
  if (!env?.DB || !sessionId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, parent_run_id, child_run_id, parent_session_id, child_session_id,
              root_session_id, fallback_model_key, reason, urgency, depth, status, workspace_id
       FROM agentsam_spawn_session
       WHERE status = 'pending' AND child_session_id = ?
       ${workspaceId ? 'AND workspace_id = ?' : ''}
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(...(workspaceId ? [sessionId, workspaceId] : [sessionId]))
      .first();
    if (!row?.id) return null;

    let contextDigest = '';
    let remainingGoal = '';
    const digestSessionId =
      row.parent_session_id != null ? String(row.parent_session_id) : sessionId;
    const digestRow = await env.DB.prepare(
      `SELECT digest_text FROM agentsam_context_digest
       WHERE session_id = ? AND digest_type = 'handoff'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(digestSessionId)
      .first()
      .catch(() => null);
    if (digestRow?.digest_text) {
      contextDigest = String(digestRow.digest_text);
      remainingGoal = parseRemainingGoalFromDigest(contextDigest);
    }

    return {
      spawnId: String(row.id),
      parentRunId: row.parent_run_id != null ? String(row.parent_run_id) : null,
      childRunId: row.child_run_id != null ? String(row.child_run_id) : null,
      parentSessionId: row.parent_session_id != null ? String(row.parent_session_id) : null,
      rootSessionId: row.root_session_id != null ? String(row.root_session_id) : null,
      parentSlug: null,
      childSlug: row.fallback_model_key != null ? String(row.fallback_model_key) : null,
      depth: Number(row.depth) || 1,
      reason: row.reason != null ? String(row.reason) : null,
      urgency: row.urgency != null ? String(row.urgency) : null,
      contextDigest,
      remainingGoal,
      fallbackModelKey:
        row.fallback_model_key != null ? String(row.fallback_model_key) : null,
    };
  } catch (e) {
    console.warn('[agent-handoff] resolve_pending', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} spawnId
 * @param {{ childRunId?: string | null }} [opts]
 */
export async function markHandoffAccepted(env, spawnId, opts = {}) {
  if (!env?.DB || !spawnId) return;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_spawn_session');
  const sets = [`status = 'accepted'`];
  const binds = [];
  if (cols.has('accepted_at')) {
    sets.push('accepted_at = unixepoch()');
  } else if (cols.has('completed_at')) {
    sets.push('completed_at = unixepoch()');
  }
  if (opts.childRunId && cols.has('child_run_id')) {
    sets.push('child_run_id = ?');
    binds.push(String(opts.childRunId));
  }
  binds.push(String(spawnId));
  try {
    await env.DB.prepare(
      `UPDATE agentsam_spawn_session SET ${sets.join(', ')} WHERE id = ? AND status = 'pending'`,
    )
      .bind(...binds)
      .run();
  } catch (e) {
    console.warn('[agent-handoff] mark_accepted', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Function} emit
 * @param {Function} safeDone
 * @param {Record<string, unknown>} p
 */
export async function executeAgentHandoffFromLoop(env, ctx, emit, safeDone, p) {
  if ((Number(p.handoffDepth) || 0) >= MAX_HANDOFF_DEPTH) {
    return null;
  }

  const evaluation = await evaluateAgentHandoffPressure(env, {
    modelKey: p.modelKey,
    workspaceId: p.workspaceId,
    taskType: p.routingTaskType,
    mode: p.mode,
    agentSlug: p.agentSlug,
    inputTokens: p.totalUsage?.input_tokens,
    outputTokens: p.totalUsage?.output_tokens,
    cacheReadTokens: p.totalUsage?.cache_read_input_tokens,
  });

  if (!evaluation.shouldHandoff || !evaluation.fallbackModelKey) {
    return null;
  }

  const handoff = await initiateHandoff(env, {
    parentRunId: String(p.chatAgentRunId),
    parentSlug: String(p.modelKey),
    fallbackModelKey: evaluation.fallbackModelKey,
    workspaceId: String(p.workspaceId),
    parentSessionId: String(p.sessionId || ''),
    rootSessionId: p.rootSessionId != null ? String(p.rootSessionId) : String(p.sessionId || ''),
    reason: evaluation.reason === 'context' ? 'context' : 'budget',
    urgency: evaluation.urgency,
    goal: p.goal,
    messages: p.conversationMessages,
    executedToolNames: p.executedToolNames,
    triggeredBy: evaluation.reason ?? 'budget',
    depth: (Number(p.handoffDepth) || 0) + 1,
    userId: p.userId,
    tenantId: p.tenantId,
  });

  await patchAgentRunBudgetProgress(env, String(p.chatAgentRunId), {
    inputTokens: p.totalUsage?.input_tokens,
    outputTokens: p.totalUsage?.output_tokens,
    costUsd: evaluation.runCostUsd,
    status: 'handoff',
  });

  emit('handoff', {
    type: 'handoff',
    reason: evaluation.reason,
    urgency: evaluation.urgency,
    parent_run_id: p.chatAgentRunId,
    parent_model_key: p.modelKey,
    fallback_model_key: handoff.fallbackModelKey,
    next_session_id: handoff.childSessionId,
    child_run_id: handoff.childRunId,
    spawn_id: handoff.spawnId,
    digest_id: handoff.digestId,
  });

  emit('text', {
    text: `\n\n---\nHanding off to **${handoff.fallbackModelKey}** (${evaluation.reason} pressure). Resuming in a fresh session…\n`,
  });

  safeDone({
    tool_calls_used: p.toolCallsUsed ?? 0,
    turns: p.turnCount ?? 0,
    handoff: true,
    next_session_id: handoff.childSessionId,
  });

  console.log(
    '[agent-handoff] initiated',
    JSON.stringify({
      parent_run_id: p.chatAgentRunId,
      spawn_id: handoff.spawnId,
      reason: evaluation.reason,
      from: p.modelKey,
      to: handoff.fallbackModelKey,
      budget_pressure: evaluation.pressure?.budgetPressure,
      context_pressure: evaluation.pressure?.contextPressure,
    }),
  );

  return {
    handoff: true,
    spawnId: handoff.spawnId,
    childSessionId: handoff.childSessionId,
    childRunId: handoff.childRunId,
    fallbackModelKey: handoff.fallbackModelKey,
    totalUsage: p.totalUsage,
    toolCallsUsed: p.toolCallsUsed,
    executedToolNames: p.executedToolNames,
    modelKey: p.modelKey,
    turnCount: p.turnCount,
    timedOut: false,
    workflowRunId: null,
    agentRunId: p.chatAgentRunId != null ? String(p.chatAgentRunId) : null,
    chainRootId: p.toolChainRootId ?? null,
  };
}
