/**
 * Periodic jobs for Thompson arms, routing memory, drift pause, and execution metrics rollups.
 */

import { startCronRun, completeCronRun, failCronRun } from '../../../jobs/cron-run-ledger.js';
import { readD1TableColumns as pragmaTableInfo } from '../../../services/d1/schema.js';

const CRON_30 = '*/30 * * * *';

/**
 * After routing-memory rollup, pause routing arms when task SLOs are breached (best-effort).
 * @param {any} env
 */
export async function enforceTaskSlosFromRoutingMemory(env) {
  if (!env?.DB) return;
  const sloCols = await pragmaTableInfo(env.DB, 'agentsam_task_slos');
  const armCols = await pragmaTableInfo(env.DB, 'agentsam_routing_arms');
  if (!sloCols.size || !armCols.has('task_type') || !armCols.has('is_paused')) return;
  if (!sloCols.has('pause_arm_on_breach')) return;

  const { results: slos } = await env.DB
    .prepare(
      `SELECT ts.task_type, ts.sla_p95_latency_ms, ts.sla_avg_cost_usd, ts.sla_min_quality,
              ts.pause_arm_on_breach,
              AVG(rm.avg_latency_ms) AS actual_latency, AVG(rm.avg_cost_usd) AS actual_cost,
              AVG(rm.success_rate) AS actual_quality
       FROM agentsam_task_slos ts
       LEFT JOIN agentsam_model_routing_memory rm ON rm.task_type = ts.task_type
       GROUP BY ts.task_type`,
    )
    .all()
    .catch(() => ({ results: [] }));

  for (const slo of slos || []) {
    const pauseCol = Number(slo.pause_arm_on_breach) === 1;
    if (!pauseCol) continue;
    const lat = slo.actual_latency != null ? Number(slo.actual_latency) : null;
    const cost = slo.actual_cost != null ? Number(slo.actual_cost) : null;
    const qual = slo.actual_quality != null ? Number(slo.actual_quality) : null;
    const latencyBreach =
      lat != null &&
      Number.isFinite(lat) &&
      Number.isFinite(Number(slo.sla_p95_latency_ms)) &&
      lat > Number(slo.sla_p95_latency_ms);
    const costBreach =
      cost != null &&
      Number.isFinite(cost) &&
      Number.isFinite(Number(slo.sla_avg_cost_usd)) &&
      cost > Number(slo.sla_avg_cost_usd);
    const qualityBreach =
      qual != null &&
      Number.isFinite(qual) &&
      Number.isFinite(Number(slo.sla_min_quality)) &&
      qual < Number(slo.sla_min_quality);
    console.log('[slo]', slo.task_type, { latencyBreach, costBreach, qualityBreach });
    if (!latencyBreach && !costBreach && !qualityBreach) continue;
    const taskType = slo.task_type != null ? String(slo.task_type).trim() : '';
    if (!taskType) continue;
    if (armCols.has('pause_reason')) {
      await env.DB
        .prepare(
          `UPDATE agentsam_routing_arms SET is_paused = 1, pause_reason = 'slo_breach', updated_at = unixepoch()
           WHERE task_type = ? AND COALESCE(is_paused, 0) = 0`,
        )
        .bind(taskType)
        .run()
        .catch(() => {});
    } else {
      await env.DB
        .prepare(
          `UPDATE agentsam_routing_arms SET is_paused = 1, updated_at = unixepoch()
           WHERE task_type = ? AND COALESCE(is_paused, 0) = 0`,
        )
        .bind(taskType)
        .run()
        .catch(() => {});
    }
  }
}

/**
 * Pause specific routing arms when recent D1 eval_runs breach agentsam_task_slos
 * (model_key + task_type + mode), when pause_arm_on_breach = 1.
 * Supabase eval analytics are out of band; this reads D1 canonical eval_runs only.
 *
 * @param {any} env
 * @param {{ lookbackDays?: number }} [opts]
 */
