import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

function cronExprForSnapshotReason(reason) {
  const r = String(reason || '');
  if (r.includes('0010') || r === 'cron_0010') return '10 0 * * *';
  if (r.includes('6am') || r === 'cron_6am') return '0 6 * * *';
  if (r.includes('midnight')) return '0 0 * * *';
  return 'various';
}

export async function writeDailySnapshot(env, reason = 'cron') {
  if (!env?.DB) return;
  // system-scoped cron: no authenticated user context at this path
  const tid = (typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim()) ? env.TENANT_ID.trim() : 'system';
  const wid = (typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim()) ? env.WORKSPACE_ID.trim() : 'system';
  const begun = await startCronRun(env, {
    jobName: 'write_daily_snapshot',
    cronExpression: cronExprForSnapshotReason(reason),
    tenantId: tid,
    workspaceId: wid,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  let rowsRead = 0;
  let rowsWritten = 0;
  try {
  const safe = (p) => (p ? p.catch(() => null) : Promise.resolve(null));
  rowsRead += 6;
  const [tt, dt, providerBreakdown, modelBreakdown, planRow] = await Promise.all([
    safe(env.DB.prepare(
      `SELECT COALESCE(SUM(tokens_input),0) AS tokens_in,
        COALESCE(SUM(tokens_output),0) AS tokens_out,
        ROUND(COALESCE(SUM(cost_estimate),0),4) AS cost_usd
       FROM agentsam_usage_events WHERE date=date('now')`
    ).first()),
    safe(env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM deployment_tracking
       WHERE created_at >= date('now')`
    ).first()),
    env.DB.prepare("SELECT provider, COUNT(*) as c, SUM(cost_estimate) as cost FROM agentsam_usage_events WHERE date=date('now') GROUP BY provider").all().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT model, COUNT(*) as c FROM agentsam_usage_events WHERE date=date('now') GROUP BY model ORDER BY c DESC LIMIT 5").all().catch(() => ({ results: [] })),
    env.DB.prepare(`
      SELECT id, tasks_done, tasks_total FROM agentsam_plans
      WHERE status='active' AND plan_type='daily'
      ORDER BY plan_date DESC LIMIT 1
    `).first().catch(() => null),
  ]);
  const providerJson = JSON.stringify(Object.fromEntries((providerBreakdown?.results || []).map(r => [r.provider, { calls: r.c, cost: r.cost }])));
  const modelJson = JSON.stringify(Object.fromEntries((modelBreakdown?.results || []).map(r => [r.model, r.c])));
  const digestSummary = `snapshot:${String(reason)} spend $${tt?.cost_usd ?? 0} | deploys ${dt?.total ?? 0}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO daily_snapshots (
      snapshot_date, deploy_count, tokens_in, tokens_out, cost_usd,
      provider_breakdown, model_breakdown,
      active_workflows,
      completed_steps, total_steps, active_plan_id,
      digest_text, created_at, updated_at
    ) VALUES (
      date('now'), ?, ?, ?, ?,
      ?, ?,
      15,
      ?, ?, ?,
      ?, unixepoch(), unixepoch()
    )`
  ).bind(
    dt?.total ?? 0,
    tt?.tokens_in ?? 0,
    tt?.tokens_out ?? 0,
    tt?.cost_usd ?? 0,
    providerJson,
    modelJson,
    planRow?.tasks_done ?? 0,
    planRow?.tasks_total ?? 0,
    planRow?.id ?? null,
    digestSummary
  ).run().catch(() => { });
  rowsWritten += 1;

  // workspace_usage_metrics
  const _wsId = (typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim()) ? env.WORKSPACE_ID.trim() : 'system';
  const _tid = (typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim()) ? env.TENANT_ID.trim() : 'system';
  const [_wai, _wtc, _wmc, _wdc] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c,COALESCE(SUM(tokens_input+tokens_output),0) as t,COALESCE(SUM(cost_estimate),0) as cost FROM agentsam_usage_events WHERE date=date('now')").first().catch(() => null),
    env.DB.prepare("SELECT COUNT(*) as c FROM agentsam_tool_call_log WHERE created_at>=unixepoch('now','start of day')").first().catch(() => null),
    env.DB.prepare("SELECT COUNT(*) as c FROM agentsam_mcp_tool_execution WHERE created_at>=datetime('now','-1 day')").first().catch(() => null),
    env.DB.prepare("SELECT COUNT(*) as c FROM deployment_tracking WHERE created_at>=date('now')").first().catch(() => null),
  ]);
  if (_wsId !== 'system') {
    await env.DB.prepare("INSERT OR REPLACE INTO workspace_usage_metrics (workspace_id,metric_date,ai_calls,tokens_used,cost_estimate_cents,tool_calls,mcp_calls,deployments_count,rollup_source,updated_at) VALUES (?,date('now'),?,?,?,?,?,?,'daily_cron',unixepoch())").bind(_wsId, _wai?.c || 0, _wai?.t || 0, (_wai?.cost || 0) * 100, _wtc?.c || 0, _wmc?.c || 0, _wdc?.c || 0).run().catch(() => { });
    rowsWritten += 1;
  }

  // agentsam_health_daily
  const _hs = await env.DB.prepare("SELECT COUNT(*) as total,SUM(CASE WHEN health_status='green' THEN 1 ELSE 0 END) as g,SUM(CASE WHEN health_status='yellow' THEN 1 ELSE 0 END) as y,SUM(CASE WHEN health_status='red' THEN 1 ELSE 0 END) as r,ROUND(AVG(tools_degraded),2) as ad,ROUND(AVG(tel_cost_24h),6) as ac FROM system_health_snapshots WHERE snapshot_at>=unixepoch('now','start of day')").first().catch(() => null);
  rowsRead += 1;
  if (_hs?.total > 0) {
    await env.DB.prepare("INSERT OR REPLACE INTO agentsam_health_daily (tenant_id,day,snapshot_count,green_count,yellow_count,red_count,avg_tools_degraded,avg_tel_cost_24h,health_status) VALUES (?,date('now'),?,?,?,?,?,?,CASE WHEN ?>0 THEN 'red' WHEN ?>0 THEN 'yellow' ELSE 'green' END)").bind(_tid, _hs.total || 0, _hs.g || 0, _hs.y || 0, _hs.r || 0, _hs.ad || 0, _hs.ac || 0, _hs.r || 0, _hs.y || 0).run().catch(() => { });
    rowsWritten += 1;
  }

  if (runId) {
    await completeCronRun(env, runId, startedAt, {
      rowsRead,
      rowsWritten,
      metadata: { reason: String(reason) },
    });
  }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[writeDailySnapshot]', e?.message ?? e);
  }
}
