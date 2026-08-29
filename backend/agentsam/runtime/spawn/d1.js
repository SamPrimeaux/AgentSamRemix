/**
 * D1 authority for active Multitask spawn relationships.
 *
 * agentsam_agent_run owns only the child run's execution envelope. Parent/child
 * hierarchy belongs to agentsam_spawn_session and job accounting belongs to
 * agentsam_spawn_job.
 */

import { startAgentRun, finalizeAgentRun, createAgentRunId } from '../../../telemetry/agent-run.js';
import { ensureDefaultSubagentProfile } from '../../subagents/profile-store.js';
import { ensureChatSessionRow } from '../../sessions/index.js';
import {
  startSpawnJobWallClock,
  startSpawnChildTimer,
  stopAllTimersForSpawnJob,
} from './active-timers.js';
import {
  estimateAgentRunCostUsd,
  normalizeCostCapUsd,
  persistCostCapUsd,
  resolveSpawnBudgetStandards,
} from './budget.js';
export {
  estimateAgentRunCostUsd,
  normalizeCostCapUsd,
  resolveSpawnBudgetStandards,
} from './budget.js';
export {
  getSpawnJobRow,
  setSpawnJobMergedOutput,
  setSpawnJobStatus,
  parseSkillMergedOutput,
} from './status.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function normalizeAgentSlug(raw) {
  return trim(raw).toLowerCase().slice(0, 120);
}

/**
 * @param {any} env
 * @param {{ workspaceId: string, tenantId: string, parentRunId: string, childRunId: string, parentSessionId: string, childSessionId: string, rootSessionId?: string|null, fallbackModelKey: string, reason?: string, urgency?: string, depth?: number }} p
 */
export async function createSpawnSessionForChild(env, p) {
  if (!env?.DB) return { ok: false, spawnSessionId: null, reason: 'no_db' };
  const workspaceId = trim(p.workspaceId);
  const tenantId = trim(p.tenantId);
  const parentRunId = trim(p.parentRunId);
  const childRunId = trim(p.childRunId);
  const parentSessionId = trim(p.parentSessionId);
  const childSessionId = trim(p.childSessionId);
  const rootSessionId = trim(p.rootSessionId) || parentSessionId;
  const fallbackModelKey = trim(p.fallbackModelKey);
  if (!workspaceId || !tenantId || !parentRunId || !childRunId) {
    return { ok: false, spawnSessionId: null, reason: 'spawn_session_scope_required' };
  }
  if (!parentSessionId || !childSessionId || !fallbackModelKey) {
    return { ok: false, spawnSessionId: null, reason: 'spawn_session_fields_required' };
  }

  const spawnSessionId = `spawn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const reason = p.reason === 'budget' ? 'budget' : 'context';
  const urgency = p.urgency === 'low' || p.urgency === 'high' ? p.urgency : 'medium';
  const depth = Math.max(1, Math.floor(Number(p.depth) || 1));
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_spawn_session (
         id, workspace_id, tenant_id, parent_run_id, child_run_id,
         parent_session_id, child_session_id, root_session_id,
         fallback_model_key, reason, urgency, depth, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch())`,
    )
      .bind(
        spawnSessionId,
        workspaceId,
        tenantId,
        parentRunId,
        childRunId,
        parentSessionId,
        childSessionId,
        rootSessionId,
        fallbackModelKey.slice(0, 120),
        reason,
        urgency,
        depth,
      )
      .run();
  } catch (error) {
    return { ok: false, spawnSessionId: null, reason: error?.message ?? String(error) };
  }
  return { ok: true, spawnSessionId, reason: null };
}

/**
 * Ensure at least one active subagent profile is available for the workspace.
 *
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null }} scope
 */
export async function ensureSubagentProfilesAvailable(env, scope) {
  if (!env?.DB) return { ok: false, profiles: [], createdDefault: false, reason: 'no_db' };
  const userId = trim(scope.userId);
  const workspaceId = trim(scope.workspaceId);
  const tenantId = trim(scope.tenantId);
  if (!userId || !workspaceId) {
    return { ok: false, profiles: [], createdDefault: false, reason: 'missing_scope' };
  }

  let rows = [];
  try {
    const result = await env.DB.prepare(
      `SELECT *
         FROM agentsam_subagent_profile
        WHERE is_active = 1
          AND (
            (user_id = ? AND COALESCE(workspace_id, '') = ?)
            OR (COALESCE(workspace_id, '') = ? AND COALESCE(is_platform_global, 0) = 0
                AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?))
            OR (COALESCE(is_platform_global, 0) = 1 AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?))
          )
        ORDER BY sort_order ASC
        LIMIT 40`,
    )
      .bind(userId, workspaceId, workspaceId, tenantId, tenantId)
      .all();
    rows = result?.results || [];
  } catch {
    rows = [];
  }
  if (rows.length) return { ok: true, profiles: rows, createdDefault: false, reason: null };

  const provisioned = await ensureDefaultSubagentProfile(env, { userId, workspaceId, tenantId });
  return provisioned.ok
    ? {
        ok: true,
        profiles: provisioned.profiles || [],
        createdDefault: provisioned.createdDefault === true,
        reason: null,
      }
    : {
        ok: false,
        profiles: [],
        createdDefault: false,
        reason: provisioned.reason || 'default_profile_insert_failed',
      };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string, workspaceId: string, tenantId: string, conversationId?: string|null, sessionId?: string|null, mode?: string|null, taskType?: string|null, routingArmId?: string|null, modelKey?: string|null }} p
 */
