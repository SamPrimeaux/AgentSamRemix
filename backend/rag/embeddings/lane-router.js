/** Lane-aware embedding dispatch; model choice is already resolved by D1. */
import { embedTextWithSpec } from './provider.js';
import { resolveRagLane } from '../lanes/registry.js';

export async function resolveEmbeddingSpec(env, laneName) {
  const lane = await resolveRagLane(env, laneName);
  if (!lane.provider || !lane.modelKey || !lane.dimensions) {
    throw new Error(`rag_embedding_route_incomplete:${lane.name}`);
  }
  return {
    lane,
    provider: lane.provider,
    model: lane.modelKey,
    dimensions: lane.dimensions,
    routingArmId: lane.routingArmId,
    modelCatalogId: lane.modelCatalogId,
    embeddingSpaceKey: lane.embeddingSpaceKey,
  };
}

export function assertEmbeddingDimensions(embedding, expected) {
  if (!Array.isArray(embedding) || embedding.length !== Number(expected) || !embedding.every(Number.isFinite)) {
    throw new Error(`rag_embedding_dimension_mismatch:expected=${expected}:actual=${embedding?.length ?? 0}`);
  }
  return embedding;
}

export async function embedTextForLane(env, laneName, text, opts = {}) {
  const spec = opts.spec || (await resolveEmbeddingSpec(env, laneName));
  const result = await embedTextWithSpec(env, text, spec, {
    userId: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    taskType: opts.taskType,
    title: opts.title,
    fetchImpl: opts.fetchImpl,
  });
  return {
    ...result,
    embedding: assertEmbeddingDimensions(result.embedding, spec.dimensions),
    routingArmId: spec.routingArmId ?? spec.lane?.routingArmId ?? null,
    modelCatalogId: spec.modelCatalogId ?? spec.lane?.modelCatalogId ?? null,
    embeddingSpaceKey: spec.embeddingSpaceKey ?? spec.lane?.embeddingSpaceKey ?? null,
  };
}