export async function enforceEvalSlosPauseArms(env, opts = {}) {
  if (!env?.DB) return { ok: false, armsPaused: 0 };
  const sloCols = await pragmaTableInfo(env.DB, 'agentsam_task_slos');
  const armCols = await pragmaTableInfo(env.DB, 'agentsam_routing_arms');
  if (!sloCols.size || !armCols.has('is_paused') || !sloCols.has('pause_arm_on_breach')) {
    return { ok: false, skipped: true, armsPaused: 0 };
  }

  const lookback = Math.max(1, Math.min(30, Number(opts.lookbackDays) || 7));

  const { results: rows } = await env.DB
    .prepare(
      `SELECT er.id, er.model_key, er.passed, er.score_overall, er.latency_ms, er.cost_usd,
              er.run_group_id, er.suite_id,
              es.task_type, es.mode,
              ts.sla_min_quality, ts.sla_p95_latency_ms, ts.sla_avg_cost_usd
       FROM agentsam_eval_runs er
       INNER JOIN agentsam_eval_suites es ON es.id = er.suite_id
       INNER JOIN agentsam_task_slos ts ON ts.task_type = es.task_type AND COALESCE(ts.pause_arm_on_breach, 0) = 1
       WHERE datetime(er.run_at) >= datetime('now', '-' || ? || ' days')
         AND er.model_key IS NOT NULL AND trim(er.model_key) != ''`,
    )
    .bind(String(lookback))
    .all()
    .catch(() => ({ results: [] }));

  let armsPaused = 0;
  const pausedKeys = new Set();

  for (const row of rows || []) {
    const smoke =
      /smoke/i.test(String(row.run_group_id || '')) ||
      /smoke/i.test(String(row.suite_id || '')) ||
      /smoke/i.test(String(row.id || ''));
    if (smoke) continue;

    const breaches = [];
    const passed = Number(row.passed) === 1;
    const score = row.score_overall != null ? Number(row.score_overall) : null;
    const minQ = Number(row.sla_min_quality);
    const lat = row.latency_ms != null ? Number(row.latency_ms) : null;
    const maxLat = Number(row.sla_p95_latency_ms);
    const cost = row.cost_usd != null ? Number(row.cost_usd) : null;
    const maxCost = Number(row.sla_avg_cost_usd);

    if (!passed) breaches.push('eval_failed');
    if (score != null && Number.isFinite(minQ) && score < minQ) breaches.push('quality');
    if (lat != null && Number.isFinite(lat) && Number.isFinite(maxLat) && lat > maxLat) {
      breaches.push('latency');
    }
    if (cost != null && Number.isFinite(cost) && Number.isFinite(maxCost) && cost > maxCost) {
      breaches.push('cost');
    }
    if (!breaches.length) continue;

    const modelKey = String(row.model_key).trim();
    const taskType = row.task_type != null ? String(row.task_type).trim() : 'chat';
    const mode = row.mode != null && String(row.mode).trim() !== '' ? String(row.mode).trim() : 'agent';
    const dedupe = `${modelKey}|${taskType}|${mode}`;
    if (pausedKeys.has(dedupe)) continue;
    pausedKeys.add(dedupe);

    const pauseReason = `eval_slo_breach:${breaches.join(',')}`.slice(0, 120);
    const sets = armCols.has('pause_reason')
      ? 'is_paused = 1, pause_reason = ?, updated_at = unixepoch()'
      : 'is_paused = 1, updated_at = unixepoch()';
    const binds = armCols.has('pause_reason')
      ? [pauseReason, modelKey, taskType, mode]
      : [modelKey, taskType, mode];

    try {
      const r = await env.DB.prepare(
        `UPDATE agentsam_routing_arms SET ${sets}
         WHERE model_key = ? AND task_type = ? AND mode = ?
           AND COALESCE(is_paused, 0) = 0`,
      )
        .bind(...binds)
        .run();
      armsPaused += Number(r.meta?.changes ?? r.changes ?? 0) || 0;
      console.log('[eval-slo] paused arms', { modelKey, taskType, mode, breaches });
    } catch (e) {
      console.warn('[eval-slo] pause failed', modelKey, e?.message ?? e);
    }
  }

  return { ok: true, armsPaused, eval_rows_scanned: (rows || []).length };
}

/**
 * Retired absolute RESET of success_alpha/beta from ETO counts.
 * Bandit learning is single-writer via applyRewardEvent (hot paths + applyEtoToRoutingArms).
 * This job only refreshes decayed_score from current priors — never overwrites alpha/beta.
 */
