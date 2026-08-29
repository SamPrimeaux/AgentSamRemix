/**
 * Live daily usage rollups — replaces ai_provider_usage (per-tenant/workspace/day + provider_breakdown_json).
 */

/** @param {string} provider */
export function rollupProviderKey(provider) {
  const p = String(provider || 'unknown').trim() || 'unknown';
  if (p === 'unknown') return p;
  return p === 'workers_ai' ? 'cloudflare_workers_ai' : p;
}

/**
 * Rebuild provider_breakdown_json from agentsam_usage_events for rollup rows missing breakdown.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ daysBack?: number }} [opts]
 */
export async function repairRollupProviderBreakdowns(db, opts = {}) {
  const daysBack = Math.max(1, Math.min(365, Number(opts.daysBack) || 35));
  const { results } = await db
    .prepare(
      `SELECT tenant_id, workspace_id, day, cost_usd, provider_breakdown_json
       FROM agentsam_usage_rollups_daily
       WHERE day >= date('now', '-' || ? || ' days')
         AND cost_usd > 0`,
    )
    .bind(String(daysBack))
    .all()
    .catch(() => ({ results: [] }));

  let repaired = 0;
  for (const row of results?.results || []) {
    const cur = String(row.provider_breakdown_json || '').trim();
    if (cur && cur !== '{}' && cur.length > 4) continue;

    const { results: evRows } = await db
      .prepare(
        `SELECT
           LOWER(COALESCE(NULLIF(TRIM(provider), ''), 'unknown')) AS prov,
           COUNT(*) AS requests,
           SUM(COALESCE(tokens_in, 0)) AS tokens_in,
           SUM(COALESCE(tokens_out, 0)) AS tokens_out,
           SUM(COALESCE(cost_usd, 0)) AS cost_usd
         FROM agentsam_usage_events
         WHERE tenant_id = ? AND workspace_id = ?
           AND date(datetime(created_at, 'unixepoch')) = ?
         GROUP BY LOWER(COALESCE(NULLIF(TRIM(provider), ''), 'unknown'))`,
      )
      .bind(row.tenant_id, row.workspace_id, row.day)
      .all()
      .catch(() => ({ results: [] }));

    /** @type {Record<string, { requests: number, tokens_in: number, tokens_out: number, cost_usd: number }>} */
    const breakdown = {};
    for (const ev of evRows || []) {
      const prov = rollupProviderKey(ev.prov);
      if (prov === 'unknown') continue;
      breakdown[prov] = {
        requests: Number(ev.requests) || 0,
        tokens_in: Number(ev.tokens_in) || 0,
        tokens_out: Number(ev.tokens_out) || 0,
        cost_usd: Number(ev.cost_usd) || 0,
      };
    }
    if (!Object.keys(breakdown).length) continue;

    await db
      .prepare(
        `UPDATE agentsam_usage_rollups_daily
         SET provider_breakdown_json = ?, rollup_source = COALESCE(rollup_source, 'repaired_breakdown'), rolled_up_at = unixepoch()
         WHERE tenant_id = ? AND workspace_id = ? AND day = ?`,
      )
      .bind(JSON.stringify(breakdown), row.tenant_id, row.workspace_id, row.day)
      .run()
      .catch(() => null);
    repaired += 1;
  }
  return { repaired, scanned: (results?.results || []).length };
}

/** UTC calendar day YYYY-MM-DD */
export function usageRollupDayUtc(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Increment today's rollup row for a telemetry event.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   provider: string,
 *   tokensIn?: number,
 *   tokensOut?: number,
 *   costUsd?: number,
 *   rollupSource?: string,
 * }} opts
 */
