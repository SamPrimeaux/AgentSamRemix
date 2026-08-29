export const MEMORY_EMBEDDING_MODEL = 'gemini-embedding-2';
export const MEMORY_EMBEDDING_DIMENSIONS = 1536;
export const MEMORY_EMBEDDING_VERSION = 'gemini2_1536_v1';

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

export const MEMORY_PG_SCHEMA = 'agentsam';
export const MEMORY_PG_TABLE = 'agentsam_memory_gemini2_1536';
export const MEMORY_PG_QUALIFIED = 'agentsam.agentsam_memory_gemini2_1536';