export async function reconcileRoutingArmsFromAgentRuns(env) {
  if (!env?.DB) return;
  const armCols = await pragmaTableInfo(env.DB, 'agentsam_routing_arms');
  if (!armCols.size || !armCols.has('success_alpha')) return;

  const begun = await startCronRun(env, {
    jobName: 'routing_arms_reconcile_agent_run',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const r2 = await env.DB
      .prepare(
        `
      UPDATE agentsam_routing_arms SET
        decayed_score = success_alpha / NULLIF(success_alpha + success_beta, 0),
        updated_at = unixepoch()
      WHERE is_eligible = 1 OR is_active = 1
    `,
      )
      .run();

    const rowsWritten = Number(r2.meta?.changes ?? r2.changes ?? 0) || 0;
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 1,
        rowsWritten,
        metadata: { mode: 'decayed_score_only', retired_alpha_beta_reset: true },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] reconcileRoutingArmsFromAgentRuns', e?.message ?? e);
  }
}

/** Roll agentsam_agent_run → agentsam_model_routing_memory (aggregate priors for cold-start). */
export async function rollupAgentsamModelRoutingMemory(env) {
  if (!env?.DB) return;
  const mem = await pragmaTableInfo(env.DB, 'agentsam_model_routing_memory');
  const run = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  const arms = await pragmaTableInfo(env.DB, 'agentsam_routing_arms');
  if (!mem.size || !run.size || !run.has('routing_arm_id')) return;

  const sampleCol = mem.has('sample_count') ? 'sample_count' : mem.has('sample_n') ? 'sample_n' : null;
  if (!sampleCol) return;

  const begun = await startCronRun(env, {
    jobName: 'agentsam_model_routing_memory_rollup',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const includeProvider = mem.has('provider') && arms.has('provider');
    const insertCols = [
      'id',
      'workspace_id',
      'task_type',
      'model_key',
      'success_rate',
      'avg_latency_ms',
      'avg_cost_usd',
      'code_pass_rate',
      'hallucination_rate',
    ];
    const selectExprs = [
      `'mrm_' || lower(hex(randomblob(8)))`,
      `''`,
      `ar.task_type`,
      `ar.model_key`,
      `AVG(CASE WHEN COALESCE(r.status, '') = 'completed' THEN 1.0 ELSE 0.0 END)`,
      `AVG(
          CASE
            WHEN r.started_at IS NOT NULL AND r.completed_at IS NOT NULL THEN
              (julianday(r.completed_at) - julianday(r.started_at)) * 86400000.0
            ELSE NULL
          END
        )`,
      `AVG(COALESCE(r.cost_usd, 0))`,
      `NULL`,
      `NULL`,
    ];
    if (includeProvider) {
      insertCols.push('provider');
      selectExprs.push(`COALESCE(NULLIF(trim(MAX(ar.provider)), ''), 'unknown')`);
    }
    insertCols.push(sampleCol, 'updated_at');
    selectExprs.push('COUNT(*)', 'unixepoch()');

    const conflictSets = [
      'success_rate = excluded.success_rate',
      'avg_latency_ms = excluded.avg_latency_ms',
      'avg_cost_usd = excluded.avg_cost_usd',
      `${sampleCol} = excluded.${sampleCol}`,
    ];
    if (includeProvider) conflictSets.push('provider = excluded.provider');
    conflictSets.push('updated_at = unixepoch()');

    const sql = `
      INSERT INTO agentsam_model_routing_memory (${insertCols.join(', ')})
      SELECT ${selectExprs.join(', ')}
      FROM agentsam_agent_run r
      INNER JOIN agentsam_routing_arms ar ON ar.id = r.routing_arm_id
      WHERE r.routing_arm_id IS NOT NULL
        AND datetime(COALESCE(r.created_at, '1970-01-01')) >= datetime('now', '-14 days')
      GROUP BY ar.task_type, ar.model_key
      ON CONFLICT(workspace_id, task_type, model_key) DO UPDATE SET
        ${conflictSets.join(', ')}
    `;

    await env.DB.prepare(sql).run();
    if (runId) await completeCronRun(env, runId, startedAt, { rowsRead: 1, rowsWritten: 1, metadata: {} });
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] rollupAgentsamModelRoutingMemory', e?.message ?? e);
  }
}

