export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function estimateTokens(text) {
  const value = String(text || '');
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

export function tokenizeText(text) {
  const matches = String(text || '').toLowerCase().match(/[a-z0-9_$.-]{2,}/g) || [];
  return [...new Set(matches)];
}

export function jaccardTextSimilarity(a, b) {
  const aa = new Set(tokenizeText(a));
  const bb = new Set(tokenizeText(b));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  const union = aa.size + bb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function softmaxScores(values, temperature = 1) {
  const list = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!list.length) return [];
  const t = Math.max(1e-6, Number(temperature) || 1);
  const max = Math.max(...list);
  const exp = list.map((value) => Math.exp((value - max) / t));
  const total = exp.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return list.map(() => 1 / list.length);
  return exp.map((value) => value / total);
}

export function rankingEntropy(candidates, scoreKey = 'score') {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length <= 1) return { entropy: 0, normalized: 0 };
  const probabilities = softmaxScores(list.map((row) => Number(row?.[scoreKey]) || 0));
  const entropy = probabilities.reduce(
    (sum, p) => sum - (p > 0 ? p * Math.log(p) : 0),
    0,
  );
  const maximum = Math.log(probabilities.length);
  return {
    entropy,
    normalized: maximum > 0 ? entropy / maximum : 0,
  };
}

export function scoreMargin(candidates, scoreKey = 'score') {
  const scores = (Array.isArray(candidates) ? candidates : [])
    .map((row) => Number(row?.[scoreKey]))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (!scores.length) return 0;
  if (scores.length === 1) return scores[0];
  return scores[0] - scores[1];
}

export function percentile(values, p) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = clamp(p, 0, 1);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  const weight = index - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function marginalGainPerMillisecond(previous, next) {
  const recallGain = Number(next?.recall || 0) - Number(previous?.recall || 0);
  const latencyGain = Number(next?.latencyMs || 0) - Number(previous?.latencyMs || 0);
  if (latencyGain <= 0) return recallGain > 0 ? Number.POSITIVE_INFINITY : 0;
  return recallGain / latencyGain;
}