export async function incrementAgentsamUsageRollupsDaily(db, {
  tenantId,
  workspaceId,
  provider,
  tokensIn = 0,
  tokensOut = 0,
  costUsd = 0,
  rollupSource = 'telemetry',
}) {
  if (!db) return;
  const tid = String(tenantId || '').trim() || 'default';
  const ws = String(workspaceId || '').trim() || 'system';
  const day = usageRollupDayUtc();
  const prov = rollupProviderKey(provider);
  const tin = Math.floor(Number(tokensIn) || 0);
  const tout = Math.floor(Number(tokensOut) || 0);
  const cost = Number(costUsd) || 0;

  const row = await db
    .prepare(
      `SELECT ai_calls, tokens_in, tokens_out, cost_usd, provider_breakdown_json
       FROM agentsam_usage_rollups_daily
       WHERE tenant_id = ? AND workspace_id = ? AND day = ?
       LIMIT 1`,
    )
    .bind(tid, ws, day)
    .first()
    .catch(() => null);

  /** @type {Record<string, { requests?: number, tokens_in?: number, tokens_out?: number, cost_usd?: number }>} */
  let breakdown = {};
  try {
    const parsed = JSON.parse(String(row?.provider_breakdown_json || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) breakdown = parsed;
  } catch {
    breakdown = {};
  }

  const prev = breakdown[prov] || {};
  breakdown[prov] = {
    requests: (Number(prev.requests) || 0) + 1,
    tokens_in: (Number(prev.tokens_in) || 0) + tin,
    tokens_out: (Number(prev.tokens_out) || 0) + tout,
    cost_usd: (Number(prev.cost_usd) || 0) + cost,
  };

  const aiCalls = (Number(row?.ai_calls) || 0) + 1;
  const tokensInTotal = (Number(row?.tokens_in) || 0) + tin;
  const tokensOutTotal = (Number(row?.tokens_out) || 0) + tout;
  const costTotal = (Number(row?.cost_usd) || 0) + cost;

  await db
    .prepare(
      `INSERT INTO agentsam_usage_rollups_daily (
         tenant_id, workspace_id, day, ai_calls, tokens_in, tokens_out, cost_usd,
         provider_breakdown_json, rollup_source, rolled_up_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(tenant_id, workspace_id, day) DO UPDATE SET
         ai_calls = excluded.ai_calls,
         tokens_in = excluded.tokens_in,
         tokens_out = excluded.tokens_out,
         cost_usd = excluded.cost_usd,
         provider_breakdown_json = excluded.provider_breakdown_json,
         rollup_source = excluded.rollup_source,
         rolled_up_at = excluded.rolled_up_at`,
    )
    .bind(tid, ws, day, aiCalls, tokensInTotal, tokensOutTotal, costTotal, JSON.stringify(breakdown), rollupSource)
    .run()
    .catch((e) => console.warn('[agentsam_usage_rollups_daily] increment failed:', e?.message || e));
}

/** SQL — today's totals across all workspaces (digest / plan email). */
export const SQL_USAGE_ROLLUPS_TODAY_TOTALS = `
  SELECT COALESCE(SUM(ai_calls), 0) AS calls,
         COALESCE(SUM(tokens_in), 0) AS tokens_in,
         COALESCE(SUM(tokens_out), 0) AS tokens_out,
         ROUND(COALESCE(SUM(cost_usd), 0), 4) AS cost_usd,
         (
           SELECT COUNT(DISTINCT j.key)
           FROM agentsam_usage_rollups_daily r2,
                json_each(COALESCE(r2.provider_breakdown_json, '{}')) j
           WHERE r2.day = date('now')
         ) AS models_used
  FROM agentsam_usage_rollups_daily
  WHERE day = date('now')`;

/** SQL — top providers by cost today (digest). */
export const SQL_USAGE_ROLLUPS_TODAY_TOP_PROVIDERS = `
  SELECT j.key AS provider,
         ROUND(SUM(CAST(json_extract(j.value, '$.cost_usd') AS REAL)), 4) AS cost_usd
  FROM agentsam_usage_rollups_daily r,
       json_each(COALESCE(r.provider_breakdown_json, '{}')) j
  WHERE r.day = date('now')
  GROUP BY j.key
  HAVING provider IS NOT NULL AND provider != ''
  ORDER BY cost_usd DESC
  LIMIT 3`;
