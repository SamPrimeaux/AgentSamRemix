/**
 * provider-reconcile.js
 * Layer 1: Console/Admin API totals vs agentsam_usage_events, per
 * provider/model/day. Writes to agentsam_usage_reconcile_daily (schema.sql).
 *
 * Full working sketch already reviewed with Sam in chat 2026-08-01 -- swarm
 * should pull that transcript rather than redesign from scratch. Contract
 * below is fixed; fill in the body.
 *
 * Rules (do not violate):
 * - One provider's adapter failing must NEVER throw out of this function --
 *   write status='adapter_error' and continue to the next provider.
 * - Provider list comes from ADAPTERS keys only (deepseek excluded) -- never
 *   introspect agentsam_model_catalog here to auto-add providers without an
 *   adapter; that would just spam adapter_error rows.
 * - Non-fatal DB writes: wrap every INSERT in try/catch per repo convention.
 */
import * as anthropicAdapter from './adapters/anthropic.js';
import * as workersAiAdapter from './adapters/workers-ai.js';
import * as openaiAdapter from './adapters/openai.js';
import * as googleAdapter from './adapters/google/index.js';

const ADAPTERS = {
  anthropic: anthropicAdapter,
  workers_ai: workersAiAdapter,
  openai: openaiAdapter,
  google: googleAdapter, // needs GOOGLE_BILLING_SA_JSON + billing export tables
};

/**
 * @param {any} env
 * @param {string} provider
 * @param {string} day - 'YYYY-MM-DD'
 * @returns {Promise<{ provider: string, day: string, results?: any[], status?: string, error?: string }>}
 */
export async function reconcileProviderDay(env, provider, day) {
  if (!env?.DB) throw new Error('usage reconciliation requires env.DB');
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unsupported usage reconciliation provider: ${provider}`);
  const internalSql = `
    SELECT model, COALESCE(SUM(tokens_in), 0) AS tokens_in,
      COALESCE(SUM(tokens_out), 0) AS tokens_out, COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM agentsam_usage_events
    WHERE provider = ? AND date(created_at, 'unixepoch') = ?
    GROUP BY model`;
  let external;
  try {
    external = await adapter.fetchProviderUsage(env, { day });
  } catch (error) {
    const result = { model: '__adapter_error__', tokens_in: 0, tokens_out: 0, cost_usd: 0, status: 'adapter_error' };
    await writeRow(env.DB, provider, day, result, result).catch(() => {});
    return { provider, day, status: 'adapter_error', error: String(error?.message || error), results: [result] };
  }
  const { results = [] } = await env.DB.prepare(internalSql).bind(provider, day).all();
  const internal = new Map(results.map((row) => [String(row.model), numbers(row)]));
  const totals = results.reduce((out, row) => add(out, numbers(row)), zero());
  const rows = external.map((row) => {
    const console = numbers(row);
    const own = row.model === '__provider_total__' ? totals : (internal.get(String(row.model)) || zero());
    const stored = row.model === '__provider_total__' ? own : { ...own, cost_usd: 0 };
    return { ...row, internal: stored, status: statusFor(console, stored) };
  });
  const writes = await Promise.all(rows.map(async (row) => {
    try { await writeRow(env.DB, provider, day, row, row.internal); return true; } catch (error) {
      console.warn('[usage-reconcile] write failed', { provider, day, model: row.model, error: error?.message });
      return false;
    }
  }));
  return { provider, day, status: rows.some((row) => row.status === 'drift') ? 'drift' : 'ok',
    results: rows, rowsWritten: writes.filter(Boolean).length };
}

export { ADAPTERS };

const zero = () => ({ tokens_in: 0, tokens_out: 0, cost_usd: 0 });
const numbers = (row) => ({ tokens_in: Number(row.tokens_in) || 0, tokens_out: Number(row.tokens_out) || 0,
  cost_usd: Number(row.cost_usd) || 0 });
const add = (a, b) => ({ tokens_in: a.tokens_in + b.tokens_in, tokens_out: a.tokens_out + b.tokens_out,
  cost_usd: a.cost_usd + b.cost_usd });
const pct = (external, internal) => external ? ((internal - external) / external) * 100 : internal ? 100 : 0;
const statusFor = (external, internal) =>
  Math.max(Math.abs(pct(external.tokens_in, internal.tokens_in)), Math.abs(pct(external.cost_usd, internal.cost_usd))) > 5
    ? 'drift' : 'ok';

async function writeRow(db, provider, day, external, internal) {
  await db.prepare(`INSERT INTO agentsam_usage_reconcile_daily (
    provider, model, day, console_tokens_in, console_tokens_out, console_cost_usd,
    internal_tokens_in, internal_tokens_out, internal_cost_usd, delta_pct_tokens, delta_pct_cost, status, checked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(provider, model, day) DO UPDATE SET
    console_tokens_in=excluded.console_tokens_in, console_tokens_out=excluded.console_tokens_out,
    console_cost_usd=excluded.console_cost_usd, internal_tokens_in=excluded.internal_tokens_in,
    internal_tokens_out=excluded.internal_tokens_out, internal_cost_usd=excluded.internal_cost_usd,
    delta_pct_tokens=excluded.delta_pct_tokens, delta_pct_cost=excluded.delta_pct_cost,
    status=excluded.status, checked_at=excluded.checked_at`).bind(
    provider, external.model, day, external.tokens_in, external.tokens_out, external.cost_usd,
    internal.tokens_in, internal.tokens_out, internal.cost_usd,
    pct(external.tokens_in, internal.tokens_in), pct(external.cost_usd, internal.cost_usd), external.status,
  ).run();
}
