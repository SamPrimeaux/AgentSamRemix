/**
 * Finance summary enrichment (D1 + Supabase). SUPERADMIN ONLY — never call for scoped tenant users.
 */
import { supabaseGetJson } from './health/supabaseRest.js';

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

function emptyFinanceAnalyticsExtension() {
  return {
    mrr: 0,
    total_spend_month: 0,
    ai_cost_month: 0,
    cost_by_model: [],
    forecast: [],
    billing_plan: null,
    token_spend_trend: [],
    founder_metrics_recent: [],
    tokens_month: 0,
    _scoped: true,
  };
}

/**
 * @param {string|null|undefined} tenantId
 * @param {string|null|undefined} workspaceId
 */
function buildUsageScope(tenantId, workspaceId) {
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const ws =
    workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;
  if (tid && ws) {
    return { sql: 'tenant_id = ? AND workspace_id = ?', binds: [tid, ws] };
  }
  if (tid) {
    return { sql: 'tenant_id = ?', binds: [tid] };
  }
  return null;
}

/**
 * Enrichment merged into GET /api/finance/summary (superadmin path only).
 * @param {any} env
 * @param {{
 *   isSuperadmin?: boolean,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 * } | string | null} scopeOrTenantId — legacy: bare tenantId string
 */
export async function buildFinanceAnalyticsExtension(env, scopeOrTenantId = null) {
  const scope =
    scopeOrTenantId != null && typeof scopeOrTenantId === 'object'
      ? scopeOrTenantId
      : { tenantId: scopeOrTenantId, isPlatformOperator: false };

  const isPlatformOperator = scope.isSuperadmin === true;
  if (!isPlatformOperator) {
    return emptyFinanceAnalyticsExtension();
  }

  const db = env?.DB;
  const tid =
    scope.tenantId != null && String(scope.tenantId).trim()
      ? String(scope.tenantId).trim()
      : null;
  const ws =
    scope.workspaceId != null && String(scope.workspaceId).trim()
      ? String(scope.workspaceId).trim()
      : null;
  const usageScope = buildUsageScope(tid, ws);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthStartSec = Math.floor(new Date(`${monthStart}T00:00:00Z`).getTime() / 1000);

  const mrrRow = tid
    ? await d1First(
        db,
        `SELECT COALESCE(SUM(
        CAST(json_extract(bp.features_json, '$.public_pricing.usd_monthly') AS REAL)
      ), 0) AS mrr
     FROM billing_subscriptions bs
     JOIN billing_plans bp ON bp.id = bs.plan_id
     WHERE LOWER(COALESCE(bs.status,'')) IN ('active','trialing') AND bs.tenant_id = ?`,
        [tid],
      )
    : { mrr: 0 };

  const total_spend_month = tid
    ? await d1First(
        db,
        `SELECT COALESCE(SUM(ABS(amount_cents)), 0) / 100.0 AS v
         FROM finance_transactions
         WHERE tenant_id = ?
           AND date >= ?
           AND LOWER(direction) IN ('debit', 'expense', 'out')`,
        [tid, monthStart],
      )
    : { v: 0 };

  const usageMonth = usageScope
    ? await d1First(
        db,
        `SELECT COALESCE(SUM(COALESCE(cost_usd,0)),0) AS v,
                COALESCE(SUM(COALESCE(total_tokens, COALESCE(tokens_in,0) + COALESCE(tokens_out,0), 0)),0) AS tokens
         FROM agentsam_usage_events
         WHERE ${usageScope.sql} AND COALESCE(created_at,0) >= ?`,
        [...usageScope.binds, monthStartSec],
      )
    : { v: 0, tokens: 0 };

  // founder_metrics has no tenant_id — operator-only wellness rows (superadmin gate above).
  const founder = await d1All(
    db,
    `SELECT date, energy_level, stress_level, sleep_hours, notes
     FROM founder_metrics ORDER BY date DESC LIMIT 14`,
  );

  const [snapshots, forecasts, routing] = await Promise.all([
    supabaseGetJson(
      env,
      `/rest/v1/agentsam_model_cost_snapshots?select=*&order=captured_at.desc.nullslast&limit=120`,
      'public',
    ),
    supabaseGetJson(
      env,
      `/rest/v1/cost_forecasts?select=*&order=forecast_date.desc.nullslast&limit=30`,
      'public',
    ),
    supabaseGetJson(
      env,
      `/rest/v1/agentsam_routing_decisions?select=model,model_key,provider,estimated_cost_usd,created_at&order=created_at.desc.nullslast&limit=200`,
      'public',
    ),
  ]);

  const snapRows = Array.isArray(snapshots.data) ? snapshots.data : [];
  const cost_by_model = [];
  const cm = new Map();
  for (const r of snapRows) {
    const model = String(r.model ?? r.model_key ?? 'unknown').trim() || 'unknown';
    cm.set(model, (cm.get(model) || 0) + (Number(r.cost_usd ?? r.total_cost_usd ?? 0) || 0));
  }
  for (const [model, cost_usd] of cm.entries()) {
    cost_by_model.push({ model, cost_usd: Math.round(cost_usd * 10000) / 10000 });
  }
  cost_by_model.sort((a, b) => b.cost_usd - a.cost_usd);

  const forecast = Array.isArray(forecasts.data) ? forecasts.data : [];
  const routRows = Array.isArray(routing.data) ? routing.data : [];

  const trendMap = new Map();
  for (const r of routRows) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day || day.length < 10) continue;
    trendMap.set(day, (trendMap.get(day) || 0) + (Number(r.estimated_cost_usd ?? r.cost_usd ?? 0) || 0));
  }
  const token_spend_trend = [...trendMap.entries()]
    .map(([day, cost_usd]) => ({ day, cost_usd: Math.round(cost_usd * 10000) / 10000 }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  let billing_plan = null;
  try {
    const bp = await d1First(
      db,
      `SELECT id, COALESCE(display_name, name) AS name, billing_period, monthly_token_limit
       FROM billing_plans WHERE COALESCE(is_active,1)=1 ORDER BY COALESCE(sort_order,999) LIMIT 1`,
    );
    billing_plan = bp;
  } catch {
    billing_plan = null;
  }

  return {
    mrr: Number(mrrRow?.mrr ?? 0) || 0,
    total_spend_month: Number(total_spend_month?.v ?? 0) || 0,
    ai_cost_month: Number(usageMonth?.v ?? 0) || 0,
    cost_by_model,
    forecast,
    billing_plan,
    token_spend_trend,
    founder_metrics_recent: founder,
    tokens_month: Number(usageMonth?.tokens ?? 0) || 0,
  };
}
