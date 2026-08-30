import { resolveRagLane } from '../../rag/lanes/registry.js';
import { qualifiedMemoryTable } from './memory-schema.js';
import { runHyperdriveQuery } from '../database/hyperdrive.js';
import { adaptSqlExecutor, createMemoryService } from './create-memory-service.js';

export function createHyperdriveSqlAdapter(env) {
  return adaptSqlExecutor(async (text, params) => {
    const result = await runHyperdriveQuery(env, text, params);
    if (!result.ok) throw new Error(result.error || 'hyperdrive_query_failed');
    return result;
  });
}

/** D1 arm -> matching pgvector lane -> provider-neutral memory service. */
export async function createMemoryServiceFromEnv(env, opts = {}) {
  if (!env || typeof env !== 'object') throw new TypeError('env is required');
  const lane = await resolveRagLane(env, 'memory');
  return createMemoryService({
    sql: createHyperdriveSqlAdapter(env),
    env,
    embeddingSpec: {
      provider: lane.provider,
      model: lane.modelKey,
      dimensions: lane.dimensions,
    },
    table: qualifiedMemoryTable(lane.schemaName, lane.tableName),
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    userId: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    idFactory: opts.idFactory,
    now: opts.now,
  });
}
