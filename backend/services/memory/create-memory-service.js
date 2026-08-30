import { resolveGoogleAiApiKey } from '../../rag/embeddings/google-gemini.js';
import { MemoryService } from './memory-service.js';
import { PostgresMemoryStore } from './adapters/postgres-memory-store.js';
import { GeminiEmbedding2Provider } from './providers/gemini-embedding-2.js';

/**
 * Composition root. API routes import this, not Gemini/Postgres classes.
 *
 * sql must already be adapted to { query(text, params) }.
 * Prefer createMemoryServiceFromEnv() in memory-runtime.js from Worker code.
 */
export async function createMemoryService({
  sql,
  env,
  fetchImpl = globalThis.fetch,
  idFactory,
  now,
  userId = null,
}) {
  if (!env || typeof env !== 'object') {
    throw new TypeError('env is required');
  }

  const apiKey = await resolveGoogleAiApiKey(env, userId);
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY is required for gemini-embedding-2');
  }

  return new MemoryService({
    repository: new PostgresMemoryStore({ sql }),
    embeddingProvider: new GeminiEmbedding2Provider({
      apiKey,
      fetchImpl,
    }),
    idFactory,
    now,
  });
}

/**
 * Tiny adapter for whatever Postgres executor the repo already has.
 */
export function adaptSqlExecutor(queryFn) {
  if (typeof queryFn !== 'function') {
    throw new TypeError('queryFn(text, params) is required');
  }
  return {
    async query(text, params) {
      const result = await queryFn(text, params);
      if (Array.isArray(result)) return { rows: result };
      if (result && Array.isArray(result.rows)) return result;
      return { rows: [] };
    },
  };
}
