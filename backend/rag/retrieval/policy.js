import { clamp, tokenizeText } from './math.js';

const ARCHITECTURE_TERMS = new Set([
  'architecture', 'flow', 'through', 'between', 'across', 'dependency', 'dependencies',
  'authorization', 'authentication', 'routing', 'pipeline', 'migration', 'refactor',
  'why', 'how', 'debug', 'failure', 'failing', 'intermittent', 'regression',
]);

function looksLikeIdentifier(token) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(token) &&
    (/[A-Z_$]/.test(token) || token.includes('.') || token.includes('_'));
}

export function analyzeRetrievalQuery(query, overrides = {}) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('retrieval_query_required');
  if (raw.length > 16_000) throw new Error('retrieval_query_too_large');

  const rawTokens = raw.match(/[A-Za-z0-9_.$/-]+/g) || [];
  const normalized = tokenizeText(raw);
  const identifierCount = rawTokens.filter(looksLikeIdentifier).length;
  const identifierDensity = rawTokens.length ? identifierCount / rawTokens.length : 0;
  const architectureHits = normalized.filter((token) => ARCHITECTURE_TERMS.has(token)).length;
  const clauseCount = (raw.match(/[?;,]|\b(?:and|or|then|while|because)\b/gi) || []).length;

  let complexity = 0.15;
  if (raw.length > 180) complexity += 0.15;
  if (raw.length > 600) complexity += 0.15;
  complexity += Math.min(0.3, architectureHits * 0.06);
  complexity += Math.min(0.2, clauseCount * 0.04);
  if (identifierDensity > 0.45 && rawTokens.length <= 8) complexity -= 0.12;
  complexity = clamp(complexity, 0.05, 1);

  const symbolLike = identifierDensity >= 0.35 && rawTokens.length <= 10;
  const defaultCandidateK = symbolLike ? 12 : complexity >= 0.7 ? 48 : complexity >= 0.4 ? 28 : 20;
  const defaultTopK = symbolLike ? 5 : complexity >= 0.7 ? 10 : 7;
  const defaultTokenBudget = symbolLike ? 1600 : complexity >= 0.7 ? 4800 : complexity >= 0.4 ? 3200 : 2400;

  return {
    query: raw,
    queryChars: raw.length,
    tokenTerms: normalized.length,
    identifierDensity,
    complexity,
    symbolLike,
    candidateK: Math.round(clamp(overrides.candidateK ?? defaultCandidateK, 4, 100)),
    topK: Math.round(clamp(overrides.topK ?? defaultTopK, 1, 24)),
    tokenBudget: Math.round(clamp(overrides.tokenBudget ?? defaultTokenBudget, 256, 16_000)),
    rerankRecommended: !symbolLike && complexity >= 0.45,
  };
}
