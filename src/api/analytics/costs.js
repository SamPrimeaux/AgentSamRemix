import { jsonResponse } from '../../core/auth.js';
import { pragmaTableInfo, tableExists } from '../../../backend/services/retention.js';

const DAY_SECONDS = 86_400;
const MAX_RANGE_SECONDS = 366 * DAY_SECONDS;

function toUnixSeconds(value, fallback) {
  if (!value) return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && Number.isFinite(Number(row[key]))) return numeric(row[key]);
  }
  return 0;
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim()) return row[key];
  }
  return null;
}

function scopeClause(columns, scope, binds) {
  if (scope.workspaceId && columns.has('workspace_id')) {
    binds.push(scope.workspaceId);
    return 'workspace_id = ?';
  }
  if (scope.tenantId && columns.has('tenant_id')) {
    binds.push(scope.tenantId);
    return 'tenant_id = ?';
  }
  return null;
}

async function reconcileRows(db, scope, from, to) {
  if (!(await tableExists(db, 'agentsam_usage_reconcile_daily'))) return null;
  const columns = await pragmaTableInfo(db, 'agentsam_usage_reconcile_daily');
  const dateColumn = ['t', 'day_unix', 'bucket_start', 'created_at', 'day', 'date'].find((key) => columns.has(key));
  if (!dateColumn) return null;

  const binds = [];
  const scoped = scopeClause(columns, scope, binds);
  if (!scoped) return null;

  const isTextDay = dateColumn === 'day' || dateColumn === 'date';
  const timeClause = isTextDay
    ? `date(${dateColumn}) >= date(?, 'unixepoch') AND date(${dateColumn}) < date(?, 'unixepoch')`
    : `${dateColumn} >= ? AND ${dateColumn} < ?`;
  binds.push(from, to);
  try {
    const { results = [] } = await db
      .prepare(`SELECT * FROM agentsam_usage_reconcile_daily WHERE ${scoped} AND ${timeClause} ORDER BY ${dateColumn} ASC`)
      .bind(...binds)
      .all();
    if (!results.length) return null;
    return results.map((row) => ({
      t: isTextDay ? toUnixSeconds(`${row[dateColumn]}T00:00:00Z`, 0) : numeric(row[dateColumn]),
      estimated_cost_usd: firstNumber(row, ['estimated_cost_usd', 'estimated_usd', 'cost_usd']),
      billed_cost_usd: firstNumber(row, ['billed_cost_usd', 'billed_usd', 'actual_cost_usd', 'admin_cost_usd']),
      provider: firstValue(row, ['provider', 'provider_key']),
    }));
  } catch {
    return null;
  }
}

/**
 * GET /api/analytics/costs
 * Estimated spend comes exclusively from scoped usage events. Reconciliation is
 * optional because provider-admin credentials may not be connected yet.
 */
export async function handleAnalyticsCosts(request, url, env, scope) {
  void request;
  const db = env?.DB;
  if (!db) return jsonResponse({ error: 'DB not configured' }, 503);
  if (!scope?.workspaceId && !scope?.tenantId) return jsonResponse({ error: 'Workspace or tenant required' }, 403);
  if (!(await tableExists(db, 'agentsam_usage_events'))) {
    return jsonResponse({ layer: 'estimated', bucket_width: '1d', series: [], breakdown: [], billed: null, reconcile: null });
  }

  const columns = await pragmaTableInfo(db, 'agentsam_usage_events');
  const now = Math.floor(Date.now() / 1000);
  const to = Math.min(toUnixSeconds(url.searchParams.get('to'), now), now + DAY_SECONDS);
  const from = Math.max(0, toUnixSeconds(url.searchParams.get('from'), to - 30 * DAY_SECONDS));
  if (from >= to || to - from > MAX_RANGE_SECONDS) {
    return jsonResponse({ error: 'Invalid date range; use a window of up to 366 days' }, 400);
  }
  if (String(url.searchParams.get('bucket') || '1d') !== '1d') {
    return jsonResponse({ error: 'Only bucket=1d is supported' }, 400);
  }

  const binds = [];
  const scoped = scopeClause(columns, scope, binds);
  if (!scoped || !columns.has('created_at')) {
    return jsonResponse({ error: 'Usage-event scope is unavailable' }, 403);
  }
  binds.push(from, to);

  const providerExpr = columns.has('provider') ? "COALESCE(NULLIF(provider, ''), 'other')" : "'other'";
  const modelExpr = columns.has('model_key')
    ? "COALESCE(NULLIF(model_key, ''), NULLIF(model, ''), 'unknown')"
    : columns.has('model')
      ? "COALESCE(NULLIF(model, ''), 'unknown')"
      : "'unknown'";
  const tokensIn = columns.has('tokens_in') ? 'COALESCE(tokens_in, 0)' : '0';
  const tokensOut = columns.has('tokens_out') ? 'COALESCE(tokens_out, 0)' : '0';
  const cost = columns.has('cost_usd') ? 'COALESCE(cost_usd, 0)' : '0';
  const bucketExpr = `CAST(created_at / ${DAY_SECONDS} AS INTEGER) * ${DAY_SECONDS}`;
  const where = `${scoped} AND created_at >= ? AND created_at < ?`;

  try {
    const { results: rows = [] } = await db
      .prepare(
        `SELECT ${bucketExpr} AS t, ${providerExpr} AS provider, ${modelExpr} AS model,
                SUM(${tokensIn}) AS tin, SUM(${tokensOut}) AS tout, SUM(${cost}) AS cost_usd, COUNT(*) AS n
         FROM agentsam_usage_events
         WHERE ${where}
         GROUP BY t, provider, model
         ORDER BY t ASC, cost_usd DESC`,
      )
      .bind(...binds)
      .all();

    const buckets = new Map();
    const breakdown = rows.map((row) => {
      const t = numeric(row.t);
      const provider = String(row.provider || 'other').toLowerCase();
      const metric = {
        tin: numeric(row.tin),
        tout: numeric(row.tout),
        cost_usd: numeric(row.cost_usd),
      };
      const bucket = buckets.get(t) || { t, by_provider: {} };
      const providerMetric = bucket.by_provider[provider] || { tin: 0, tout: 0, cost_usd: 0 };
      providerMetric.tin += metric.tin;
      providerMetric.tout += metric.tout;
      providerMetric.cost_usd += metric.cost_usd;
      bucket.by_provider[provider] = providerMetric;
      buckets.set(t, bucket);
      return { t, provider, model: String(row.model || 'unknown'), ...metric, n: numeric(row.n) };
    });

    const reconcile = await reconcileRows(db, scope, from, to);
    const billed = reconcile
      ? reconcile.reduce((sum, row) => sum + numeric(row.billed_cost_usd), 0)
      : null;
    return jsonResponse({
      layer: 'estimated',
      bucket_width: '1d',
      series: [...buckets.values()],
      breakdown,
      billed,
      reconcile,
    });
  } catch (error) {
    console.error('[analytics.costs] failed', error);
    return jsonResponse({ error: 'Failed to load cost analytics' }, 500);
  }
}
