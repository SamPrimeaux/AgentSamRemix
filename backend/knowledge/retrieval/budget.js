import { clamp, estimateTokens } from './math.js';

function sourceBucket(row) {
  return String(row?.sourceId || row?.filePath || row?.repoFullName || row?.sourceType || 'unknown');
}

/** Greedy bounded context packing by relevance, novelty, and token cost. */
export function packEvidence(candidates, { tokenBudget = 3200, maxItems = 8, maxPerSource = 3 } = {}) {
  const budget = Math.max(128, Math.min(16_000, Math.round(Number(tokenBudget) || 3200)));
  const limit = Math.max(1, Math.min(24, Math.round(Number(maxItems) || 8)));
  const sourceLimit = Math.max(1, Math.min(8, Math.round(Number(maxPerSource) || 3)));

  const ranked = (Array.isArray(candidates) ? candidates : []).map((row) => {
    const tokens = Number(row?.tokenCount) || estimateTokens(row?.text || '');
    const relevance = clamp(row?.score ?? row?.retrievalScore ?? 0, 0, 1);
    const novelty = 1 - clamp(row?.redundancyScore || 0, 0, 1);
    const utility = relevance * (0.7 + 0.3 * novelty);
    const utilityPerToken = utility / Math.max(32, tokens);
    return { ...row, tokenCount: tokens, utility, utilityPerToken };
  }).sort((a, b) => {
    const byEfficiency = b.utilityPerToken - a.utilityPerToken;
    return Math.abs(byEfficiency) > 1e-9 ? byEfficiency : b.utility - a.utility;
  });

  const selected = [];
  const counts = new Map();
  let selectedTokens = 0;
  let skippedTokens = 0;
  for (const row of ranked) {
    if (selected.length >= limit) {
      skippedTokens += row.tokenCount;
      continue;
    }
    const bucket = sourceBucket(row);
    if ((counts.get(bucket) || 0) >= sourceLimit) {
      skippedTokens += row.tokenCount;
      continue;
    }
    if (selectedTokens + row.tokenCount > budget) {
      skippedTokens += row.tokenCount;
      continue;
    }
    selected.push(row);
    selectedTokens += row.tokenCount;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  return {
    selected,
    selectedTokens,
    skippedTokens,
    tokenBudget: budget,
    budgetUtilization: budget > 0 ? selectedTokens / budget : 0,
  };
}
