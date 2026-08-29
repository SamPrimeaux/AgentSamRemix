/**
 * D1 + Supabase reads for /api/health/* (defensive: empty payloads on missing tables).
 */
import { supabaseGetJson } from './supabaseRest.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1All(db, sql, binds = []) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch {
    return [];
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1First(db, sql, binds = []) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

const LIMIT = 80;

/**
 * @param {any} env
 */
export async function fetchAgentHealthSupabase(env) {
  const baseSel = `select=*&order=created_at.desc.nullslast&limit=${LIMIT}`;
  const [stream, routing, toolCalls, errors] = await Promise.all([
    supabaseGetJson(env, `/rest/v1/agentsam_stream_events?${baseSel}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/agentsam_routing_decisions?${baseSel}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/agentsam_tool_call_events?${baseSel}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/agentsam_error_events?${baseSel}`, 'agentsam'),
  ]);

  const stream_events = Array.isArray(stream.data) ? stream.data : [];
  const routing_decisions = Array.isArray(routing.data) ? routing.data : [];
  const tool_calls = Array.isArray(toolCalls.data) ? toolCalls.data : [];
  const error_events = Array.isArray(errors.data) ? errors.data : [];

  let successCount = 0;
  let failCount = 0;
  for (const t of tool_calls) {
    if (t && (t.success === true || t.success === 1 || String(t.success).toLowerCase() === 'true')) successCount += 1;
    else if (t && t.success != null) failCount += 1;
  }
  const denom = successCount + failCount;
  const success_rate = denom > 0 ? Math.round((10000 * successCount) / denom) / 100 : null;

  const latencies = tool_calls.map((t) => Number(t.duration_ms)).filter((n) => Number.isFinite(n) && n > 0);
  const avg_latency_ms =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  const firstTok = stream_events
    .map((s) => Number(s.first_token_ms ?? s.time_to_first_token_ms ?? s.ttf_ms))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avg_first_token_ms =
    firstTok.length > 0 ? Math.round(firstTok.reduce((a, b) => a + b, 0) / firstTok.length) : null;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  let cost_usd_today = 0;
  for (const s of stream_events) {
    const ca = s.created_at || s.started_at;
    if (ca && String(ca) >= todayIso.slice(0, 10)) {
      cost_usd_today += Number(s.cost_usd ?? s.total_cost_usd ?? 0) || 0;
    }
  }

  const modelCounts = new Map();
  const modelCosts = new Map();
  for (const s of stream_events) {
    const m = String(s.model ?? s.model_key ?? 'unknown').trim() || 'unknown';
    modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
    modelCosts.set(m, (modelCosts.get(m) || 0) + (Number(s.cost_usd ?? 0) || 0));
  }
  const top_models = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count, cost: Math.round((modelCosts.get(model) || 0) * 10000) / 10000 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  let fallback = 0;
  let routTotal = 0;
  for (const r of routing_decisions) {
    routTotal += 1;
    const fb = r.fallback === true || r.fallback === 1 || String(r.chosen_route || '').toLowerCase().includes('fallback');
    if (fb) fallback += 1;
  }
  const fallback_rate = routTotal > 0 ? Math.round((10000 * fallback) / routTotal) / 100 : null;

  return {
    stream_events,
    routing_decisions,
    tool_calls,
    error_events,
    success_rate,
    avg_latency_ms,
    avg_first_token_ms,
    cost_usd_today: Math.round(cost_usd_today * 10000) / 10000,
    top_models,
    fallback_rate,
    _supabase_ok: stream.ok || routing.ok || toolCalls.ok || errors.ok,
  };
}

/**
 * @param {any} env
 */
