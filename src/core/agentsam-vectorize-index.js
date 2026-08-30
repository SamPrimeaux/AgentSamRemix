/**
 * Legacy AGENTSAMVECTORIZE physical binding description only.
 * Embedding model selection is owned by backend/rag via D1 routing arms.
 */
export const AGENTSAM_VECTORIZE_INDEX_NAME = 'inneranimalmedia-vectors';

const DESCRIBE_CACHE_MS = 5 * 60 * 1000;
let describeCache = null;

export async function describeAgentsamVectorizeIndex(env) {
  const now = Date.now();
  if (describeCache && now - describeCache.at < DESCRIBE_CACHE_MS) return describeCache.cfg;

  let dimensions = 0;
  let metric = 'cosine';
  let source = 'env';
  if (env?.AGENTSAMVECTORIZE?.describe) {
    const raw = await env.AGENTSAMVECTORIZE.describe();
    dimensions = Number(raw?.dimensions ?? raw?.config?.dimensions);
    metric = String(raw?.metric ?? raw?.config?.metric ?? 'cosine').toLowerCase();
    source = 'binding';
  }
  if (!Number.isFinite(dimensions) || dimensions <= 0) {
    dimensions = Number(env?.AGENTSAM_EMBEDDING_DIMENSIONS ?? 0);
    source = 'env';
  }
  if (!Number.isFinite(dimensions) || dimensions <= 0) {
    throw new Error('AGENTSAMVECTORIZE dimensions unknown');
  }
  const cfg = { indexName: AGENTSAM_VECTORIZE_INDEX_NAME, dimensions, metric, source };
  describeCache = { at: now, cfg };
  return cfg;
}

export function assertAgentsamEmbeddingDimensions(embedding, expectedDimensions) {
  const dim = Number(expectedDimensions);
  if (!Number.isInteger(dim) || dim <= 0) throw new Error('embedding_dimensions_required');
  if (!Array.isArray(embedding) || embedding.length !== dim || !embedding.every(Number.isFinite)) {
    throw new Error(`Embedding dimension mismatch: got ${embedding?.length ?? 0}, index requires ${dim}`);
  }
}
