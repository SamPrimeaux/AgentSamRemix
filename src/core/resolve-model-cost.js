/**
 * Pricing helpers — catalog rates are per-1k; convert at compute time.
 */

export function computeCostUsd(
  resolvedModel,
  { inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 } = {},
) {
  if (!resolvedModel) return 0;
  const inRate = (resolvedModel.input_price_per_1m || 0) / 1_000_000;
  const cchRate = (resolvedModel.cached_input_price_per_1m || inRate * 0.1) / 1_000_000;
  const outRate = (resolvedModel.output_price_per_1m || 0) / 1_000_000;
  return inputTokens * inRate + cachedInputTokens * cchRate + outputTokens * outRate;
}