export async function fetchWorkerHealth(env) {
  const db = env?.DB;
  let schema_ready = true;
  let has_data = false;

  const hourly = await d1All(
    db,
    `SELECT hour_timestamp, total_requests, failed_requests, avg_duration_ms, p95_duration_ms
     FROM worker_analytics_hourly
     WHERE datetime(hour_timestamp) >= datetime('now','-24 hours')
     ORDER BY hour_timestamp ASC`,
  );

  let rollup_24h = { requests: 0, errors: 0, avg_duration_ms: null, p95_duration_ms: null };
  if (hourly.length) {
    has_data = true;
    let durSum = 0;
    let durN = 0;
    let p95max = 0;
    for (const h of hourly) {
      rollup_24h.requests += Number(h.total_requests) || 0;
      rollup_24h.errors += Number(h.failed_requests) || 0;
      const d = Number(h.avg_duration_ms);
      if (Number.isFinite(d) && d > 0) {
        durSum += d;
        durN += 1;
      }
      const p95 = Number(h.p95_duration_ms);
      if (Number.isFinite(p95) && p95 > p95max) p95max = p95;
    }
    rollup_24h.avg_duration_ms = durN > 0 ? Math.round(durSum / durN) : null;
    rollup_24h.p95_duration_ms = p95max > 0 ? Math.round(p95max) : null;
  }

  const top_paths = await d1All(
    db,
    `SELECT path, COUNT(*) AS c
     FROM worker_analytics_errors
     WHERE created_at >= unixepoch('now','-24 hours')
     GROUP BY path
     ORDER BY c DESC
     LIMIT 12`,
  );

  let error_summary = await d1All(
    db,
    `SELECT path, method, status_code, error_message, created_at
     FROM worker_analytics_errors
     ORDER BY created_at DESC
     LIMIT 25`,
  );
  if (!error_summary.length) {
    error_summary = await d1All(
      db,
      `SELECT path, method, status_code, error_message, timestamp AS created_at
       FROM worker_analytics_errors
       ORDER BY timestamp DESC
       LIMIT 25`,
    );
  }
  if (error_summary.length) has_data = true;

  const [we, werr, wh, wd] = await Promise.all([
    supabaseGetJson(env, `/rest/v1/worker_events?select=*&order=created_at.desc.nullslast&limit=${LIMIT}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/worker_errors?select=*&order=created_at.desc.nullslast&limit=${LIMIT}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/worker_hourly_rollups?select=*&order=hour_start.desc.nullslast&limit=48`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/worker_daily_rollups?select=*&order=day.desc.nullslast&limit=14`, 'agentsam'),
  ]);

  const supabase_worker = {
    worker_events: Array.isArray(we.data) ? we.data : [],
    worker_errors: Array.isArray(werr.data) ? werr.data : [],
    worker_hourly_rollups: Array.isArray(wh.data) ? wh.data : [],
    worker_daily_rollups: Array.isArray(wd.data) ? wd.data : [],
  };
  if (
    supabase_worker.worker_events.length ||
    supabase_worker.worker_errors.length ||
    supabase_worker.worker_hourly_rollups.length
  ) {
    has_data = true;
  }

  return {
    schema_ready,
    has_data,
    rollup_24h,
    top_paths: (top_paths || []).map((r) => ({ path: r.path, count: Number(r.c) || 0 })),
    error_summary,
    supabase_worker,
  };
}

/**
 * @param {any} env
 */
export async function fetchMcpHealthRows(env) {
  const res = await supabaseGetJson(
    env,
    `/rest/v1/mcp_health_checks?select=*&order=checked_at.desc.nullslast&limit=200`,
    'agentsam',
  );
  const rows = Array.isArray(res.data) ? res.data : [];
  const byTool = new Map();
  for (const r of rows) {
    const name = String(r.tool_name || r.tool || 'unknown').trim() || 'unknown';
    if (!byTool.has(name)) byTool.set(name, r);
  }
  const tools = [...byTool.values()].map((r) => ({
    tool_name: String(r.tool_name || r.tool || ''),
    status: String(r.status || 'unknown'),
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    last_checked: r.checked_at || r.last_checked_at || null,
    success_rate: r.success_rate != null ? Number(r.success_rate) : null,
    last_error: r.last_error || r.error || null,
  }));
  return { tools, raw_count: rows.length };
}

/**
 * @param {any} env
 */
export async function fetchModelsHealth(env) {
  const lim = `limit=${LIMIT}`;
  const [snapshots, routing, streams] = await Promise.all([
    supabaseGetJson(env, `/rest/v1/agentsam_model_cost_snapshots?select=*&order=captured_at.desc.nullslast&${lim}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/agentsam_routing_decisions?select=*&order=created_at.desc.nullslast&${lim}`, 'agentsam'),
    supabaseGetJson(env, `/rest/v1/agentsam_stream_events?select=*&order=created_at.desc.nullslast&${lim}`, 'agentsam'),
  ]);

  const sn = Array.isArray(snapshots.data) ? snapshots.data : [];
  const rt = Array.isArray(routing.data) ? routing.data : [];
  const st = Array.isArray(streams.data) ? streams.data : [];

  const cost_by_model = [];
  const byM = new Map();
  for (const r of sn) {
    const model = String(r.model ?? r.model_key ?? 'unknown').trim() || 'unknown';
    const cost = Number(r.cost_usd ?? r.total_cost_usd ?? 0) || 0;
    byM.set(model, (byM.get(model) || 0) + cost);
  }
  for (const [model, cost] of byM.entries()) {
    cost_by_model.push({ model, cost_usd: Math.round(cost * 10000) / 10000 });
  }
  cost_by_model.sort((a, b) => b.cost_usd - a.cost_usd);

  const cost_by_provider = [];
  const byP = new Map();
  for (const r of rt) {
    const p = String(r.provider ?? r.provider_slug ?? 'unknown').trim() || 'unknown';
    const cost = Number(r.estimated_cost_usd ?? r.cost_usd ?? 0) || 0;
    byP.set(p, (byP.get(p) || 0) + cost);
  }
  for (const [provider, cost_usd] of byP.entries()) {
    cost_by_provider.push({ provider, cost_usd: Math.round(cost_usd * 10000) / 10000 });
  }
  cost_by_provider.sort((a, b) => b.cost_usd - a.cost_usd);

  const token_volume = [];
  const byMv = new Map();
  for (const r of st) {
    const model = String(r.model ?? r.model_key ?? 'unknown').trim() || 'unknown';
    const tok = Number(r.total_tokens ?? r.token_count ?? 0) || 0;
    byMv.set(model, (byMv.get(model) || 0) + tok);
  }
  for (const [model, tokens] of byMv.entries()) {
    token_volume.push({ model, tokens });
  }
  token_volume.sort((a, b) => b.tokens - a.tokens);

  const latency_vs_cost = [];
  for (const r of st.slice(0, 40)) {
    latency_vs_cost.push({
      model: String(r.model ?? r.model_key ?? ''),
      latency_ms: Number(r.duration_ms ?? r.latency_ms ?? 0) || null,
      cost_usd: Number(r.cost_usd ?? 0) || 0,
    });
  }

  const success_by_model = [];
  const sm = new Map();
  for (const r of rt) {
    const model = String(r.model ?? r.model_key ?? 'unknown').trim() || 'unknown';
    if (!sm.has(model)) sm.set(model, { ok: 0, bad: 0 });
    const row = sm.get(model);
    const ok = r.success === true || r.success === 1 || String(r.outcome || '').toLowerCase() === 'ok';
    if (ok) row.ok += 1;
    else row.bad += 1;
  }
  for (const [model, v] of sm.entries()) {
    const t = v.ok + v.bad;
    success_by_model.push({
      model,
      success_rate: t > 0 ? Math.round((10000 * v.ok) / t) / 100 : null,
    });
  }

  return { cost_by_model, cost_by_provider, token_volume, latency_vs_cost, success_by_model };
}

/**
 * @param {any} env
 */
export async function fetchDeploymentsHealth(env) {
  const db = env?.DB;
  const deployments = await d1All(
    db,
    `SELECT id, status, environment, timestamp, version, git_hash, description, duration_seconds, created_at
     FROM deployments
     ORDER BY COALESCE(created_at,0) DESC, timestamp DESC
     LIMIT 30`,
  );

  const now = Math.floor(Date.now() / 1000);
  const day7 = now - 7 * 86400;
  const row7 = await d1First(
    db,
    `SELECT COUNT(*) AS c FROM deployments WHERE COALESCE(created_at,0) >= ?`,
    [day7],
  );
  const deploy_count_7d = Number(row7?.c) || 0;

  let last_success_at = null;
  let last_failure_at = null;
  for (const d of deployments) {
    const st = String(d.status || '').toLowerCase();
    const ts = d.timestamp || (d.created_at ? new Date(Number(d.created_at) * 1000).toISOString() : null);
    if (st === 'success' && !last_success_at) last_success_at = ts;
    if ((st === 'failed' || st === 'failure' || st === 'error') && !last_failure_at) last_failure_at = ts;
  }

  const d1Extra = await d1All(
    db,
    `SELECT id, status, environment, ai_cost_usd, created_at
     FROM agentsam_deployment_health
     ORDER BY COALESCE(created_at,0) DESC
     LIMIT 20`,
  );

  const sb = await supabaseGetJson(
    env,
    `/rest/v1/build_deploy_events?select=*&order=created_at.desc.nullslast&limit=30`,
    'public',
  );
  const sbRows = Array.isArray(sb.data) ? sb.data : [];

  const mapped = (deployments || []).map((d) => ({
    id: d.id,
    status: d.status,
    environment: d.environment,
    ai_cost_usd: null,
    created_at: d.timestamp || d.created_at,
  }));

  return {
    deployments: mapped,
    d1_agentsam_deployment_health: d1Extra,
    supabase_build_deploy_events: sbRows,
    last_success_at,
    last_failure_at,
    deploy_count_7d,
  };
}
