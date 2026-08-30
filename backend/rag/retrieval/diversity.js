import { clamp, jaccardTextSimilarity } from './math.js';

/** Maximal Marginal Relevance: preserve relevance while penalizing duplicates. */
export function selectDiverseCandidates(candidates, { limit = 24, lambda = 0.76 } = {}) {
  const pool = (Array.isArray(candidates) ? candidates : []).slice();
  const selected = [];
  const target = Math.max(1, Math.min(100, Math.round(Number(limit) || 24)));
  const relevanceWeight = clamp(lambda, 0.5, 1);

  while (pool.length && selected.length < target) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestRedundancy = 0;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      const relevance = clamp(candidate?.score ?? candidate?.retrievalScore ?? 0, 0, 1);
      let redundancy = 0;
      for (const chosen of selected) {
        redundancy = Math.max(
          redundancy,
          jaccardTextSimilarity(candidate?.text || '', chosen?.text || ''),
        );
      }
      const mmr = relevanceWeight * relevance - (1 - relevanceWeight) * redundancy;
      if (mmr > bestScore) {
        bestIndex = i;
        bestScore = mmr;
        bestRedundancy = redundancy;
      }
    }
    const [picked] = pool.splice(bestIndex, 1);
    selected.push({ ...picked, mmrScore: bestScore, redundancyScore: bestRedundancy });
  }
  return selected;
}

export function redundantTokenRatio(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const total = list.reduce((sum, row) => sum + (Number(row?.tokenCount) || 0), 0);
  if (!total) return 0;
  const redundant = list.reduce((sum, row) => {
    const tokens = Number(row?.tokenCount) || 0;
    return sum + tokens * clamp(row?.redundancyScore || 0, 0, 1);
  }, 0);
  return redundant / total;
}
