/**
 * agentsam_model_health — short-window operational availability cache.
 *
 * Derived from agentsam_usage_events (model/provider request outcomes).
 * Circuit breaker in front of routing — never trains Thompson α/β,
 * never mutates agentsam_model_catalog.is_degraded.
 */

import { completeCronRun, failCronRun, startCronRun } from '../../../jobs/cron-run-ledger.js';

const TABLE = 'agentsam_model_health';
const USAGE = 'agentsam_usage_events';
const DEFAULT_WINDOW_SECONDS = 3600;
const COOLDOWN_SECONDS = 900;
const CRON_30 = '*/30 * * * *';

/** @type {readonly string[]} */
export const MODEL_HEALTH_STATUSES = Object.freeze([
  'healthy',
  'degraded',
  'unavailable',
  'unknown',
]);

/** @type {readonly string[]} */
export const MODEL_HEALTH_REASON_CODES = Object.freeze([
  'provider_errors',
  'provider_timeout',
  'rate_limited',
  'quota_exhausted',
  'credential_failure',
  'high_latency',
  'consecutive_failures',
  'insufficient_samples',
  'recovered',
]);

const WORKSPACE_ONLY_REASONS = new Set(['quota_exhausted', 'credential_failure']);

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} tableName
 */
async function tableExists(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return false;
  const row = await db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .bind(safe)
    .first()
    .catch(() => null);
  return !!row?.ok;
}

/**
 * @param {number[]} sorted
 * @param {number} p 0..1
 */
function percentileNearest(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(Number(sorted[idx]) || 0);
}

/**
 * Classify a usage_events row into health outcome buckets.
 * blocked → ignore (not model health). partial → success (call worked; pricing failed).
 * @param {{ status?: string|null, reason?: string|null, succeeded?: number|null }} row
 * @returns {'success'|'error'|'timeout'|'ignore'}
 */
export function classifyUsageOutcome(row) {
  const status = String(row?.status || '')
    .trim()
    .toLowerCase();
  if (status === 'blocked' || status === 'cancelled' || status === 'canceled' || status === 'skipped') {
    return 'ignore';
  }
  if (status === 'timeout' || status === 'timed_out') return 'timeout';
  if (status === 'error' || status === 'failed' || status === 'failure') return 'error';
  if (status === 'ok' || status === 'success' || status === 'partial' || status === '') {
    if (row?.succeeded === 0) return 'error';
    return 'success';
  }
  if (row?.succeeded === 0) return 'error';
  if (row?.succeeded === 1) return 'success';
  return 'ignore';
}

/**
 * @param {string|null|undefined} reason
 * @param {'error'|'timeout'} outcome
 * @returns {string}
 */
export function classifyFailureReasonCode(reason, outcome) {
  const r = String(reason || '')
    .trim()
    .toLowerCase();
  if (outcome === 'timeout') return 'provider_timeout';
  if (/quota|credits?\s*exhaust|billing|payment\s*required|insufficient[_\s]?quota/.test(r)) {
    return 'quota_exhausted';
  }
  if (
    /api[_\s-]?key|invalid[_\s-]?key|unauthorized|authentication|credential|401\b|403\b|forbidden|key_required/.test(
      r,
    )
  ) {
    return 'credential_failure';
  }
  if (/rate[_\s-]?limit|429\b|too\s*many\s*requests/.test(r)) return 'rate_limited';
  if (/timeout|timed\s*out|deadline/.test(r)) return 'provider_timeout';
  return 'provider_errors';
}

/**
 * Boring status rules — latency alone never marks unavailable.
 * @param {{
 *   sampleCount: number,
 *   errorRate: number,
 *   timeoutRate: number,
 *   consecutiveFailures: number,
 *   p95LatencyMs?: number|null,
 * }} p
 * @returns {{ status: string, reason_code: string|null }}
 */
export function computeModelHealthStatus(p) {
  const samples = Math.max(0, Math.floor(Number(p.sampleCount) || 0));
  const errorRate = Number(p.errorRate) || 0;
  const timeoutRate = Number(p.timeoutRate) || 0;
  const consecutiveFailures = Math.max(0, Math.floor(Number(p.consecutiveFailures) || 0));
  const p95 = p.p95LatencyMs != null ? Number(p.p95LatencyMs) : null;

  if (samples === 0) {
    return { status: 'unknown', reason_code: 'insufficient_samples' };
  }

  if (consecutiveFailures >= 3 || (samples >= 5 && errorRate >= 0.5)) {
    return {
      status: 'unavailable',
      reason_code: consecutiveFailures >= 3 ? 'consecutive_failures' : 'provider_errors',
    };
  }

  if ((samples >= 5 && errorRate >= 0.15) || timeoutRate >= 0.1) {
    return {
      status: 'degraded',
      reason_code: timeoutRate >= 0.1 ? 'provider_timeout' : 'provider_errors',
    };
  }

  if (p95 != null && Number.isFinite(p95) && p95 >= 60_000 && samples >= 3) {
    return { status: 'degraded', reason_code: 'high_latency' };
  }

  return { status: 'healthy', reason_code: null };
}

