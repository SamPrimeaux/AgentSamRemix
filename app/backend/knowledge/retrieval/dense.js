import { estimateTokens } from './math.js';

function normalizeDenseHit(hit, embeddingSpaceKey) {
  const id = String(hit?.id || hit?.projectionId || hit?.chunkId || '').trim();
  if (!id) throw new Error('dense_hit_id_required');
  const hitSpace = String(hit?.embeddingSpaceKey || '').trim();
  if (!hitSpace) throw new Error(`dense_hit_embedding_space_required:${id}`);
  if (embeddingSpaceKey && hitSpace !== embeddingSpaceKey) {
    throw new Error(`embedding_space_mismatch:${embeddingSpaceKey}:${hitSpace}`);
  }
  const text = String(hit?.text || hit?.chunkText || hit?.content || '').trim();
  const score = Number(hit?.score ?? hit?.similarity ?? 0);
  if (!Number.isFinite(score)) throw new Error(`dense_hit_score_invalid:${id}`);
  return {
    ...hit,
    id: `dense:${id}`,
    sourceId: String(hit?.sourceId || hit?.chunkId || id),
    sourceType: String(hit?.sourceType || 'knowledge_chunk'),
    text,
    tokenCount: Number(hit?.tokenCount) || estimateTokens(text),
    score,
    retrievalScore: score,
    embeddingSpaceKey: hitSpace,
    provenance: [...new Set([...(Array.isArray(hit?.provenance) ? hit.provenance : []), 'dense_ann'])],
  };
}

/**
 * ANN is intentionally an injected VectorRepository concern. This module never
 * implements HNSW in D1 and never manufactures an embedding fallback.
 */
export async function searchDenseAnn({ query, scope, candidateK = 24, services = {} }) {
  if (typeof services?.denseSearch !== 'function') {
    return { ok: false, backend: 'dense_ann', error: 'dense_retriever_unconfigured', hits: [] };
  }
  try {
    const result = await services.denseSearch({
      query: String(query || ''),
      scope,
      topK: Math.max(4, Math.min(100, Math.round(Number(candidateK) || 24))),
    });
    const embeddingSpaceKey = String(result?.embeddingSpaceKey || '').trim();
    const rawHits = Array.isArray(result?.hits) ? result.hits : [];
    if (rawHits.length && !embeddingSpaceKey) {
      throw new Error('dense_result_embedding_space_required');
    }
    const hits = rawHits.map((hit) => normalizeDenseHit(hit, embeddingSpaceKey));
    return {
      ok: true,
      backend: 'dense_ann',
      embeddingSpaceKey: embeddingSpaceKey || null,
      routeKey: result?.routeKey ? String(result.routeKey) : null,
      hits,
    };
  } catch (error) {
    return { ok: false, backend: 'dense_ann', error: `dense_ann_failed:${String(error?.message || error).slice(0, 180)}`, hits: [] };
  }
}
