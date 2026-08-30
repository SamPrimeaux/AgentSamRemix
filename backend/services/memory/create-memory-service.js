import { createEmbeddingProvider } from '../../rag/embeddings/provider.js';
import { MemoryService } from './memory-service.js';
import { PostgresMemoryStore } from './adapters/postgres-memory-store.js';

/** Composition root. Model + dimensions + physical table are resolved before entry. */
export async function createMemoryService({
  sql,
  env,
  embeddingSpec,
  table,
  fetchImpl = globalThis.fetch,
  idFactory,
  now,
  userId = null,
  tenantId = null,
}) {
  if (!env || typeof env !== 'object') throw new TypeError('env is required');
  const provider = String(embeddingSpec?.provider || '').trim().toLowerCase();
  const model = String(embeddingSpec?.model ?? embeddingSpec?.modelKey ?? '').trim();
  const dimensions = Number(embeddingSpec?.dimensions);
  if (!provider || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypeError('resolved embeddingSpec { provider, model, dimensions } is required');
  }

  return new MemoryService({
    repository: new PostgresMemoryStore({ sql, table, dimensions }),
    embeddingProvider: createEmbeddingProvider(env, { provider, model, dimensions }, {
      userId,
      tenantId,
      fetchImpl,
    }),
    embeddingModel: model,
    embeddingDimensions: dimensions,
    idFactory,
    now,
  });
}

export function adaptSqlExecutor(queryFn) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn(text, params) is required');
  return {
    async query(text, params) {
      const result = await queryFn(text, params);
      if (Array.isArray(result)) return { rows: result };
      if (result && Array.isArray(result.rows)) return result;
      return { rows: [] };
    },
  };
}
