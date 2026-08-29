/**
 * adapters/workers-ai.js
 * Cloudflare's own metering for Workers AI -- GraphQL Analytics API,
 * aiInferenceAdaptiveGroups dataset. Reuses env.CLOUDFLARE_API_TOKEN,
 * already deployed and used elsewhere in this repo. No new credential.
 * Docs: https://developers.cloudflare.com/analytics/graphql-api/
 */

/** @param {any} env @param {{ day: string }} params */
export async function fetchProviderUsage(env, { day }) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not bound');
  }
  const start = `${day}T00:00:00Z`;
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const query = `query Usage($accountTag: string, $start: Time!, $end: Time!) {
      viewer { accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $start, datetime_lt: $end }
          ) {
            dimensions { modelId }
            sum { totalInputTokens totalOutputTokens }
          }
      } }
    }`;

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, start, end } }),
  });
  if (!res.ok) throw new Error(`workers_ai graphql HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(`workers_ai graphql: ${data.errors.map((e) => e.message).join('; ')}`);

  const rows = data?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
  return rows.map((r) => ({
    model: String(r.dimensions?.modelId || '__unknown_model__'),
    tokens_in: Number(r.sum?.totalInputTokens || 0),
    tokens_out: Number(r.sum?.totalOutputTokens || 0),
    // GraphQL exports usage, not invoice cost. Do not derive USD from neurons/rates.
    cost_usd: 0,
  }));
}