/**
 * @param {Array<{ outcome: string, at: number, reason?: string|null }>} events newest-last or any order
 */
function consecutiveFailureStreak(events) {
  const ordered = [...events].sort((a, b) => Number(a.at) - Number(b.at));
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const o = ordered[i].outcome;
    if (o === 'success') break;
    if (o === 'error' || o === 'timeout') streak += 1;
  }
  return streak;
}

/**
 * @param {Map<string, any>} groups
 * @param {string} key
 * @param {object} seed
 */
function ensureGroup(groups, key, seed) {
  let g = groups.get(key);
  if (!g) {
    g = {
      ...seed,
      events: [],
      latencies: [],
      reasonVotes: /** @type {Record<string, number>} */ ({}),
    };
    groups.set(key, g);
  }
  return g;
}

/**
 * @param {any} g
 * @param {{ outcome: string, at: number, reason?: string|null, duration_ms?: number|null }} ev
 * @param {boolean} countTowardRates
 */
function pushEvent(g, ev, countTowardRates = true) {
  g.events.push(ev);
  if (!countTowardRates) return;
  if (ev.duration_ms != null && Number.isFinite(Number(ev.duration_ms)) && Number(ev.duration_ms) >= 0) {
    g.latencies.push(Number(ev.duration_ms));
  }
  if (ev.outcome === 'error' || ev.outcome === 'timeout') {
    const code = classifyFailureReasonCode(ev.reason, ev.outcome === 'timeout' ? 'timeout' : 'error');
    g.reasonVotes[code] = (g.reasonVotes[code] || 0) + 1;
  }
}

/**
 * @param {Record<string, number>} votes
 * @returns {string|null}
 */
