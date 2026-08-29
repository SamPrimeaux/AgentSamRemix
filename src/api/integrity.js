export async function runIntegritySnapshot(env, triggeredBy = 'cron') {
  if (!env?.DB) throw new Error('DB unavailable');
  const tb = ['cron', 'manual', 'deploy', 'api'].includes(String(triggeredBy)) ? String(triggeredBy) : 'api';
  const sqlQ1 = `
    SELECT
      COUNT(*) AS rd_total,
      COALESCE(SUM(CASE WHEN task_type = 'unclassified' THEN 1 ELSE 0 END), 0) AS rd_unclassified_task,
      COALESCE(SUM(CASE WHEN model_selected = 'unknown' THEN 1 ELSE 0 END), 0) AS rd_unknown_model,
      COALESCE(SUM(CASE WHEN rule_source = 'unknown' THEN 1 ELSE 0 END), 0) AS rd_unknown_rule_source,
      COALESCE(SUM(completed), 0) AS rd_completed,
      COALESCE(SUM(CASE WHEN completed = 1 AND latency_ms IS NULL THEN 1 ELSE 0 END), 0) AS rd_missing_latency,
      COALESCE(SUM(CASE WHEN completed = 1 AND cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS rd_missing_cost,
      COALESCE(SUM(CASE WHEN completed = 1 AND input_tokens IS NULL THEN 1 ELSE 0 END), 0) AS rd_missing_tokens,
      ROUND(100.0 * COALESCE(SUM(CASE WHEN completed = 1 AND latency_ms IS NOT NULL AND cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0)
        / NULLIF(COALESCE(SUM(completed), 0), 0), 1) AS rd_pct_complete_valid
    FROM routing_decisions`;
  const sqlQ2 = `
    SELECT
      COALESCE(SUM(CASE WHEN created_at >= (unixepoch() - 86400) THEN 1 ELSE 0 END), 0) AS tel_total_24h,
      COALESCE(SUM(CASE WHEN created_at >= (unixepoch() - 604800) THEN 1 ELSE 0 END), 0) AS tel_total_7d,
      COALESCE(SUM(CASE WHEN created_at >= (unixepoch() - 86400) THEN cost_usd ELSE 0 END), 0) AS tel_cost_24h,
      COALESCE(SUM(CASE WHEN created_at >= (unixepoch() - 604800) THEN cost_usd ELSE 0 END), 0) AS tel_cost_7d
    FROM agentsam_usage_events`;
  const sqlQ3 = `
    SELECT provider, COUNT(*) AS n, SUM(cost_usd) AS cost
    FROM agentsam_usage_events WHERE created_at >= (unixepoch() - 604800)
    GROUP BY provider ORDER BY n DESC`;
  const sqlQ4 = `
    SELECT
      COUNT(*) AS tools_total,
      COALESCE(SUM(is_degraded), 0) AS tools_degraded,
      COALESCE(SUM(CASE WHEN modes_json IS NULL OR modes_json = '' THEN 1 ELSE 0 END), 0) AS tools_missing_modes
    FROM agentsam_tools WHERE COALESCE(is_active, 1) = 1`;
  const sqlQ4b = `
    SELECT tool_key, source_client, cost_basis,
      SUM(error_count) AS error_count,
      SUM(call_count) AS call_count,
      SUM(attributed_model_cost_usd) AS attributed_model_cost_usd,
      ROUND(100.0 * SUM(error_count) / NULLIF(SUM(call_count), 0), 1) AS fail_pct
    FROM agentsam_tool_stats_compacted
    WHERE metric_date >= date('now', '-7 days')
    GROUP BY tool_key, source_client, cost_basis
    HAVING SUM(error_count) > 0
    ORDER BY fail_pct DESC
    LIMIT 5`;
  const sqlQ5 = `
    SELECT
      (SELECT COUNT(*) FROM agentsam_routing_arms) AS intents_total,
      (SELECT COUNT(*) FROM agentsam_routing_arms WHERE total_executions > 0) AS intents_wired,
      (SELECT COUNT(*) FROM agentsam_routing_arms WHERE is_active = 1) AS routing_rules_active,
      (SELECT COUNT(*) FROM agentsam_routing_arms WHERE is_active = 1 AND provider = 'google') AS routing_rules_with_google,
      (SELECT COUNT(*) FROM provider_prompt_fragments WHERE is_active = 1) AS provider_fragments_active`;
  const sqlQ5b = `
    SELECT intent_slug, total_executions FROM agentsam_routing_arms
    WHERE total_executions > 0 ORDER BY total_executions DESC LIMIT 10`;
  const [r1, r2, r3all, r4, r4b, r5, r5b] = await Promise.all([
    env.DB.prepare(sqlQ1).first(),
    env.DB.prepare(sqlQ2).first(),
    env.DB.prepare(sqlQ3).all(),
    env.DB.prepare(sqlQ4).first(),
    env.DB.prepare(sqlQ4b).all(),
    env.DB.prepare(sqlQ5).first(),
    env.DB.prepare(sqlQ5b).all(),
  ]);
  const rd_total = Number(r1?.rd_total) || 0;
  const rd_unclassified_task = Number(r1?.rd_unclassified_task) || 0;
  const rd_unknown_model = Number(r1?.rd_unknown_model) || 0;
  const rd_unknown_rule_source = Number(r1?.rd_unknown_rule_source) || 0;
  const rd_completed = Number(r1?.rd_completed) || 0;
  const rd_missing_latency = Number(r1?.rd_missing_latency) || 0;
  const rd_missing_cost = Number(r1?.rd_missing_cost) || 0;
  const rd_missing_tokens = Number(r1?.rd_missing_tokens) || 0;
  let rd_pct_complete_valid = Number(r1?.rd_pct_complete_valid);
  if (rd_completed === 0) rd_pct_complete_valid = 100;
  else if (!Number.isFinite(rd_pct_complete_valid)) rd_pct_complete_valid = 0;
  const tel_total_24h = Number(r2?.tel_total_24h) || 0;
  const tel_total_7d = Number(r2?.tel_total_7d) || 0;
  const tel_cost_24h = Number(r2?.tel_cost_24h) || 0;
  const tel_cost_7d = Number(r2?.tel_cost_7d) || 0;
  const tel_providers_json = JSON.stringify((r3all?.results ?? []).map((row) => ({
    provider: row.provider,
    n: Number(row.n) || 0,
    cost: Number(row.cost) || 0,
  })));
  const tools_total = Number(r4?.tools_total) || 0;
  const tools_degraded = Number(r4?.tools_degraded) || 0;
  const tools_missing_modes = Number(r4?.tools_missing_modes) || 0;
  const tool_top_failures_json = JSON.stringify(r4b?.results ?? []);
  const intents_total = Number(r5?.intents_total) || 0;
  const intents_wired = Number(r5?.intents_wired) || 0;
  const routing_rules_active = Number(r5?.routing_rules_active) || 0;
  const routing_rules_with_google = Number(r5?.routing_rules_with_google) || 0;
  const provider_fragments_active = Number(r5?.provider_fragments_active) || 0;
  const intents_top_json = JSON.stringify(r5b?.results ?? []);
  const noteParts = [];
  if (rd_missing_cost > 0) noteParts.push('completed routing rows missing cost_usd');
  if (rd_missing_latency > 0) noteParts.push('completed routing rows missing latency_ms');
  if (rd_missing_tokens > 0) noteParts.push('completed routing rows missing input_tokens');
  if (rd_unknown_model > 5) noteParts.push('rd_unknown_model above threshold');
  if (rd_unclassified_task > 10) noteParts.push('rd_unclassified_task above threshold');
  if (tools_degraded > 0) noteParts.push('degraded tools enabled');
  if (rd_pct_complete_valid < 95) noteParts.push('rd_pct_complete_valid below 95');
  if (tools_missing_modes > 0) noteParts.push('enabled tools missing modes_json');
  const isRed = rd_missing_cost > 0 || rd_missing_latency > 0 || rd_unknown_model > 5;
  const isYellow = rd_unclassified_task > 10 || tools_degraded > 0 || rd_pct_complete_valid < 95;
  const health_status = isRed ? 'red' : isYellow ? 'yellow' : 'green';
  const health_notes = noteParts.join(', ');
  const snapId = 'snap_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24).toLowerCase();
  const snapshot_at = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO system_health_snapshots (
      id, triggered_by, snapshot_at,
      rd_total, rd_unclassified_task, rd_unknown_model, rd_unknown_rule_source, rd_completed,
      rd_missing_latency, rd_missing_cost, rd_missing_tokens, rd_pct_complete_valid,
      tel_total_24h, tel_total_7d, tel_cost_24h, tel_cost_7d, tel_providers_json,
      tools_total, tools_degraded, tools_missing_modes, tool_top_failures_json,
      intents_total, intents_wired, intents_top_json,
      routing_rules_active, routing_rules_with_google, provider_fragments_active,
      health_status, health_notes, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    snapId, tb, snapshot_at,
    rd_total, rd_unclassified_task, rd_unknown_model, rd_unknown_rule_source, rd_completed,
    rd_missing_latency, rd_missing_cost, rd_missing_tokens, rd_pct_complete_valid,
    tel_total_24h, tel_total_7d, tel_cost_24h, tel_cost_7d, tel_providers_json,
    tools_total, tools_degraded, tools_missing_modes, tool_top_failures_json,
    intents_total, intents_wired, intents_top_json,
    routing_rules_active, routing_rules_with_google, provider_fragments_active,
    health_status, health_notes, snapshot_at
  ).run();
  return await env.DB.prepare('SELECT * FROM system_health_snapshots WHERE id = ?').bind(snapId).first();
}
