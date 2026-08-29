function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new Error(`${name}_required`);
  return value;
}

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

/**
 * Compose the ANN adapter from three independent authorities:
 * route resolver -> embedding service -> vector repository.
 *
 * This keeps provider/model selection out of retrieval and makes exact
 * embedding-space compatibility mandatory before search.
 */
export function createDenseSearchService({ resolveRoute, embed, vectorRepository }) {
  const resolve = requiredFunction(resolveRoute, 'embedding_route_resolver');
  const embedQuery = requiredFunction(embed, 'embedding_service');
  if (!vectorRepository || typeof vectorRepository.search !== 'function') {
    throw new Error('vector_repository_required');
  }

  return async function denseSearch({ query, scope, topK }) {
    const route = await resolve({
      purpose: scope?.sourceType === 'code' ? 'codebase' : String(scope?.sourceType || 'documents'),
      workspaceId: scope?.workspaceId,
      repoFullName: scope?.repoFullName || null,
      task: 'query',
    });
    const routeKey = requiredText(route?.routeKey, 'embedding_route_key');
    const embeddingSpaceKey = requiredText(route?.embeddingSpaceKey, 'embedding_space_key');
    const dimensions = Number(route?.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error('embedding_route_dimensions_invalid');

    const embedded = await embedQuery(String(query || ''), {
      task: 'query',
      routeKey,
      provider: route?.provider,
      model: route?.model,
      dimensions,
      embeddingSpaceKey,
    });
    const vector = Array.isArray(embedded?.vector) ? embedded.vector : Array.isArray(embedded?.embedding) ? embedded.embedding : null;
    if (!vector || vector.length !== dimensions) {
      throw new Error(`embedding_dimensions_mismatch:${dimensions}:${vector?.length || 0}`);
    }
    const producedSpace = requiredText(embedded?.embeddingSpaceKey || embeddingSpaceKey, 'embedding_result_space_key');
    if (producedSpace !== embeddingSpaceKey) {
      throw new Error(`embedding_space_mismatch:${embeddingSpaceKey}:${producedSpace}`);
    }

    const result = await vectorRepository.search({
      vector,
      embeddingSpaceKey,
      routeKey,
      topK,
      scope,
    });
    const hits = Array.isArray(result?.hits) ? result.hits : Array.isArray(result) ? result : [];
    for (const hit of hits) {
      const hitSpace = requiredText(hit?.embeddingSpaceKey, 'vector_hit_embedding_space_key');
      if (hitSpace !== embeddingSpaceKey) {
        throw new Error(`embedding_space_mismatch:${embeddingSpaceKey}:${hitSpace}`);
      }
    }
    return { routeKey, embeddingSpaceKey, hits };
  };
}