function dominantReason(votes) {
  let best = null;
  let n = 0;
  for (const [k, v] of Object.entries(votes || {})) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

/**
 * @param {any} g
 * @param {{ windowStartedAt: number, windowSeconds: number, computedAt: number }} meta
 */
function finalizeGroup(g, meta) {
  const outcomes = g.events.filter((e) => e.outcome === 'success' || e.outcome === 'error' || e.outcome === 'timeout');
  const sampleCount = outcomes.length;
  const successCount = outcomes.filter((e) => e.outcome === 'success').length;
  const errorCount = outcomes.filter((e) => e.outcome === 'error').length;
  const timeoutCount = outcomes.filter((e) => e.outcome === 'timeout').length;
  const successRate = sampleCount ? successCount / sampleCount : null;
  const errorRate = sampleCount ? errorCount / sampleCount : null;
  const timeoutRate = sampleCount ? timeoutCount / sampleCount : null;
  const sortedLat = [...g.latencies].sort((a, b) => a - b);
  const p50 = percentileNearest(sortedLat, 0.5);
  const p95 = percentileNearest(sortedLat, 0.95);
  const consecutiveFailures = consecutiveFailureStreak(outcomes);

  let lastSuccessAt = null;
  let lastErrorAt = null;
  for (const e of outcomes) {
    if (e.outcome === 'success') {
      if (lastSuccessAt == null || e.at > lastSuccessAt) lastSuccessAt = e.at;
    } else if (e.outcome === 'error' || e.outcome === 'timeout') {
      if (lastErrorAt == null || e.at > lastErrorAt) lastErrorAt = e.at;
    }
  }

  const computed = computeModelHealthStatus({
    sampleCount,
    errorRate: errorRate ?? 0,
    timeoutRate: timeoutRate ?? 0,
    consecutiveFailures,
    p95LatencyMs: p95,
  });

  let reasonCode = computed.reason_code;
  if (computed.status === 'unavailable' || computed.status === 'degraded') {
    const dom = dominantReason(g.reasonVotes);
    if (dom) reasonCode = dom;
    else if (computed.reason_code === 'high_latency') reasonCode = 'high_latency';
  } else if (computed.status === 'healthy' && lastErrorAt != null) {
    reasonCode = 'recovered';
  }

  const cooldownUntil =
    computed.status === 'unavailable' ? meta.computedAt + COOLDOWN_SECONDS : null;

  return {
    model_key: g.model_key,
    workspace_id: g.workspace_id,
    status: computed.status,
    window_started_at: meta.windowStartedAt,
    window_seconds: meta.windowSeconds,
    sample_count: sampleCount,
    success_count: successCount,
    error_count: errorCount,
    timeout_count: timeoutCount,
    success_rate: successRate,
    error_rate: errorRate,
    timeout_rate: timeoutRate,
    p50_latency_ms: p50,
    p95_latency_ms: p95,
    consecutive_failures: consecutiveFailures,
    last_success_at: lastSuccessAt,
    last_error_at: lastErrorAt,
    reason_code: reasonCode,
    cooldown_until: cooldownUntil,
    computed_at: meta.computedAt,
    updated_at: meta.computedAt,
  };
}

/**
 * Roll up recent usage_events → agentsam_model_health (full replace of derived cache).
 * @param {any} env
 * @param {{ windowSeconds?: number, nowUnix?: number }} [opts]
 */
export async function rollupModelHealth(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db', changes: 0 };
  if (!(await tableExists(env.DB, TABLE))) {
    return { ok: false, skipped: true, reason: 'model_health_missing', changes: 0 };
  }
  if (!(await tableExists(env.DB, USAGE))) {
    return { ok: false, skipped: true, reason: 'usage_events_missing', changes: 0 };
  }

  const usageCols = new Set(['created_at_unix', 'created_at', 'model_key']);
  const tsExpr = usageCols.has('created_at_unix')
    ? 'COALESCE(NULLIF(created_at_unix, 0), created_at)'
    : usageCols.has('created_at')
      ? 'created_at'
      : null;
  if (!tsExpr) {
    return { ok: false, skipped: true, reason: 'usage_events_no_timestamp', changes: 0 };
  }

  const windowSeconds = Math.max(
    300,
    Math.floor(Number(opts.windowSeconds) || DEFAULT_WINDOW_SECONDS),
  );
  const computedAt = Math.floor(Number(opts.nowUnix) || Date.now() / 1000);
  const windowStartedAt = computedAt - windowSeconds;

  const modelExpr = usageCols.has('model_key')
    ? "COALESCE(NULLIF(trim(model_key), ''), NULLIF(trim(model), ''), 'unknown')"
    : "COALESCE(NULLIF(trim(model), ''), 'unknown')";

  const { results: rows } = await env.DB.prepare(
    `SELECT
       ${modelExpr} AS model_key,
       COALESCE(NULLIF(trim(workspace_id), ''), '') AS workspace_id,
       status,
       reason,
       succeeded,
       duration_ms,
       ${tsExpr} AS ts
     FROM ${USAGE}
     WHERE ${tsExpr} >= ?
       AND ${tsExpr} < ?
       AND LOWER(COALESCE(NULLIF(trim(event_type), ''), '')) NOT IN ('tool_exec', 'tool_execution')`,
  )
    .bind(windowStartedAt, computedAt)
    .all()
    .catch((e) => {
      throw new Error(`model_health_rollup: query_failed: ${e?.message ?? e}`);
    });

  /** @type {Map<string, any>} */
  const groups = new Map();
  const meta = { windowStartedAt, windowSeconds, computedAt };

  for (const r of rows || []) {
    const modelKey = String(r.model_key || '').trim();
    if (!modelKey || modelKey === 'unknown') continue;
    const workspaceId = String(r.workspace_id || '').trim();
    const outcome = classifyUsageOutcome(r);
    if (outcome === 'ignore') continue;

    const at = Math.floor(Number(r.ts) || 0);
    const ev = {
      outcome,
      at,
      reason: r.reason,
      duration_ms: r.duration_ms,
    };

    const failCode =
      outcome === 'error' || outcome === 'timeout'
        ? classifyFailureReasonCode(r.reason, outcome === 'timeout' ? 'timeout' : 'error')
        : null;
    const workspaceOnly = failCode != null && WORKSPACE_ONLY_REASONS.has(failCode);

    // Workspace-specific row
    if (workspaceId) {
      const wsKey = `${modelKey}\0${workspaceId}`;
      const wsG = ensureGroup(groups, wsKey, { model_key: modelKey, workspace_id: workspaceId });
      pushEvent(wsG, ev, true);
    }

    // Global row — credential/quota failures stay workspace-scoped
    const globalKey = `${modelKey}\0`;
    const gG = ensureGroup(groups, globalKey, { model_key: modelKey, workspace_id: '' });
    if (!workspaceOnly) {
      pushEvent(gG, ev, true);
    } else if (outcome === 'success') {
      pushEvent(gG, ev, true);
    }
  }

  const finalized = [...groups.values()].map((g) => finalizeGroup(g, meta));

  await env.DB.prepare(`DELETE FROM ${TABLE}`).run();

  let changes = 0;
  const stmts = finalized.map((row) =>
    env.DB.prepare(
      `INSERT INTO ${TABLE} (
        model_key, workspace_id, status,
        window_started_at, window_seconds,
        sample_count, success_count, error_count, timeout_count,
        success_rate, error_rate, timeout_rate,
        p50_latency_ms, p95_latency_ms,
        consecutive_failures,
        last_success_at, last_error_at,
        reason_code, cooldown_until,
        computed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.model_key,
      row.workspace_id,
      row.status,
      row.window_started_at,
      row.window_seconds,
      row.sample_count,
      row.success_count,
      row.error_count,
      row.timeout_count,
      row.success_rate,
      row.error_rate,
      row.timeout_rate,
      row.p50_latency_ms,
      row.p95_latency_ms,
      row.consecutive_failures,
      row.last_success_at,
      row.last_error_at,
      row.reason_code,
      row.cooldown_until,
      row.computed_at,
      row.updated_at,
    ),
  );

  // D1 batch limit ~100; chunk if needed
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    if (!chunk.length) continue;
    await env.DB.batch(chunk);
    changes += chunk.length;
  }

  return {
    ok: true,
    skipped: false,
    changes,
    window_seconds: windowSeconds,
    window_started_at: windowStartedAt,
    computed_at: computedAt,
    models: finalized.length,
  };
}

/**
 * Cron wrapper with ledger.
 * @param {any} env
 */
export async function runModelHealthRollupCron(env) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };
  const begun = await startCronRun(env, {
    jobName: 'agentsam_model_health_rollup',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const result = await rollupModelHealth(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: Number(result.models) || 0,
        rowsWritten: Number(result.changes) || 0,
        metadata: result,
      });
    }
    return result;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] model_health_rollup', e?.message ?? e);
    throw e;
  }
}

/**
 * @param {{ status?: string|null, cooldown_until?: number|null }} row
 * @param {number} [nowUnix]
 */
export function isHealthRowBlocking(row, nowUnix = Math.floor(Date.now() / 1000)) {
  if (!row) return false;
  const cooldown = row.cooldown_until != null ? Number(row.cooldown_until) : null;
  if (cooldown != null && Number.isFinite(cooldown) && cooldown > nowUnix) return true;
  return String(row.status || '').toLowerCase() === 'unavailable';
}

/**
 * Load health rows for routing filter (global + optional workspace).
 * Missing / unknown / degraded → not blocking.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string|null|undefined} workspaceId
 * @returns {Promise<Map<string, { status: string, cooldown_until: number|null, reason_code: string|null }>>}
 */
export async function loadModelHealthMap(db, workspaceId = null) {
  /** @type {Map<string, { status: string, cooldown_until: number|null, reason_code: string|null }>} */
  const map = new Map();
  if (!db || !(await tableExists(db, TABLE))) return map;

  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const { results } = await db
    .prepare(
      ws
        ? `SELECT model_key, workspace_id, status, cooldown_until, reason_code
           FROM ${TABLE}
           WHERE workspace_id = '' OR workspace_id = ?`
        : `SELECT model_key, workspace_id, status, cooldown_until, reason_code
           FROM ${TABLE}
           WHERE workspace_id = ''`,
    )
    .bind(...(ws ? [ws] : []))
    .all()
    .catch(() => ({ results: [] }));

  for (const r of results || []) {
    const mk = String(r.model_key || '').trim();
    if (!mk) continue;
    const wid = String(r.workspace_id || '').trim();
    map.set(`${mk}\0${wid}`, {
      status: String(r.status || 'unknown'),
      cooldown_until: r.cooldown_until != null ? Number(r.cooldown_until) : null,
      reason_code: r.reason_code != null ? String(r.reason_code) : null,
    });
  }
  return map;
}

/**
 * Workspace unavailable beats global healthy; global unavailable blocks everyone.
 * unknown / degraded / missing → eligible.
 * @param {Map<string, { status: string, cooldown_until: number|null, reason_code: string|null }>} healthMap
 * @param {string} modelKey
 * @param {string|null|undefined} workspaceId
 * @param {number} [nowUnix]
 */
export function isModelUnavailableForRouting(healthMap, modelKey, workspaceId = null, nowUnix) {
  const mk = String(modelKey || '').trim();
  if (!mk || !healthMap?.size) return false;
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const wsRow = ws ? healthMap.get(`${mk}\0${ws}`) : null;
  if (wsRow && isHealthRowBlocking(wsRow, now)) return true;
  const globalRow = healthMap.get(`${mk}\0`);
  if (globalRow && isHealthRowBlocking(globalRow, now)) return true;
  return false;
}

/**
 * Filter Thompson/policy candidates — drops unavailable / cooldown only.
 * @template {{ model_key?: string }} T
 * @param {T[]} candidates
 * @param {Map<string, any>} healthMap
 * @param {string|null|undefined} workspaceId
 * @returns {T[]}
 */
export function filterCandidatesByModelHealth(candidates, healthMap, workspaceId = null) {
  if (!Array.isArray(candidates) || !candidates.length) return candidates || [];
  if (!healthMap?.size) return candidates;
  return candidates.filter(
    (c) => !isModelUnavailableForRouting(healthMap, c?.model_key, workspaceId),
  );
}
