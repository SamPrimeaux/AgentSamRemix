/**
 * adapters/google — Cloud Billing detailed export → ProviderDayUsage[]
 *
 * Env:
 *   GOOGLE_BILLING_SA_JSON | GOOGLE_APPLICATION_CREDENTIALS
 *   GCP_BILLING_PROJECT (default gen-lang-client-0684066529)
 *   GCP_BILLING_DATASET (default billing_export)
 *   GCP_BILLING_TABLE_PREFIX (default gcp_billing_export_resource_v1_)
 *
 * BQ is billed $ truth (cost). Token columns are best-effort from usage.amount
 * when the unit looks like tokens; otherwise 0. Model labels come from SKU text.
 */

import { getBigQueryAccessToken } from './auth.js';
import { bigQueryQuery } from './query.js';

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function resolveConfig(env) {
  return {
    projectId: String(env.GCP_BILLING_PROJECT || 'gen-lang-client-0684066529').trim(),
    dataset: String(env.GCP_BILLING_DATASET || 'billing_export').trim(),
    tablePrefix: String(env.GCP_BILLING_TABLE_PREFIX || 'gcp_billing_export_resource_v1_').trim(),
  };
}

function modelFromSku(sku) {
  const s = String(sku || '').toLowerCase();
  const m = s.match(/(gemini-[a-z0-9._-]+)/i) || s.match(/(text-embedding-[a-z0-9._-]+)/i);
  if (m) return m[1];
  const cleaned = String(sku || 'google_sku').replace(/\s+/g, '_').slice(0, 120);
  return cleaned || '__unknown_model__';
}

function looksLikeTokens(unit) {
  const u = String(unit || '').toLowerCase();
  return u.includes('token') || u === 'count' || u.includes('character');
}

/** @param {any} env @param {{ day: string }} params */
export async function fetchProviderUsage(env, { day }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    throw new Error('google adapter requires day=YYYY-MM-DD');
  }
  const { projectId, dataset, tablePrefix } = resolveConfig(env);
  const token = await getBigQueryAccessToken(env);
  const table = `\`${projectId}.${dataset}.${tablePrefix}*\``;
  // Detailed export: cost + usage; filter AI-ish SKUs for Gemini / Vertex generative.
  const sql = `
    SELECT
      sku.description AS sku_description,
      SUM(IFNULL(cost, 0)) AS cost_usd,
      SUM(IFNULL(usage.amount, 0)) AS usage_amount,
      ANY_VALUE(usage.unit) AS usage_unit
    FROM ${table}
    WHERE _TABLE_SUFFIX BETWEEN
        FORMAT_DATE('%Y%m%d', DATE_SUB(DATE('${day}'), INTERVAL 1 DAY))
        AND FORMAT_DATE('%Y%m%d', DATE_ADD(DATE('${day}'), INTERVAL 1 DAY))
      AND DATE(usage_start_time, 'UTC') = DATE('${day}')
      AND (
        LOWER(service.description) LIKE '%gemini%'
        OR LOWER(service.description) LIKE '%vertex%'
        OR LOWER(service.description) LIKE '%generat%'
        OR LOWER(sku.description) LIKE '%gemini%'
        OR LOWER(sku.description) LIKE '%token%'
        OR LOWER(sku.description) LIKE '%embedding%'
      )
    GROUP BY sku_description
    ORDER BY cost_usd DESC
    LIMIT 200`;

  let rows;
  try {
    rows = await bigQueryQuery(projectId, token, sql);
  } catch (error) {
    const msg = String(error?.message || error);
    if (/Not found: Table|does not match any table|not found in location/i.test(msg)) {
      throw new Error(
        `google billing export tables empty/missing under ${projectId}.${dataset}.${tablePrefix}* — wait for export fill or check Billing export`,
      );
    }
    throw error;
  }

  const byModel = new Map();
  for (const row of rows) {
    const model = modelFromSku(row.sku_description);
    const prev = byModel.get(model) || { model, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
    prev.cost_usd += n(row.cost_usd);
    const amt = n(row.usage_amount);
    if (looksLikeTokens(row.usage_unit) && amt > 0) {
      // Export rarely splits in/out; attribute to tokens_in for drift vs ledger.
      prev.tokens_in += amt;
    }
    byModel.set(model, prev);
  }

  const modelRows = [...byModel.values()].map((r) => ({
    model: r.model,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    cost_usd: 0, // per-SKU $ kept on provider total only (matches anthropic/openai pattern)
  }));
  const totalCost = [...byModel.values()].reduce((s, r) => s + r.cost_usd, 0);
  const tin = modelRows.reduce((s, r) => s + r.tokens_in, 0);
  const tout = modelRows.reduce((s, r) => s + r.tokens_out, 0);
  return [
    ...modelRows,
    {
      model: '__provider_total__',
      tokens_in: tin,
      tokens_out: tout,
      cost_usd: totalCost,
    },
  ];
}
