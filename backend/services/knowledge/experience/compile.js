/**
 * Experience compiler — one bounded episodic row per finalized agent run.
 * Does NOT mutate Thompson posteriors (applyRewardEvent only).
 */
import { pragmaTableInfo, tableExists } from '../../retention.js';
import { failureCategoryFromAgentRun } from '../../../../src/core/reward-failure-category.js';
import {
  classifyExperienceOutcome,
  scoreAgentExperience,
  estimateCacheSavingsUsd,
} from './score.js';
import { getKnowledgeGeneration } from '../generation.js';
import {
  getKnowledgeUseForRun,
  persistKnowledgeRefsOnRun,
  clearKnowledgeUseForRun,
} from '../attribution.js';
import { curateKnowledgeFromExperience } from './curator.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function expId() {
  return `aexp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function resolveExperienceSurface(run = {}) {
  const mode = trim(run.mode).toLowerCase();
  const trigger = trim(run.trigger).toLowerCase();
  const runId = trim(run.id || run.agent_run_id);
  let surface = 'in_app';
  if (runId.startsWith('arun_mcp_')) surface = 'mcp_external';
  else if (mode === 'mcp_agent' || trigger.includes('mcp')) surface = 'mcp_zone';
  else if (trigger.includes('cron') || trigger.includes('scheduled')) surface = 'scheduled';
  else if (trigger.includes('api')) surface = 'api';

  let source_client = 'dashboard';
  if (runId.includes('_mcp_claude') || runId.startsWith('arun_mcp_claude')) source_client = 'claude';
  else if (runId.includes('_mcp_chatgpt') || runId.startsWith('arun_mcp_chatgpt')) {
    source_client = 'chatgpt';
  } else if (runId.includes('_mcp_cursor') || runId.startsWith('arun_mcp_cursor')) {
    source_client = 'cursor';
  } else if (surface === 'scheduled') source_client = 'cron';
  else if (trim(run.source_client)) source_client = trim(run.source_client);

  return { surface, source_client };
}

async function sumTaskTreeCostUsd(env, rootRunId, rootCost) {
  const root = trim(rootRunId);
  if (!env?.DB || !root) return rootCost;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  if (!cols.has('parent_run_id') || !cols.has('cost_usd')) return rootCost;
  try {
    const extra = cols.has('chain_root_id') ? ' OR chain_root_id = ?' : '';
    const binds = cols.has('chain_root_id') ? [root, root, root] : [root, root];
    const { results } = await env.DB.prepare(
      `SELECT cost_usd FROM agentsam_agent_run
        WHERE id = ? OR parent_run_id = ?${extra}`,
    )
      .bind(...binds)
      .all();
    let total = 0;
    for (const r of results || []) {
      const c = Number(r.cost_usd);
      if (Number.isFinite(c) && c >= 0) total += c;
    }
    return total > 0 ? total : rootCost;
  } catch {
    return rootCost;
  }
}

async function estimateEconomicRegretUsd(env, p) {
  if (!env?.DB) return 0;
  const tt = trim(p.task_type) || 'ask';
  const ws = trim(p.workspace_id);
  const actual = Number(p.cost_usd);
  if (!Number.isFinite(actual) || actual <= 0) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT MIN(CASE WHEN cost_mean > 0 THEN cost_mean ELSE NULL END) AS min_cost
         FROM agentsam_routing_arms
        WHERE task_type = ?
          AND (workspace_id IS NULL OR workspace_id = ? OR workspace_id = '')
          AND COALESCE(is_paused, 0) = 0`,
    )
      .bind(tt, ws)
      .first();
    const minCost = Number(row?.min_cost);
    if (!Number.isFinite(minCost) || minCost <= 0) return 0;
    return Math.max(0, actual - minCost);
  } catch {
    return 0;
  }
}

