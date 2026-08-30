/** Compatibility-shaped memory view over the canonical backend/rag lane resolver. */
import { normalizeEmbeddingModelKey, resolveRagLane } from '../lanes/registry.js';

const CACHE_TTL_MS = 60_000;
const cacheByEnv = new WeakMap();

export function peekMemoryEmbeddingLaneConfig(env) {
  if (!env || typeof env !== 'object') return null;
  const hit = cacheByEnv.get(env);
  return hit && Date.now() - hit.at <= CACHE_TTL_MS ? hit.config : null;
}

export function clearMemoryEmbeddingLaneConfigCache(env) {
  if (env && typeof env === 'object') cacheByEnv.delete(env);
}

export async function resolveMemoryEmbeddingLaneConfig(env) {
  const cached = peekMemoryEmbeddingLaneConfig(env);
  if (cached) return cached;
  const lane = await resolveRagLane(env, 'memory');
  const model = normalizeEmbeddingModelKey(lane.modelKey);
  const config = Object.freeze({
    provider: lane.provider,
    model,
    modelKey: lane.modelKey,
    dimensions: lane.dimensions,
    version: `${lane.provider}_${model.replace(/[^a-z0-9]+/g, '')}_${lane.dimensions}_v1`,
    armId: lane.routingArmId,
    catalogId: lane.modelCatalogId,
    vectorizeBinding: lane.vectorizeBinding?.bindingName || null,
    vectorizeIndex: lane.vectorizeBinding?.indexName || null,
    pgvectorAvailable: true,
    pgvectorTable: lane.tableName,
    pgvectorQualifiedTable: lane.qualifiedTable,
    embeddingSpaceKey: lane.embeddingSpaceKey,
    resolvedAt: Date.now(),
    config_source: 'd1',
  });
  if (env && typeof env === 'object') cacheByEnv.set(env, { at: Date.now(), config });
  return config;
}
