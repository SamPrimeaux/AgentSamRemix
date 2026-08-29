/**
 * backend/jobs/velocity-daily-rollup.js
 *
 * Runs at midnight UTC (0 0 * * *) — always via cronLedgerWrap (not gated on digest email).
 *
 * Auto-writes per day:
 *   - task_velocity (deployments table = primary signal, not migration proxies)
 *   - founder_metrics partial row (late_night_commits, days_since_break — human fields NULL)
 *   - kpi_entries for computable KPIs from kpi_definitions
 *
 * Personal columns (energy_level, struggle_areas, etc.) stay NULL — filled via chat.
 */

import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { agentsamMemoryActiveSqlOrEmpty } from '../http/agentsam/routes/memory-resolve-runtime.js';
import { resolveCronTenantId } from './cron-tenant.js';

const CRON_EXPR = '0 0 * * *';
const JOB_NAME = 'velocity_daily_rollup';

function nextDayIso(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function resolveRollupTenantId(env) {
  return resolveCronTenantId(env);
}

function isBugFixDescription(desc) {
  const d = String(desc || '').trim().toLowerCase();
  return /^(fix|fix:|bug|hotfix|patch|repair|resolve)/.test(d)
    || d.includes(' bug ')
    || d.includes(' fix ');
}

function isFeatureDescription(desc) {
  const d = String(desc || '').trim().toLowerCase();
  return /^(feat|feature|add|ship|wire|implement|enable|morning|deploy)/.test(d);
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} dayIso
 * @param {string} nextDayIsoStr
 */
async function countDeploymentSignals(db, dayIso, nextDayIsoStr) {
  const { results } = await db.prepare(
    `SELECT git_hash, description, status, environment, version,
            COALESCE(created_at, unixepoch(timestamp)) AS ts
     FROM deployments
     WHERE COALESCE(created_at, unixepoch(timestamp)) >= unixepoch(?)
       AND COALESCE(created_at, unixepoch(timestamp)) < unixepoch(?)
     ORDER BY COALESCE(created_at, unixepoch(timestamp)) ASC`,
  ).bind(dayIso, nextDayIsoStr).all().catch(() => ({ results: [] }));

  const rows = results || [];
  const hashes = new Set();
  let featuresShipped = 0;
  let bugsFixed = 0;
  let lateNightCommits = 0;
  let workerVersion = null;

  for (const r of rows) {
    const gh = String(r.git_hash || r.version || '').trim();
    if (gh) hashes.add(gh);
    const desc = r.description;
    if (isBugFixDescription(desc)) bugsFixed += 1;
    else if (isFeatureDescription(desc)) featuresShipped += 1;
    const ts = Number(r.ts);
    if (Number.isFinite(ts)) {
      const hour = new Date(ts * 1000).getUTCHours();
      if (hour >= 22 || hour < 5) lateNightCommits += 1;
    }
    workerVersion = gh ? gh.slice(0, 12) : workerVersion;
  }

  const deploysProduction = rows.filter(
    (r) => String(r.environment || 'production').toLowerCase() === 'production',
  ).length || rows.length;

  return {
    commits: hashes.size || rows.length,
    deploysProduction,
    featuresShipped,
    bugsFixed,
    lateNightCommits,
    workerVersion,
    deployRows: rows,
  };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} dayIso
 * @param {string} nextDayIsoStr
 */
async function writeFounderMetricsAuto(db, dayIso, nextDayIsoStr, deploySignals) {
  const existing = await db.prepare(
    `SELECT id FROM founder_metrics WHERE date = ? LIMIT 1`,
  ).bind(dayIso).first().catch(() => null);
  if (existing?.id) return { skipped: true };

  const lastRow = await db.prepare(
    `SELECT date, days_since_break, burnout_risk FROM founder_metrics ORDER BY date DESC LIMIT 1`,
  ).first().catch(() => null);

  let daysSinceBreak = 0;
  if (lastRow?.date) {
    const gap = await db.prepare(
      `SELECT CAST(julianday(?) - julianday(?) AS INTEGER) AS gap`,
    ).bind(dayIso, lastRow.date).first().catch(() => null);
    const gapDays = Math.max(0, Number(gap?.gap) || 0);
    daysSinceBreak = gapDays + Math.max(0, Number(lastRow.days_since_break) || 0);
  }

  let burnoutRisk = 'low';
  if (daysSinceBreak >= 45 || deploySignals.lateNightCommits >= 3) burnoutRisk = 'high';
  else if (daysSinceBreak >= 21 || deploySignals.lateNightCommits >= 1) burnoutRisk = 'medium';

  const noteParts = [];
  if (deploySignals.deploysProduction > 0) {
    noteParts.push(`${deploySignals.deploysProduction} production deploys (D1 deployments)`);
  }
  if (deploySignals.lateNightCommits > 0) {
    noteParts.push(`${deploySignals.lateNightCommits} late-night deploys`);
  }
  noteParts.push(`days_since_break auto: ${daysSinceBreak}`);
  noteParts.push('energy/stress/deep_work — log via chat when ready');

  await db.prepare(
    `INSERT INTO founder_metrics (
       date, late_night_commits, days_since_break, context_switches,
       burnout_risk, notes, energy_level, stress_level, deep_work_hours
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).bind(
    dayIso,
    deploySignals.lateNightCommits,
    daysSinceBreak,
    deploySignals.deploysProduction,
    burnoutRisk,
    noteParts.join('. ').slice(0, 1000),
  ).run();

  return { written: true, daysSinceBreak, burnoutRisk };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} tenantId
 * @param {string} dayIso
 * @param {string} nextDayIsoStr
 */
async function writeKpiSnapshots(db, tenantId, dayIso, nextDayIsoStr) {
  const { results: defs } = await db.prepare(
    `SELECT id, name, cadence, target_type, target_min, target_max
     FROM kpi_definitions WHERE tenant_id = ?`,
  ).bind(tenantId).all().catch(() => ({ results: [] }));

  if (!defs?.length) return { written: 0 };

  const weekStart = new Date(`${dayIso}T12:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);

  const [deployDay, deployWeek, runDay, mcpDay, aiCostDay, blockers] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(trim(COALESCE(status,''))) IN ('success','ok','completed') THEN 1 ELSE 0 END) AS ok
       FROM deployments
       WHERE COALESCE(created_at, unixepoch(timestamp)) >= unixepoch(?)
         AND COALESCE(created_at, unixepoch(timestamp)) < unixepoch(?)`,
    ).bind(dayIso, nextDayIsoStr).first().catch(() => null),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(trim(COALESCE(status,''))) IN ('success','ok','completed') THEN 1 ELSE 0 END) AS ok
       FROM deployments
       WHERE COALESCE(created_at, unixepoch(timestamp)) >= unixepoch(?)
         AND COALESCE(created_at, unixepoch(timestamp)) < unixepoch(?)`,
    ).bind(weekStartIso, nextDayIsoStr).first().catch(() => null),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ok
       FROM agentsam_agent_run
       WHERE created_at_unix >= unixepoch(?) AND created_at_unix < unixepoch(?)`,
    ).bind(dayIso, nextDayIsoStr).first().catch(() => null),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
       FROM agentsam_performance_eto_events
       WHERE created_at_unix >= unixepoch(?) AND created_at_unix < unixepoch(?)`,
    ).bind(dayIso, nextDayIsoStr).first().catch(() => null),
    db.prepare(
      `SELECT ROUND(MAX(cost_usd), 4) AS spend FROM agentsam_usage_rollups_daily WHERE day = ?`,
    ).bind(dayIso).first().catch(() => null),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM agentsam_memory
       WHERE COALESCE(is_resolved, 0) = 0 AND decay_score > 0.3`,
    ).first().catch(() => null),
  ]);

  const valueForKpi = (kpiId) => {
    const id = String(kpiId || '').toLowerCase();
    const dTotal = Number(deployDay?.total) || 0;
    const dOk = Number(deployDay?.ok) || 0;
    const wTotal = Number(deployWeek?.total) || 0;
    const rTotal = Number(runDay?.total) || 0;
    const rOk = Number(runDay?.ok) || 0;
    const mTotal = Number(mcpDay?.total) || 0;
    const mFail = Number(mcpDay?.failures) || 0;

    if (id.includes('deploy_success')) return dTotal ? (dOk / dTotal) * 100 : 100;
    if (id.includes('agent_run_success')) return rTotal ? (rOk / rTotal) * 100 : 0;
    if (id.includes('mcp') && id.includes('fail')) return mTotal ? (mFail / mTotal) * 100 : 0;
    if (id.includes('ai_cost_daily') || id === 'kpi_agent_tool_calls') {
      return Number(aiCostDay?.spend) || 0;
    }
    if (id.includes('deploys_week') || id.includes('prod_deploys_weekly')) return wTotal;
    if (id.includes('open_issues')) return Number(blockers?.cnt) || 0;
    return null;
  };

  let written = 0;
  const now = new Date().toISOString();

  for (const def of defs) {
    const cadence = String(def.cadence || 'daily').toLowerCase();
    const isWeekly = cadence === 'weekly';
    const periodStart = isWeekly ? weekStartIso : dayIso;
    const periodEnd = dayIso;
    const value = valueForKpi(def.id);
    if (value == null || !Number.isFinite(value)) continue;

    const entryId = `kpi_entry_${def.id}_${periodStart}`;
    const res = await db.prepare(
      `INSERT OR IGNORE INTO kpi_entries (
         id, tenant_id, kpi_id, period_start, period_end, value, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'velocity_daily_rollup', ?)`,
    ).bind(entryId, tenantId, def.id, periodStart, periodEnd, value, now).run().catch(() => null);

    if (Number(res?.meta?.changes) > 0) written += 1;
  }

  return { written };
}

function computeVelocityScore({
  commits, deploys, migrationsApplied, featuresShipped, bugsFixed,
  mcpToolCalls, spawnJobsCompleted, cronFailures, stuckRuns,
}) {
  let score = 50;

  score += Math.min(commits * 4, 20);
  score += Math.min(deploys * 8, 16);
  score += Math.min(migrationsApplied * 5, 15);
  score += Math.min(featuresShipped * 6, 18);
  score += Math.min(bugsFixed * 3, 9);
  score += Math.min(spawnJobsCompleted * 3, 9);
  score += Math.min(Math.floor(mcpToolCalls / 20), 5);

  score -= Math.min(cronFailures * 5, 15);
  score -= Math.min(stuckRuns * 3, 9);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeMomentum(score, prevScore) {
  if (prevScore == null) return 'steady';
  const delta = score - prevScore;
  if (delta >= 10) return 'accelerating';
  if (delta <= -10) return 'slowing';
  return 'steady';
}

/**
 * @param {any} env
 * @returns {Promise<{ ok: boolean, date: string, score: number, skipped?: boolean }>}
 */
export async function runVelocityDailyRollup(env) {
  if (!env?.DB) return { ok: false, date: '', score: 0 };

  const begun = await startCronRun(env, {
    jobName: JOB_NAME,
    cronExpression: CRON_EXPR,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const tenantId = await resolveRollupTenantId(env);

  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM task_velocity WHERE date = ?`,
    ).bind(yesterday).first();

    if (existing) {
      console.log(`[velocity-rollup] row already exists for ${yesterday}, skipping`);
      if (runId) await completeCronRun(env, runId, startedAt, { rowsWritten: 0, metadata: { skipped: true } });
      return { ok: true, date: yesterday, score: 0, skipped: true };
    }

    const deploySignals = await countDeploymentSignals(env.DB, yesterday, todayIso);

    const workerActivity = await env.DB.prepare(
      `SELECT SUM(total_requests) as total_requests
       FROM worker_analytics_daily
       WHERE worker_name IN ('inneranimalmedia','inneranimalmedia-mcp-server')
         AND day_timestamp >= ? AND day_timestamp < ?`,
    ).bind(
      new Date(yesterday).getTime(),
      new Date(yesterday).getTime() + 86400000,
    ).first().catch(() => null);

    const migrationsRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt, GROUP_CONCAT(name, ', ') as names
       FROM d1_migrations
       WHERE applied_at >= ? AND applied_at < ?`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const mcpEtoRow = await env.DB.prepare(
      `SELECT COUNT(*) as total_calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
       FROM agentsam_performance_eto_events
       WHERE created_at_unix >= unixepoch(?)
         AND created_at_unix < unixepoch(?)`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const mcpRow = await env.DB.prepare(
      `SELECT COUNT(*) as total_calls,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
       FROM agentsam_mcp_tool_execution
       WHERE COALESCE(created_at_unix, unixepoch(created_at)) >= unixepoch(?)
         AND COALESCE(created_at_unix, unixepoch(created_at)) < unixepoch(?)`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const runRow = await env.DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
              SUM(CASE WHEN status='running' AND created_at_unix < unixepoch('now','-2 hours') THEN 1 ELSE 0 END) as stuck,
              ROUND(SUM(cost_usd), 4) as cost_usd
       FROM agentsam_agent_run
       WHERE created_at_unix >= unixepoch(?) AND created_at_unix < unixepoch(?)`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const cronRow = await env.DB.prepare(
      `SELECT SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failures
       FROM agentsam_cron_runs
       WHERE started_at >= unixepoch(?) AND started_at < unixepoch(?)`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const spawnRow = await env.DB.prepare(
      `SELECT COUNT(*) as completed
       FROM agentsam_spawn_job
       WHERE status = 'completed'
         AND started_at >= unixepoch(?) AND started_at < unixepoch(?)`,
    ).bind(yesterday, todayIso).first().catch(() => null);

    const spendRow = await env.DB.prepare(
      `SELECT ROUND(MAX(cost_usd), 4) as spend FROM agentsam_usage_rollups_daily WHERE day = ?`,
    ).bind(yesterday).first().catch(() => null);

    const todosCompletedRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM agentsam_todo
       WHERE status IN ('done','completed') AND date(completed_at) = date(?)`,
    ).bind(yesterday).first().catch(() => null);

    const todosCreatedRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM agentsam_todo WHERE date(created_at) = date(?)`,
    ).bind(yesterday).first().catch(() => null);

    const todosOpenRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM agentsam_todo
       WHERE status NOT IN ('done','completed','cancelled')`,
    ).first().catch(() => null);

    const timeRow = await env.DB.prepare(
      `SELECT ROUND(COALESCE(SUM(
         CASE
           WHEN ended_at IS NULL THEN MAX(0, (unixepoch() - COALESCE(started_at, created_at))) / 60.0
           ELSE COALESCE(hours * 60, MAX(0, ended_at - COALESCE(started_at, created_at)) / 60.0)
         END
       ), 0)) as minutes
       FROM time_entries
       WHERE date(datetime(COALESCE(started_at, created_at), 'unixepoch')) = date(?)`,
    ).bind(yesterday).first().catch(() => null);

    const memoryActiveSql = await agentsamMemoryActiveSqlOrEmpty(env.DB);
    const blockersRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM agentsam_memory
       WHERE ${memoryActiveSql} AND decay_score > 0.3`,
    ).first().catch(() => null);

    const lastWeekDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const lastWeekRow = await env.DB.prepare(
      `SELECT velocity_score FROM task_velocity WHERE date = ?`,
    ).bind(lastWeekDate).first().catch(() => null);

    const commits = deploySignals.commits;
    const deploys = deploySignals.deploysProduction;
    const migrationsApplied = Math.max(Number(migrationsRow?.cnt) || 0, 0);
    const mcpToolCalls = Math.max(
      Number(mcpEtoRow?.total_calls) || 0,
      Number(mcpRow?.total_calls) || 0,
    );
    const stuckRuns = Math.max(Number(runRow?.stuck) || 0, 0);
    const cronFailures = Math.max(Number(cronRow?.failures) || 0, 0);
    const spawnJobsCompleted = Math.max(Number(spawnRow?.completed) || 0, 0);
    const featuresShipped = deploySignals.featuresShipped + spawnJobsCompleted;
    const bugsFixed = deploySignals.bugsFixed;
    const cursorSpend = spendRow?.spend ?? null;
    const todosCompleted = Math.max(Number(todosCompletedRow?.cnt) || 0, 0);
    const todosCreated = Math.max(Number(todosCreatedRow?.cnt) || 0, 0);
    const todosOpen = Math.max(Number(todosOpenRow?.cnt) || 0, 0);
    const timeMinutes = Math.max(Number(timeRow?.minutes) || 0, 0);
    const blockersCount = Math.max(Number(blockersRow?.cnt) || 0, 0);
    const workerRequests = Math.max(Number(workerActivity?.total_requests) || 0, 0);

    const velocityScore = computeVelocityScore({
      commits, deploys, migrationsApplied, featuresShipped, bugsFixed,
      mcpToolCalls, spawnJobsCompleted, cronFailures, stuckRuns,
    });

    const prevScore = lastWeekRow?.velocity_score ?? null;
    const momentum = computeMomentum(velocityScore, prevScore);
    const wowDelta = prevScore != null ? velocityScore - prevScore : null;

    const sprintMemory = await env.DB.prepare(
      `SELECT value FROM agentsam_memory
       WHERE memory_type = 'decision' AND decay_score > 0
       ORDER BY updated_at DESC LIMIT 1`,
    ).first().catch(() => null);

    let sprintGoal = 'See agentsam_memory for active sprint';
    if (sprintMemory?.value) {
      const firstLine = String(sprintMemory.value).split('.')[0].slice(0, 120);
      if (firstLine) sprintGoal = firstLine;
    }

    const noteParts = [];
    if (commits > 0) noteParts.push(`${commits} distinct SHAs`);
    if (deploys > 0) noteParts.push(`${deploys} production deploys (D1 deployments)`);
    if (migrationsApplied > 0) noteParts.push(`${migrationsApplied} migrations`);
    if (featuresShipped > 0) noteParts.push(`${featuresShipped} features`);
    if (bugsFixed > 0) noteParts.push(`${bugsFixed} fixes`);
    if (mcpToolCalls > 0) noteParts.push(`${mcpToolCalls} MCP/ETO tool calls`);
    if (todosCompleted > 0) noteParts.push(`${todosCompleted} todos completed`);
    if (blockersCount > 0) noteParts.push(`${blockersCount} open memory blockers`);
    if (stuckRuns > 0) noteParts.push(`${stuckRuns} stuck agent runs`);
    if (cronFailures > 0) noteParts.push(`${cronFailures} cron failures`);
    if (deploySignals.deployRows.length) {
      const deployNotes = deploySignals.deployRows
        .map((r) => `${String(r.git_hash || '').slice(0, 8)}: ${String(r.description || '').slice(0, 80)}`)
        .filter(Boolean)
        .join(' | ');
      if (deployNotes) noteParts.push(`deploys: ${deployNotes.slice(0, 400)}`);
    }
    const migNames = migrationsRow?.names || '';
    if (migNames) noteParts.push(`migrations: ${migNames.slice(0, 200)}`);
    if (workerRequests > 0) noteParts.push(`${workerRequests} worker requests (platform live)`);
    const notes = noteParts.join('. ') || 'No significant activity detected.';

    await env.DB.prepare(
      `INSERT INTO task_velocity (
        date, github_commits, deploys_production, features_shipped, bugs_fixed,
        tasks_completed, tasks_created, tasks_in_progress, blockers_count,
        velocity_score, momentum, sprint_goal, sprint_progress_percent, notes,
        migrations_applied, mcp_tool_calls, cursor_spend_usd,
        platform_worker_version, week_over_week_delta,
        time_minutes, cost_usd,
        new_concepts, confidence_gains, struggle_areas,
        ai_collab_score, solo_decisions
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        NULL, NULL, NULL,
        NULL, 0
      )`,
    ).bind(
      yesterday,
      commits,
      deploys,
      featuresShipped,
      bugsFixed,
      todosCompleted,
      todosCreated,
      todosOpen,
      blockersCount,
      velocityScore,
      momentum,
      sprintGoal.slice(0, 200),
      null,
      notes.slice(0, 1000),
      migrationsApplied,
      mcpToolCalls,
      cursorSpend,
      deploySignals.workerVersion,
      wowDelta,
      timeMinutes,
      cursorSpend,
    ).run();

    const founderRes = await writeFounderMetricsAuto(env.DB, yesterday, todayIso, deploySignals).catch(() => ({}));
    const kpiRes = await writeKpiSnapshots(env.DB, tenantId, yesterday, todayIso).catch(() => ({ written: 0 }));

    console.log(
      `[velocity-rollup] wrote ${yesterday}: score=${velocityScore} deploys=${deploys} `
      + `founder=${founderRes.written ? 'yes' : 'skip'} kpi=${kpiRes.written ?? 0}`,
    );

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsWritten: 1,
        metadata: {
          date: yesterday,
          score: velocityScore,
          momentum,
          deploys,
          founder: founderRes,
          kpi: kpiRes,
        },
      });
    }

    return { ok: true, date: yesterday, score: velocityScore, momentum };

  } catch (e) {
    console.warn('[velocity-rollup] failed:', e?.message ?? e);
    if (runId) await failCronRun(env, runId, startedAt, String(e?.message ?? e).slice(0, 500));
    return { ok: false, date: yesterday, score: 0, error: e?.message };
  }
}