export async function compileAgentExperience(env, agentRunId, opts = {}) {
  const runId = trim(agentRunId);
  if (!env?.DB || !runId) return { ok: false, reason: 'missing_run_id' };
  if (!(await tableExists(env.DB, 'agentsam_agent_experience'))) {
    return { ok: false, reason: 'experience_table_missing' };
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM agentsam_agent_experience WHERE agent_run_id = ? LIMIT 1`,
  )
    .bind(runId)
    .first()
    .catch(() => null);
  if (existing?.id) return { ok: true, id: existing.id, duplicate: true };

  const runCols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  if (!runCols.size) return { ok: false, reason: 'agent_run_table_missing' };

  const select = [
    'id', 'tenant_id', 'workspace_id', 'user_id', 'conversation_id', 'status', 'mode',
    'model_key', 'routing_arm_id', 'cost_usd', 'latency_ms', 'error_message',
  ];
  for (const c of ['timed_out', 'quality_score', 'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'knowledge_refs_json', 'knowledge_bootstrap_id', 'source_client', 'prompt_pattern_hash']) {
    if (runCols.has(c)) select.push(c);
  }

  const run = await env.DB.prepare(
    `SELECT ${select.join(', ')} FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(runId)
    .first();
  if (!run?.id) return { ok: false, reason: 'run_not_found' };

  const tenantId = trim(run.tenant_id);
  const workspaceId = trim(run.workspace_id);
  if (!tenantId || !workspaceId) return { ok: false, reason: 'scope_required' };

  let toolCallCount = 0;
  let toolErrorCount = 0;
  let toolChainId = null;
  if (await tableExists(env.DB, 'agentsam_tool_call_log')) {
    const tc = await env.DB.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status NOT IN ('success','ok','completed') THEN 1 ELSE 0 END) AS err
         FROM agentsam_tool_call_log WHERE agent_run_id = ?`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    toolCallCount = Math.floor(Number(tc?.n) || 0);
    toolErrorCount = Math.floor(Number(tc?.err) || 0);
  }
  if (await tableExists(env.DB, 'agentsam_tool_chain')) {
    const chain = await env.DB.prepare(
      `SELECT id FROM agentsam_tool_chain WHERE agent_run_id = ? ORDER BY started_at DESC LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    toolChainId = chain?.id != null ? String(chain.id) : null;
  }

  const status = trim(run.status).toLowerCase();
  const cancelled = status === 'cancelled' || status === 'canceled';
  const failureCategory = failureCategoryFromAgentRun({
    status,
    errorMessage: run.error_message,
    timedOut: run.timed_out != null ? Number(run.timed_out) === 1 : null,
    cancelled,
  });
  const { outcome, completion_signal } = classifyExperienceOutcome({
    status,
    failureCategory,
    cancelled,
    toolCallCount,
    toolErrorCount,
    qualityScore: run.quality_score != null ? Number(run.quality_score) : null,
  });

  const costUsd = Number(run.cost_usd);
  const hasCost = Number.isFinite(costUsd) && costUsd >= 0;
  const totalTaskCost = await sumTaskTreeCostUsd(env, runId, hasCost ? costUsd : 0);
  const latencyMs = Number(run.latency_ms);
  const mk = trim(run.model_key) || trim(run.model_id) || null;
  const taskType = trim(run.task_type) || 'ask';

  const { reward, reward_components } = scoreAgentExperience({
    outcome,
    failureCategory,
    costUsd: hasCost ? costUsd : totalTaskCost,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    taskType,
    toolCallCount,
    toolErrorCount,
    qualityScore: run.quality_score != null ? Number(run.quality_score) : null,
  });

  const economicRegret = await estimateEconomicRegretUsd(env, {
    task_type: taskType,
    workspace_id: workspaceId,
    cost_usd: totalTaskCost || costUsd,
    model_key: mk,
  });

  const cacheSavings = estimateCacheSavingsUsd({
    cached_input_tokens: run.cached_input_tokens,
    input_tokens: run.input_tokens,
    cost_usd: hasCost ? costUsd : totalTaskCost,
  });

  await persistKnowledgeRefsOnRun(env, runId);
  let { refs: attrRefs, bootstrap_id, hit_count } = getKnowledgeUseForRun(runId);
  if (!attrRefs.length && run.knowledge_refs_json) {
    try {
      attrRefs = JSON.parse(String(run.knowledge_refs_json)).slice(0, 32);
      hit_count = attrRefs.length;
    } catch {
      /* ignore */
    }
  }
  if (!bootstrap_id && run.knowledge_bootstrap_id) {
    bootstrap_id = trim(run.knowledge_bootstrap_id);
  }

  const knowledgeGen = await getKnowledgeGeneration(env, tenantId, workspaceId);
  const { surface, source_client } = resolveExperienceSurface(run);
  const compileFrom = trim(opts.compile_from) || 'agent_run';
  const dedupKey = `agent_run:${runId}`;
  const id = expId();
  const now = Math.floor(Date.now() / 1000);
  const promptPatternHash =
    runCols.has('prompt_pattern_hash') && trim(run.prompt_pattern_hash)
      ? trim(run.prompt_pattern_hash)
      : null;

  await env.DB.prepare(
    `INSERT INTO agentsam_agent_experience (
       id, agent_run_id, tenant_id, workspace_id, conversation_id, user_id,
       surface, source_client, compile_from,
       mode, task_type, model_key, routing_arm_id,
       outcome, failure_category, completion_signal,
       tool_call_count, duration_ms, cost_usd, total_task_cost_usd,
       reward, reward_components_json, economic_regret_usd,
       cached_input_tokens, cache_write_tokens, cache_savings_usd, batch_savings_usd,
       execution_mode, exploration_mode,
       knowledge_refs_json, knowledge_hit_count, knowledge_generation, knowledge_bootstrap_id,
       tool_chain_id, parent_run_id, source_run_ref,
       first_activity_at_unix, last_activity_at_unix, finalized_at_unix,
       finalization_state, finalize_reason, dedup_key, created_at_unix
     ) VALUES (
       ?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?
     )`,
  )
    .bind(
      id, runId, tenantId, workspaceId, trim(run.conversation_id) || null, trim(run.user_id) || null,
      surface, source_client, compileFrom,
      trim(run.mode) || null, taskType, mk, trim(run.routing_arm_id) || null,
      outcome, failureCategory, completion_signal,
      toolCallCount,
      Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.floor(latencyMs) : null,
      hasCost ? costUsd : null, totalTaskCost > 0 ? totalTaskCost : null,
      reward, JSON.stringify(reward_components), economicRegret > 0 ? economicRegret : null,
      Math.max(0, Math.floor(Number(run.cached_input_tokens) || 0)),
      Math.max(0, Math.floor(Number(run.cache_write_tokens) || 0)),
      cacheSavings > 0 ? cacheSavings : 0, 0,
      cacheSavings > 0 ? 'cached_interactive' : 'interactive', null,
      JSON.stringify(attrRefs.slice(0, 32)), hit_count, knowledgeGen, bootstrap_id,
      toolChainId, trim(run.parent_run_id) || null, runId,
      now, now, now,
      trim(opts.finalization_state) || 'final',
      trim(opts.finalize_reason) || 'agent_run_finalize',
      dedupKey, now,
    )
    .run();

  const expCols = await pragmaTableInfo(env.DB, 'agentsam_agent_experience');
  if (promptPatternHash && expCols.has('prompt_pattern_hash')) {
    await env.DB.prepare(
      `UPDATE agentsam_agent_experience SET prompt_pattern_hash = ? WHERE id = ?`,
    )
      .bind(promptPatternHash, id)
      .run();
  }

  let curator = null;
  if (opts.skip_curator !== true) {
    curator = await curateKnowledgeFromExperience(env, {
      experience_id: id,
      agent_run_id: runId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: trim(run.user_id),
      outcome,
      failure_category: failureCategory,
      task_type: taskType,
      model_key: mk,
      cost_usd: totalTaskCost || costUsd,
      tool_call_count: toolCallCount,
      tool_error_count: toolErrorCount,
      error_message: trim(run.error_message) || null,
    }).catch((e) => ({ ok: false, error: e?.message ?? String(e) }));
  }

  clearKnowledgeUseForRun(runId);
  return { ok: true, id, agent_run_id: runId, outcome, reward, curator };
}

