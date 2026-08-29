import {
  MEMORY_DEFAULT_CONFIDENCE,
  MEMORY_DEFAULT_IMPORTANCE,
  MEMORY_RANKING_WEIGHTS,
  MEMORY_RECENCY_HALF_LIFE_DAYS,
} from './constants.js';
import { clamp01, nowUnix } from './memory-policy.js';

export function recencyScore(updatedAtUnix, now = nowUnix()) {
  const ts = Number(updatedAtUnix);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const ageDays = Math.max(0, now - ts) / 86_400;
  return Math.pow(0.5, ageDays / MEMORY_RECENCY_HALF_LIFE_DAYS);
}

export function rankMemoryCandidate(row, now = nowUnix()) {
  const semantic = clamp01(row.semantic_score, 0);
  const importance = clamp01(row.importance, MEMORY_DEFAULT_IMPORTANCE);
  const confidence = clamp01(row.confidence, MEMORY_DEFAULT_CONFIDENCE);
  const recency = recencyScore(row.updated_at_unix ?? row.created_at_unix, now);

  return (
    semantic * MEMORY_RANKING_WEIGHTS.semantic +
    importance * MEMORY_RANKING_WEIGHTS.importance +
    confidence * MEMORY_RANKING_WEIGHTS.confidence +
    recency * MEMORY_RANKING_WEIGHTS.recency
  );
}

export function dedupeByContentHash(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(row.content_hash || row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
