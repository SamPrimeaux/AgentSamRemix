/**
 * Isolated usage cost estimation — must never throw; callers always write the event row.
 */
import { computeUsdFromAgentsamAiRates, resolveModelKeyFromProviderId } from './model-catalog-cost.js';
import { estimateModelRunCostUsd } from './model-pricing.js';

/**
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {{
 *   modelKey?: string|null,
 *   provider?: string|null,
 *   modelRates?: Record<string, unknown>|null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheWriteTokens?: number,
 *   cacheWriteTtl?: string,
 *   computedCostUsdOverride?: number|null,
 *   pricingKind?: string,
 * }} opts
 * @returns {Promise<{
 *   costUsd: number,
 *   costReason: string|null,
 *   canonicalModelKey: string,
 *   pricingSource: string,
 * }>}
 */
export async function resolveUsageEventCostUsd(db, opts = {}) {
  const rawModel = opts.modelKey != null ? String(opts.modelKey).trim() : '';
  let canonicalModelKey = rawModel || 'unknown';
  let costUsd = 0;
  let costReason = null;
  let pricingSource = 'none';

  // Ignore non-positive overrides — a 0 override freezes failed first-pass estimates.
  if (
    opts.computedCostUsdOverride != null &&
    Number.isFinite(Number(opts.computedCostUsdOverride)) &&
    Number(opts.computedCostUsdOverride) > 0
  ) {
    return {
      costUsd: Number(opts.computedCostUsdOverride),
      costReason: null,
      canonicalModelKey,
      pricingSource: 'override',
    };
  }

  try {
    if (db && rawModel) {
      const { modelKey: resolved } = await resolveModelKeyFromProviderId(
        db,
        opts.provider,
        rawModel,
      );
      if (resolved) canonicalModelKey = resolved;
    }

    const modelRates = opts.modelRates;
    const rates =
      rawModel && modelRates
        ? modelRates[rawModel] ||
          (canonicalModelKey ? modelRates[canonicalModelKey] : undefined)
        : null;

    const tokenOpts = {
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      cacheReadTokens: opts.cacheReadTokens,
      cacheWriteTokens: opts.cacheWriteTokens,
      cacheWriteTtl: opts.cacheWriteTtl ?? '5m',
      pricingKind: opts.pricingKind ?? 'standard',
    };

    if (rates) {
      costUsd = computeUsdFromAgentsamAiRates(rates, tokenOpts);
      pricingSource = 'model_rates_map';
    } else if (db && canonicalModelKey && canonicalModelKey !== 'unknown') {
      const priced = await estimateModelRunCostUsd(db, {
        modelKey: canonicalModelKey,
        provider: opts.provider,
        ...tokenOpts,
      });
      costUsd = Number(priced.costUsd) || 0;
      canonicalModelKey = priced.canonicalModelKey || canonicalModelKey;
      pricingSource = priced.source || 'agentsam_model_pricing';
      if (pricingSource === 'missing') {
        costReason = 'pricing_lookup_failed';
      }
    } else if (rawModel) {
      costReason = 'pricing_lookup_failed';
    }
  } catch (e) {
    costReason = 'pricing_lookup_failed';
    console.warn('[usage-event-cost] lookup failed', rawModel, e?.message ?? e);
  }

  return { costUsd, costReason, canonicalModelKey, pricingSource };
}
