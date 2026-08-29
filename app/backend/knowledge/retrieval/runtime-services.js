import { createDenseSearchService } from './dense-service.js';
import { resolveCodeEmbeddingRoute } from '../embeddings/code-route.js';
import { embedQueryForRoute } from '../embeddings/embed.js';
import { createPgvectorCodeRepository } from './pgvector-repository.js';

/**
 * Compose production retrieval services from canonical runtime authorities.
 * D1 resolves the semantic route, BYOK/env resolves credentials, Hyperdrive
 * queries the existing pgvector projection. Retrieval itself owns none of them.
 */
export function createRetrievalRuntimeServices(env, actorScope) {
  const resolveRoute = () => resolveCodeEmbeddingRoute(env);
  const vectorRepository = createPgvectorCodeRepository(env, resolveRoute);
  const denseSearch = createDenseSearchService({
    resolveRoute: async ({ purpose }) => {
      if (purpose !== 'codebase') throw new Error(`embedding_route_purpose_unsupported:${purpose}`);
      return resolveRoute();
    },
    embed: async (text, requested) => {
      const route = await resolveRoute();
      if (requested?.routeKey !== route.routeKey) throw new Error('embedding_route_changed_during_embed');
      if (requested?.embeddingSpaceKey !== route.embeddingSpaceKey) throw new Error('embedding_space_changed_during_embed');
      return embedQueryForRoute(env, route, text, actorScope);
    },
    vectorRepository,
  });
  return { denseSearch };
}