export async function compileAgentExperienceFromMcpSpine(env, spine = {}) {
  const agentRunId = trim(spine.agent_run_id);
  const tenantId = trim(spine.tenant_id);
  const workspaceId = trim(spine.workspace_id);
  if (!env?.DB || !agentRunId || !tenantId || !workspaceId) {
    return { ok: false, reason: 'spine_scope_required' };
  }

  const runCols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  if (runCols.size) {
    const row = await env.DB.prepare(`SELECT id FROM agentsam_agent_run WHERE id = ? LIMIT 1`)
      .bind(agentRunId)
      .first()
      .catch(() => null);
    if (!row?.id) {
      const nowIso = new Date().toISOString();
      const parts = ['id', 'user_id', 'tenant_id', 'workspace_id', 'status', 'trigger', 'mode'];
      const binds = [
        agentRunId, trim(spine.user_id) || 'system', tenantId, workspaceId,
        trim(spine.status) || 'completed', 'mcp_external_finalize', 'mcp_agent',
      ];
      for (const [col, val] of [
        ['conversation_id', trim(spine.conversation_id) || null],
        ['model_key', trim(spine.model_key) || null],
        ['routing_arm_id', trim(spine.routing_arm_id) || null],
        ['task_type', 'mcp_external'],
        ['cost_usd', Number(spine.cost_usd) || 0],
        ['latency_ms', Math.floor(Number(spine.duration_ms) || 0)],
        ['created_at', nowIso],
        ['created_at_unix', Math.floor(Date.now() / 1000)],
      ]) {
        if (runCols.has(col)) {
          parts.push(col);
          binds.push(val);
        }
      }
      await env.DB.prepare(
        `INSERT INTO agentsam_agent_run (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
      )
        .bind(...binds)
        .run()
        .catch(() => {});
    }
  }

  return compileAgentExperience(env, agentRunId, {
    compile_from: 'tool_call_log_rollup',
    finalization_state: trim(spine.finalization_state) || 'final',
    finalize_reason: trim(spine.finalize_reason) || 'mcp_spine_finalize',
  });
}
