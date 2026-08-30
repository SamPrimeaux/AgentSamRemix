import { runHyperdriveQuery } from '../database/hyperdrive.js';
import { resolveGoogleAiApiKey } from '../../rag/embeddings/google-gemini.js';
import { adaptSqlExecutor, createMemoryService } from './create-memory-service.js';

/**
 * Hyperdrive → MemoryStore sql.query adapter for Worker and local scripts.
 */
export function createHyperdriveSqlAdapter(env) {
  return adaptSqlExecutor(async (text, params) => {
    const result = await runHyperdriveQuery(env, text, params);
    if (!result.ok) {
      throw new Error(result.error || 'hyperdrive_query_failed');
    }
    return result;
  });
}

/**
 * Composition root from Worker env (HYPERDRIVE + platform/BYOK Gemini key).
 * @param {Record<string, unknown>} env
 * @param {{ userId?: string|null, idFactory?: () => string, now?: () => number }} [opts]
 */
export async function createMemoryServiceFromEnv(env, opts = {}) {
  if (!env || typeof env !== 'object') {
    throw new TypeError('env is required');
  }
  const apiKey = await resolveGoogleAiApiKey(env, opts.userId ?? null);
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY is required for gemini-embedding-2');
  }
  return createMemoryService({
    sql: createHyperdriveSqlAdapter(env),
    env: { ...env, GOOGLE_AI_API_KEY: apiKey },
    fetchImpl: globalThis.fetch.bind(globalThis),
    idFactory: opts.idFactory,
    now: opts.now,
  });
}
