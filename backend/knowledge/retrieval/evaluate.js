function idOf(row) {
  return String(row?.canonicalId || row?.sourceId || row?.id || '');
}

export function recallAtK(results, relevantIds, k) {
  const relevant = relevantIds instanceof Set ? relevantIds : new Set(relevantIds || []);
  if (!relevant.size) return null;
  const found = new Set((results || []).slice(0, k).map(idOf).filter((id) => relevant.has(id)));
  return found.size / relevant.size;
}

export function precisionAtK(results, relevantIds, k) {
  const relevant = relevantIds instanceof Set ? relevantIds : new Set(relevantIds || []);
  const top = (results || []).slice(0, k);
  if (!top.length) return 0;
  return top.filter((row) => relevant.has(idOf(row))).length / top.length;
}

export function meanReciprocalRank(results, relevantIds) {
  const relevant = relevantIds instanceof Set ? relevantIds : new Set(relevantIds || []);
  const index = (results || []).findIndex((row) => relevant.has(idOf(row)));
  return index >= 0 ? 1 / (index + 1) : 0;
}

export function ndcgAtK(results, relevantIds, k) {
  const relevant = relevantIds instanceof Set ? relevantIds : new Set(relevantIds || []);
  if (!relevant.size) return null;
  const top = (results || []).slice(0, k);
  const dcg = top.reduce((sum, row, index) => {
    const rel = relevant.has(idOf(row)) ? 1 : 0;
    return sum + rel / Math.log2(index + 2);
  }, 0);
  const idealCount = Math.min(k, relevant.size);
  let idcg = 0;
  for (let i = 0; i < idealCount; i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

export function contextEfficiency({ qualityWithoutContext, qualityWithContext, selectedTokens }) {
  const gain = Number(qualityWithContext) - Number(qualityWithoutContext);
  const tokens = Math.max(0, Number(selectedTokens) || 0);
  return {
    contextGain: Number.isFinite(gain) ? gain : null,
    gainPerThousandTokens: Number.isFinite(gain) && tokens > 0 ? gain / (tokens / 1000) : null,
  };
}

export function citationMetrics({ citedIds, supportedIds, supportRequiredIds }) {
  const cited = new Set(citedIds || []);
  const supported = new Set(supportedIds || []);
  const required = new Set(supportRequiredIds || []);
  let precise = 0;
  for (const id of cited) if (supported.has(id)) precise += 1;
  let recalled = 0;
  for (const id of required) if (cited.has(id)) recalled += 1;
  return {
    citationPrecision: cited.size ? precise / cited.size : null,
    citationRecall: required.size ? recalled / required.size : null,
  };
}
