/**
 * adapters/anthropic.js
 * Calls Anthropic's Usage and Cost API. Requires env.ANTHROPIC_ADMIN_KEY
 * (already deployed as a Worker secret, confirmed 2026-08-01 -- distinct
 * from ANTHROPIC_API_KEY, do not conflate the two).
 * Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
 */

const API = 'https://api.anthropic.com/v1/organizations';

function n(value, field) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`anthropic response missing ${field}`);
  return out;
}

async function report(env, path, params) {
  const res = await fetch(`${API}/${path}?${params}`, {
    headers: { 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_ADMIN_KEY },
  });
  if (!res.ok) throw new Error(`anthropic ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** @param {any} env @param {{ day: string }} params */
export async function fetchProviderUsage(env, { day }) {
  if (!env.ANTHROPIC_ADMIN_KEY) throw new Error('ANTHROPIC_ADMIN_KEY not bound');
  const starting_at = `${day}T00:00:00Z`;
  const ending_at = new Date(Date.parse(starting_at) + 86400000).toISOString();
  const q = new URLSearchParams({ starting_at, ending_at, bucket_width: '1d' });
  q.append('group_by[]', 'model');
  const usage = await report(env, 'usage_report/messages', q);
  const costs = await report(env, 'cost_report', new URLSearchParams({
    starting_at, ending_at, bucket_width: '1d', 'group_by[]': 'description',
  }));
  const rows = (usage.data ?? []).flatMap((bucket) => bucket.results ?? []).map((row) => {
    const creation = row.cache_creation ?? {};
    return {
      model: String(row.model || '__unknown_model__'),
      tokens_in: n(row.uncached_input_tokens, 'uncached_input_tokens') +
        n(row.cache_read_input_tokens, 'cache_read_input_tokens') +
        n(creation.ephemeral_5m_input_tokens ?? 0, 'cache_creation.ephemeral_5m_input_tokens') +
        n(creation.ephemeral_1h_input_tokens ?? 0, 'cache_creation.ephemeral_1h_input_tokens'),
      tokens_out: n(row.output_tokens, 'output_tokens'),
      cost_usd: 0,
    };
  });
  const cost = (costs.data ?? []).flatMap((bucket) => bucket.results ?? [])
    .reduce((sum, row) => sum + n(row.amount, 'cost_report.amount'), 0);
  return [...rows, { model: '__provider_total__', tokens_in: rows.reduce((n, r) => n + r.tokens_in, 0),
    tokens_out: rows.reduce((n, r) => n + r.tokens_out, 0), cost_usd: cost }];
}
