export const MEMORY_DEFAULT_LIMIT = 12;
export const MEMORY_MAX_LIMIT = 50;
export const MEMORY_CANDIDATE_MULTIPLIER = 3;
export const MEMORY_MAX_CANDIDATES = 150;

export const MEMORY_DEFAULT_IMPORTANCE = 0.5;
export const MEMORY_DEFAULT_CONFIDENCE = 0.75;

export const MEMORY_RANKING_WEIGHTS = Object.freeze({
  semantic: 0.72,
  importance: 0.10,
  confidence: 0.10,
  recency: 0.08,
});

export const MEMORY_RECENCY_HALF_LIFE_DAYS = 90;
