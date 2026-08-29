/**
 * GET /api/analytics/learning/overview
 * GET /api/analytics/learning/experiences
 */
import { jsonResponse } from '../../core/auth.js';
import { analyticsResponse, parseRange } from './sources/normalize.js';
import { tableExists } from '../../../backend/services/retention.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function rangeSinceUnix(range) {
  const now = Math.floor(Date.now() / 1000);
  if (range === '24h') return now - 86400;
  if (range === '30d') return now - 30 * 86400;
  if (range === 'all') return null;
  return now - 7 * 86400;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {{ tenantId?: string|null, workspaceId?: string|null }} scope
 */
export async function handleLearningOverview(request, url, env, scope) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!env?.DB) return analyticsResponse({ ok: false, error: 'db_not_configured' }, 503);
  if (!(await tableExists(env.DB, 'agentsam_agent_experience'))) {
    return analyticsResponse({ ok: true, ready: false, reason: 'experience_table_missing' });
  }

  const range = parseRange(url.searchParams.get('range'));
  const since = rangeSinceUnix(range);
  const ws = trim(scope.workspaceId);
  const tid = trim(scope.tenantId);
  const binds = [];
  let where = '1=1';
  if (ws) {
    where += ' AND workspace_id = ?';
    binds.push(ws);
  } else if (tid) {
    where += ' AND tenant_id = ?';
    binds.push(tid);
  }
  if (since != null) {
    where += ' AND created_at_unix >= ?';
    binds.push(since);
  }

  const summary = await env.DB.prepare(
    `SELECT
       COUNT(*) AS experiences,
       SUM(CASE WHEN outcome = 'useful_success' THEN 1 ELSE 0 END) AS useful_outcomes,
       SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_outcomes,
       AVG(reward) AS avg_reward,
       SUM(COALESCE(cost_usd, 0)) AS total_spend_usd,
       SUM(COALESCE(total_task_cost_usd, cost_usd, 0)) AS total_task_spend_usd,
       SUM(COALESCE(economic_regret_usd, 0)) AS total_regret_usd,
       SUM(COALESCE(cache_savings_usd, 0)) AS cache_savings_usd,
       SUM(COALESCE(batch_savings_usd, 0)) AS batch_savings_usd,
       SUM(COALESCE(knowledge_hit_count, 0)) AS knowledge_hits,
       AVG(CASE WHEN outcome = 'useful_success' THEN COALESCE(total_task_cost_usd, cost_usd) END) AS cost_per_useful_outcome
     FROM agentsam_agent_experience
     WHERE ${where}`,
  )
    .bind(...binds)
    .first()
    .catch(() => null);

  const lessons = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM agentsam_memory
      WHERE source = 'experience_curator' AND status = 'active'
        ${ws ? 'AND workspace_id = ?' : ''}`,
  )
    .bind(...(ws ? [ws] : []))
    .first()
    .catch(() => ({ c: 0 }));

  const useful = Number(summary?.useful_outcomes) || 0;
  const experiences = Number(summary?.experiences) || 0;

  return analyticsResponse({
    ok: true,
    ready: true,
    range,
    learning_yield: {
      paid_experiences: experiences,
      useful_outcomes: useful,
      success_rate: experiences > 0 ? useful / experiences : null,
      durable_lessons_learned: Number(lessons?.c) || 0,
      knowledge_reuse_hits: Number(summary?.knowledge_hits) || 0,
    },
    economics: {
      spend_usd: Number(summary?.total_spend_usd) || 0,
      task_spend_usd: Number(summary?.total_task_spend_usd) || 0,
      cost_per_useful_outcome: Number(summary?.cost_per_useful_outcome) || null,
      estimated_regret_usd: Number(summary?.total_regret_usd) || 0,
      cache_savings_usd: Number(summary?.cache_savings_usd) || 0,
      batch_savings_usd: Number(summary?.batch_savings_usd) || 0,
      avoided_spend_usd:
        (Number(summary?.cache_savings_usd) || 0) + (Number(summary?.batch_savings_usd) || 0),
    },
    avg_reward: Number(summary?.avg_reward) || null,
  });
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {{ tenantId?: string|null, workspaceId?: string|null }} scope
 */
export async function handleLearningExperiences(request, url, env, scope) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!env?.DB) return analyticsResponse({ ok: false, error: 'db_not_configured' }, 503);
  if (!(await tableExists(env.DB, 'agentsam_agent_experience'))) {
    return analyticsResponse({ ok: true, rows: [] });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const ws = trim(scope.workspaceId);
  const binds = [];
  let where = '1=1';
  if (ws) {
    where += ' AND workspace_id = ?';
    binds.push(ws);
  }
  binds.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT id, agent_run_id, surface, source_client, task_type, model_key, outcome,
            failure_category, tool_call_count, duration_ms, cost_usd, total_task_cost_usd,
            reward, economic_regret_usd, cache_savings_usd, knowledge_hit_count,
            knowledge_generation, created_at_unix
       FROM agentsam_agent_experience
      WHERE ${where}
      ORDER BY created_at_unix DESC
      LIMIT ?`,
  )
    .bind(...binds)
    .all()
    .catch(() => ({ results: [] }));

  return analyticsResponse({ ok: true, rows: results || [] });
}
