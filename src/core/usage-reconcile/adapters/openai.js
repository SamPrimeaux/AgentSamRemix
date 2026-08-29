/**
 * adapters/openai.js
 * Calls OpenAI's Usage API. Requires env.OPENAI_ADMIN_KEY.
 * STATUS: Sam confirmed he holds an admin key (2026-08-01), but it is NOT
 * yet deployed as a Worker secret -- this adapter will throw until it is.
 * Docs: https://platform.openai.com/docs/api-reference/usage
 * Note: OpenAI also documents a separate Costs endpoint that reconciles to
 * the actual invoice; Usage and Costs can differ slightly. Prefer Costs if
 * this is ever used for finance-facing numbers, Usage is fine for drift
 * detection against agentsam_usage_events.
 */

const API = 'https://api.openai.com/v1/organization';

function n(value, field) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`openai response missing ${field}`);
  return out;
}

async function get(env, path, query) {
  const res = await fetch(`${API}/${path}?${query}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` },
  });
  if (!res.ok) throw new Error(`openai ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** @param {any} env @param {{ day: string }} params */
export async function fetchProviderUsage(env, { day }) {
  if (!env.OPENAI_ADMIN_KEY) throw new Error('OPENAI_ADMIN_KEY not bound');
  const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  const common = new URLSearchParams({ start_time: String(start), end_time: String(start + 86400), bucket_width: '1d', limit: '1' });
  common.append('group_by', 'model');
  const [usage, costs] = await Promise.all([
    get(env, 'usage/completions', common),
    get(env, 'costs', new URLSearchParams({ start_time: String(start), end_time: String(start + 86400), bucket_width: '1d', limit: '1' })),
  ]);
  const rows = (usage.data ?? []).flatMap((bucket) => bucket.results ?? []).map((row) => ({
    model: String(row.model || '__unknown_model__'),
    tokens_in: n(row.input_tokens, 'input_tokens'),
    tokens_out: n(row.output_tokens, 'output_tokens'),
    cost_usd: 0,
  }));
  const cost = (costs.data ?? []).flatMap((bucket) => bucket.results ?? [])
    .reduce((sum, row) => sum + n(row.amount?.value, 'costs.amount.value'), 0);
  return [...rows, { model: '__provider_total__', tokens_in: rows.reduce((n, r) => n + r.tokens_in, 0),
    tokens_out: rows.reduce((n, r) => n + r.tokens_out, 0), cost_usd: cost }];
}
