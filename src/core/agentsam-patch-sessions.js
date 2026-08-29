/**
 * Canonical writers for agentsam_patch_sessions — links to agentsam_agent_run.id + change_sets.
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

export function newAgentsamPatchSessionId() {
  return `ps_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * @param {any} env
 * @param {string|null|undefined} agentRunId
 */
async function resolveModelFromAgentRun(env, agentRunId) {
  const rid = agentRunId != null ? String(agentRunId).trim() : '';
  if (!rid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ai_model_ref, model_id FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
    )
      .bind(rid)
      .first();
    const mk =
      row?.ai_model_ref != null && String(row.ai_model_ref).trim() !== ''
        ? String(row.ai_model_ref).trim()
        : row?.model_id != null && String(row.model_id).trim() !== ''
          ? String(row.model_id).trim()
          : null;
    return mk;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   agentRunId?: string | null,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   conversationId?: string | null,
 *   changeSetId?: string | null,
 *   planId?: string | null,
 *   taskFile: string,
 *   modelKey?: string | null,
 *   provider?: string | null,
 *   passed?: boolean | number,
 *   applied?: boolean | number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   costUsd?: number,
 *   latencyMs?: number,
 *   failReason?: string | null,
 * }} p
 * @returns {Promise<string|null>}
 */
export async function scheduleAgentsamPatchSessionInsert(env, ctx, p) {
  if (!env?.DB) return null;
  const taskFile = p.taskFile != null ? String(p.taskFile).trim().slice(0, 200) : '';
  if (!taskFile) return null;

  const agentRunId = p.agentRunId != null ? String(p.agentRunId).trim().slice(0, 120) : null;
  const planId =
    p.planId != null && String(p.planId).trim() !== ''
      ? String(p.planId).trim().slice(0, 120)
      : agentRunId || (p.changeSetId != null ? String(p.changeSetId).trim().slice(0, 120) : null);
  if (!planId) return null;

  const run = async () => {
    const cols = await pragmaTableInfo(env.DB, 'agentsam_patch_sessions');
    if (!cols.size) return null;

    const id = newAgentsamPatchSessionId();
    const now = Math.floor(Date.now() / 1000);
    let modelUsed =
      p.modelKey != null && String(p.modelKey).trim() !== '' ? String(p.modelKey).trim().slice(0, 80) : null;
    if (!modelUsed && agentRunId) {
      modelUsed = (await resolveModelFromAgentRun(env, agentRunId)) || 'agentsam_agent_run';
    }
    if (!modelUsed) modelUsed = 'unknown';

    const parts = [];
    const binds = [];
    const add = (name, val) => {
      if (!cols.has(name)) return;
      parts.push(name);
      binds.push(val);
    };

    add('id', id);
    add('session_ts', now);
    add('plan_id', planId);
    add('task_file', taskFile);
    add('model_used', modelUsed);
    add('provider', String(p.provider || 'agent_sam').slice(0, 80));
    add('passed', p.passed ? 1 : 0);
    add('applied', p.applied ? 1 : 0);
    add('tok_in', Math.max(0, Math.floor(Number(p.inputTokens) || 0)));
    add('tok_out', Math.max(0, Math.floor(Number(p.outputTokens) || 0)));
    add('cost_usd', Number(p.costUsd) || 0);
    add('latency_ms', Math.max(0, Math.floor(Number(p.latencyMs) || 0)));
    add('fail_reason', p.failReason != null ? String(p.failReason).slice(0, 500) : null);
    add('agent_run_id', agentRunId);
    add('workspace_id', p.workspaceId != null ? String(p.workspaceId).trim().slice(0, 120) : null);
    add('tenant_id', p.tenantId != null ? String(p.tenantId).trim().slice(0, 120) : null);
    add('change_set_id', p.changeSetId != null ? String(p.changeSetId).trim().slice(0, 120) : null);
    add('conversation_id', p.conversationId != null ? String(p.conversationId).trim().slice(0, 200) : null);
    if (cols.has('created_at')) {
      parts.push('created_at');
      binds.push(now);
    }

    if (parts.length < 5) return null;

    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_patch_sessions (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
      )
        .bind(...binds)
        .run();
      return id;
    } catch (e) {
      console.warn('[agentsam_patch_sessions] insert', e?.message ?? e);
      return null;
    }
  };

  if (ctx?.waitUntil) {
    let out = null;
    ctx.waitUntil(run().then((id) => { out = id; }));
    return out;
  }
  return run();
}

/**
 * Finalize the patch session row for a change_set (proposed → accepted/rejected/failed).
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   changeSetId: string,
 *   passed?: boolean,
 *   applied?: boolean,
 *   failReason?: string | null,
 *   latencyMs?: number,
 * }} p
 */
export async function finalizeAgentsamPatchSessionForChangeSet(env, ctx, p) {
  if (!env?.DB) return;
  const changeSetId = p.changeSetId != null ? String(p.changeSetId).trim() : '';
  if (!changeSetId) return;

  const run = async () => {
    const cols = await pragmaTableInfo(env.DB, 'agentsam_patch_sessions');
    if (!cols.size || !cols.has('change_set_id')) return;

    const sets = [];
    const binds = [];
    const push = (name, val) => {
      if (!cols.has(name)) return;
      sets.push(`${name} = ?`);
      binds.push(val);
    };

    push('passed', p.passed ? 1 : 0);
    push('applied', p.applied ? 1 : 0);
    if (p.failReason !== undefined) {
      push('fail_reason', p.failReason != null ? String(p.failReason).slice(0, 500) : null);
    }
    if (p.latencyMs != null && cols.has('latency_ms')) {
      push('latency_ms', Math.max(0, Math.floor(Number(p.latencyMs) || 0)));
    }
    if (!sets.length) return;

    binds.push(changeSetId);
    try {
      await env.DB.prepare(
        `UPDATE agentsam_patch_sessions SET ${sets.join(', ')} WHERE change_set_id = ?`,
      )
        .bind(...binds)
        .run();
    } catch (e) {
      console.warn('[agentsam_patch_sessions] finalize', e?.message ?? e);
    }
  };

  if (ctx?.waitUntil) ctx.waitUntil(run());
  else void run();
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Parameters<typeof scheduleAgentsamPatchSessionInsert>[2]} p
 */
export function recordAgentsamPatchSession(env, ctx, p) {
  void scheduleAgentsamPatchSessionInsert(env, ctx, p);
}
