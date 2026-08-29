/**
 * Prompt cache input economics — baseline (all input at normal rate) vs actual provider split.
 */

import {
  computeUsdFromModelPricingRow,
  estimateModelRunCostUsd,
  inferPricingProvider,
  loadModelPricingRow,
  resolveCanonicalModelKey,
} from '../../../telemetry/model-pricing.js';

/**
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {{
 *   modelKey: string,
 *   provider?: string|null,
 *   totalInputTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheCreationTokens?: number,
 *   cacheWriteTtl?: string,
 *   pricingKind?: string,
 * }} u
 */
export async function computePromptCacheInputEconomics(db, u = {}) {
  const totalIn = Math.max(0, Math.floor(Number(u.totalInputTokens) || 0));
  const cr = Math.max(0, Math.floor(Number(u.cacheReadTokens) || 0));
  const cw = Math.max(0, Math.floor(Number(u.cacheCreationTokens) || 0));
  const uncached = Math.max(0, totalIn - cr - cw);

  const provider = inferPricingProvider(u.modelKey, u.provider);
  const canonicalModelKey = resolveCanonicalModelKey(u.modelKey, provider);
  const pricingKind = u.pricingKind != null ? String(u.pricingKind).trim() : 'standard';
  const cacheWriteTtl = u.cacheWriteTtl ?? '5m';

  const baselinePricing = await estimateModelRunCostUsd(db, {
    modelKey: u.modelKey,
    provider,
    pricingKind,
    inputTokens: totalIn,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });

  const actualPricing = await estimateModelRunCostUsd(db, {
    modelKey: u.modelKey,
    provider,
    pricingKind,
    inputTokens: totalIn,
    outputTokens: 0,
    cacheReadTokens: cr,
    cacheWriteTokens: cw,
    cacheWriteTtl,
  });

  const row = db
    ? await loadModelPricingRow(db, { provider, modelKey: canonicalModelKey, pricingKind })
    : null;

  let cache_read_cost_usd = 0;
  let cache_creation_cost_usd = 0;
  if (row && cr > 0) {
    cache_read_cost_usd =
      computeUsdFromModelPricingRow(row, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: cr,
        cacheWriteTokens: 0,
        pricingKind,
      }) || 0;
  }
  if (row && cw > 0) {
    cache_creation_cost_usd =
      computeUsdFromModelPricingRow(row, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: cw,
        cacheWriteTtl,
        pricingKind,
      }) || 0;
  }

  const baseline_input_cost_usd = baselinePricing.costUsd;
  const actual_input_cost_usd = actualPricing.costUsd;
  const total_cache_savings_usd = Math.max(0, baseline_input_cost_usd - actual_input_cost_usd);

  return {
    baseline_input_cost_usd,
    actual_input_cost_usd,
    cache_creation_cost_usd,
    cache_read_cost_usd,
    total_cache_savings_usd,
    uncached_input_tokens: uncached,
    pricing_source: actualPricing.source,
    canonical_model_key: canonicalModelKey,
  };
}