export async function createMultitaskParentRun(env, ctx, p) {
  if (!env?.DB) return { ok: false, runId: null, reason: 'no_db' };
  const runId = createAgentRunId({ label: 'multitask' });
  const started = await startAgentRun(env, {
    runId,
    userId: p.userId,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    conversationId: p.conversationId ?? p.sessionId ?? null,
    mode: p.mode || 'multitask',
    modelKey: p.modelKey ?? null,
    routingArmId: p.routingArmId ?? null,
    selectedBy: p.selectedBy ?? p.routingStrategy ?? null,
  });
  return started.ok
    ? { ok: true, runId, reason: null }
    : { ok: false, runId: null, reason: started.reason || 'parent_run_start_failed' };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ spawnJobId?: string|null, masterRunId: string, masterAgentSlug: string, userId: string, workspaceId: string, tenantId: string, taskDescription: string, chunkCount: number, orchestratorSlug: string, mergeStrategy: string, costCapUsd?: number|null, conversationId?: string|null, timeoutSeconds?: number|null, personUuid?: string|null, mode?: string|null }} p
 */
export async function createSpawnJob(env, ctx, p) {
  if (!env?.DB) return { ok: false, spawnJobId: null, reason: 'no_db' };
  const spawnJobId = trim(p.spawnJobId) || id('sj');
  const tenantId = trim(p.tenantId);
  const budget = await resolveSpawnBudgetStandards(env, {
    userId: p.userId,
    workspaceId: p.workspaceId,
    masterAgentSlug: p.masterAgentSlug || 'agent-sam',
    costCapUsd: p.costCapUsd,
    timeoutSeconds: p.timeoutSeconds,
  });
  if (!budget.ok) return { ok: false, spawnJobId: null, reason: budget.error };
  const conversationId = trim(p.conversationId) || crypto.randomUUID();
  if (!trim(p.conversationId)) {
    await ensureChatSessionRow(env, {
      conversationId,
      tenantId,
      userId: p.userId,
      workspaceId: p.workspaceId,
      title: `Spawn job ${spawnJobId}`,
    });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_spawn_job (
         id, master_run_id, master_agent_slug, user_id, workspace_id, tenant_id,
         task_description, chunking_strategy, chunk_count, subagent_slug,
         merge_strategy, status, started_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, 'running', datetime('now'))`,
    )
      .bind(
        spawnJobId,
        trim(p.masterRunId),
        trim(p.masterAgentSlug),
        trim(p.userId),
        trim(p.workspaceId),
        tenantId,
        trim(p.taskDescription).slice(0, 4000),
        Math.max(0, Math.floor(Number(p.chunkCount) || 0)),
        trim(p.orchestratorSlug) || trim(p.masterAgentSlug) || 'multitask',
        trim(p.mergeStrategy) || 'concat',
      )
      .run();
    await persistCostCapUsd(env, 'agentsam_spawn_job', spawnJobId, budget.jobCostCapUsd);
    await startSpawnJobWallClock(env, {
      tenant_id: tenantId,
      workspace_id: p.workspaceId,
      user_id: p.userId,
      person_uuid: p.personUuid ?? null,
      spawn_job_id: spawnJobId,
      mode: p.mode || 'multitask',
      conversation_id: conversationId,
      agent_run_id: p.masterRunId,
      label: `spawn_job:${trim(p.orchestratorSlug) || 'fanout'}`,
      duration_seconds: budget.jobTimeoutSeconds,
      metadata: { cost_cap_usd: budget.jobCostCapUsd },
    });
  } catch (error) {
    await env.DB.prepare(`DELETE FROM agentsam_spawn_job WHERE id = ?`)
      .bind(spawnJobId)
      .run()
      .catch(() => {});
    return { ok: false, spawnJobId: null, reason: error?.message ?? String(error) };
  }
  return { ok: true, spawnJobId, conversationId, cost_cap_usd: budget.jobCostCapUsd, reason: null };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ runId: string, modelKey?: string|null, provider?: string|null, routingArmId?: string|null, mode?: string|null }} p
 */
export async function markAgentRunStarted(env, ctx, p) {
  if (!env?.DB || !trim(p.runId)) return { ok: false, reason: 'no_db' };
  const now = unixNow();
  try {
    await env.DB.prepare(
      `UPDATE agentsam_agent_run
          SET status = 'running',
              model_key = COALESCE(?, model_key),
              routing_arm_id = COALESCE(?, routing_arm_id),
              mode = COALESCE(?, mode),
              started_at_unix = COALESCE(started_at_unix, ?),
              updated_at_unix = ?
        WHERE id = ?`,
    )
      .bind(
        trim(p.modelKey) || null,
        trim(p.routingArmId) || null,
        trim(p.mode) || null,
        now,
        now,
        trim(p.runId),
      )
      .run();
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
  return { ok: true, reason: null };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ runId: string, status: string, latencyMs?: number, inputTokens?: number, outputTokens?: number, costUsd?: number, errorMessage?: string|null, modelKey?: string|null, routingArmId?: string|null, mode?: string|null }} p
 */
export async function markAgentRunComplete(env, ctx, p) {
  const row = await env.DB?.prepare(
    `SELECT user_id, tenant_id, workspace_id, conversation_id
       FROM agentsam_agent_run
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(trim(p.runId))
    .first()
    .catch(() => null);
  return finalizeAgentRun(env, {
    runId: p.runId,
    userId: p.userId ?? row?.user_id,
    tenantId: p.tenantId ?? row?.tenant_id,
    workspaceId: p.workspaceId ?? row?.workspace_id,
    conversationId: p.conversationId ?? row?.conversation_id ?? null,
    status: p.status,
    latencyMs: p.latencyMs,
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    costUsd: p.costUsd,
    errorMessage: p.errorMessage,
    modelKey: p.modelKey,
    routingArmId: p.routingArmId,
    mode: p.mode,
  });
}

/**
 * @param {any} env
 * @param {{ spawnJobId: string, ok: boolean, inputTokens?: number, outputTokens?: number, costUsd?: number, latencyMs?: number }} p
 */
export async function bumpSpawnJobAfterChild(env, ctx, p) {
  await reconcileSpawnJobFromChildren(env, p.spawnJobId);
  return { ok: true, reason: null };
}

export async function reconcileSpawnJobFromChildren(env, spawnJobId) {
  const sid = trim(spawnJobId);
  if (!env?.DB || !sid) return { ok: false, reason: 'missing' };
  const job = await env.DB.prepare(
    `SELECT master_run_id FROM agentsam_spawn_job WHERE id = ? LIMIT 1`,
  )
    .bind(sid)
    .first()
    .catch(() => null);
  if (!job?.master_run_id) return { ok: false, reason: 'job_not_found' };

  const aggregate = await env.DB.prepare(
    `SELECT
       COUNT(*) AS spawned,
       SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN r.status IN ('failed', 'cancelled', 'partial') THEN 1 ELSE 0 END) AS failed,
       COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
       COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
       COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
       COALESCE(SUM(r.latency_ms), 0) AS latency_ms
      FROM agentsam_spawn_session s
      JOIN agentsam_agent_run r ON r.id = s.child_run_id
     WHERE s.parent_run_id = ?`,
  )
    .bind(trim(job.master_run_id))
    .first()
    .catch(() => null);
  if (!aggregate) return { ok: false, reason: 'aggregate_failed' };
  try {
    await env.DB.prepare(
      `UPDATE agentsam_spawn_job SET
         subagents_spawned = ?, subagents_succeeded = ?, subagents_failed = ?,
         total_input_tokens = ?, total_output_tokens = ?, total_cost_usd = ?,
         total_latency_ms = ?
       WHERE id = ?`,
    )
      .bind(
        Number(aggregate.spawned) || 0,
        Number(aggregate.succeeded) || 0,
        Number(aggregate.failed) || 0,
        Number(aggregate.input_tokens) || 0,
        Number(aggregate.output_tokens) || 0,
        Number(aggregate.cost_usd) || 0,
        Number(aggregate.latency_ms) || 0,
        sid,
      )
      .run();
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
  return {
    ok: true,
    spawned: Number(aggregate.spawned) || 0,
    succeeded: Number(aggregate.succeeded) || 0,
    failed: Number(aggregate.failed) || 0,
    total_cost_usd: Number(aggregate.cost_usd) || 0,
  };
}

export async function finalizeSpawnJob(env, ctx, p) {
  const sid = trim(p.spawnJobId);
  if (!env?.DB || !sid) return { ok: false, reason: 'no_db' };
  const reconciled = await reconcileSpawnJobFromChildren(env, sid);
  const failed = Number(reconciled?.failed ?? p.subagentsFailed) || 0;
  const succeeded = Number(reconciled?.succeeded ?? p.subagentsSucceeded) || 0;
  const status = failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed';
  try {
    await env.DB.prepare(
      `UPDATE agentsam_spawn_job
          SET status = ?, merged_output = ?, completed_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(status, trim(p.mergedOutput).slice(0, 120000), sid)
      .run();
    await stopAllTimersForSpawnJob(env, sid, status === 'failed' ? 'cancelled' : 'completed');
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
  return { ok: true, status, total_cost_usd: reconciled?.total_cost_usd ?? null, reason: null };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ parentRunId: string, userId: string, workspaceId: string, tenantId: string, conversationId?: string|null, sessionId?: string|null, subagentSlug: string, taskType?: string|null, spawnJobId: string, mode?: string|null, costCapUsd?: number|null, timeoutSeconds?: number|null, modelKey?: string|null, personUuid?: string|null }} p
 */
export async function createChildRun(env, ctx, p) {
  if (!env?.DB) return { ok: false, runId: null, reason: 'no_db' };
  const spawnJobId = trim(p.spawnJobId);
  const tenantId = trim(p.tenantId);
  const userId = trim(p.userId);
  const workspaceId = trim(p.workspaceId);
  const parentRunId = trim(p.parentRunId);
  if (!spawnJobId || !tenantId || !userId || !workspaceId || !parentRunId) {
    return { ok: false, runId: null, reason: 'child_scope_required' };
  }

  const budget = await resolveSpawnBudgetStandards(env, {
    userId,
    workspaceId,
    laneCostCapUsd: p.costCapUsd,
    timeoutSeconds: p.timeoutSeconds,
    masterAgentSlug: p.subagentSlug,
  });
  if (!budget.ok) return { ok: false, runId: null, reason: budget.error };

  const runId = createAgentRunId({ label: 'child' });
  const conversationId = crypto.randomUUID();
  await ensureChatSessionRow(env, {
    conversationId,
    tenantId,
    userId,
    workspaceId,
    title: `Child: ${normalizeAgentSlug(p.subagentSlug) || runId}`,
    parentConversationId: trim(p.conversationId) || trim(p.sessionId) || null,
  }).catch((error) => {
    throw new Error(`chat_session_failed:${error?.message ?? error}`);
  });

  const started = await startAgentRun(env, {
    runId,
    userId,
    tenantId,
    workspaceId,
    conversationId,
    mode: p.mode || 'agent',
    modelKey: p.modelKey ?? null,
    selectedBy: 'manual',
  });
  if (!started.ok) return { ok: false, runId: null, conversationId, reason: started.reason };
  const spawnSession = await createSpawnSessionForChild(env, {
    workspaceId,
    tenantId,
    parentRunId,
    childRunId: runId,
    parentSessionId: trim(p.conversationId) || trim(p.sessionId) || conversationId,
    childSessionId: conversationId,
    rootSessionId: trim(p.conversationId) || trim(p.sessionId) || conversationId,
    fallbackModelKey: trim(p.modelKey) || normalizeAgentSlug(p.subagentSlug) || 'agent',
  });
  if (!spawnSession.ok) {
    await env.DB.prepare(`DELETE FROM agentsam_agent_run WHERE id = ?`).bind(runId).run().catch(() => {});
    return { ok: false, runId: null, conversationId, reason: `spawn_session_failed:${spawnSession.reason}` };
  }

  try {
    await startSpawnChildTimer(env, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      person_uuid: p.personUuid ?? null,
      spawn_job_id: spawnJobId,
      spawn_session_id: spawnSession.spawnSessionId,
      agent_run_id: runId,
      mode: p.mode || 'agent',
      conversation_id: conversationId,
      label: `child:${normalizeAgentSlug(p.subagentSlug) || runId}`,
      duration_seconds: budget.laneTimeoutSeconds,
      metadata: { cost_cap_usd: budget.laneCostCapUsd, model_key: p.modelKey ?? null },
    });
  } catch (error) {
    await env.DB.prepare(`DELETE FROM agentsam_spawn_session WHERE id = ?`)
      .bind(spawnSession.spawnSessionId)
      .run()
      .catch(() => {});
    await env.DB.prepare(`DELETE FROM agentsam_agent_run WHERE id = ?`).bind(runId).run().catch(() => {});
    return { ok: false, runId: null, conversationId, reason: `child_timer_failed:${error?.message ?? error}` };
  }

  return {
    ok: true,
    runId,
    conversationId,
    parentConversationId: trim(p.conversationId) || trim(p.sessionId) || null,
    spawnSessionId: spawnSession.spawnSessionId,
    agent_id: normalizeAgentSlug(p.subagentSlug) || null,
    model_key: p.modelKey ?? null,
    timer: true,
    reason: null,
  };
}
