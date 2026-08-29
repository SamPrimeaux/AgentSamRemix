/**
 * AgentSam embedding policy — dual lane, never mix vector spaces in one index.
 *
 * Docs / skills markdown: OpenAI text-embedding-3-large @ 1536.
 * Code index: runtime SSOT = D1 resolveCodeIndexLaneConfig (registry → code_index_embed arm → catalog).
 *   EMBEDDING_ROUTES.code below is a sync fixture only — index/retrieve must not treat it as authority.
 * Multimodal assets: Google gemini-embedding-2 @ 1536 (image/video/audio/PDF — separate index).
 */

export const EMBEDDING_DIMS = Object.freeze({
  cheapFastSearch: 768,
  balancedProductionRag: 1536,
  maximumRecall: 3072,
});

/** @typedef {{ provider: 'openai' | 'google', model: string, dimensions: number }} EmbeddingRouteSpec */

export const EMBEDDING_ROUTES = Object.freeze({
  docs: {
    provider: 'openai',
    model: 'text-embedding-3-large',
    dimensions: EMBEDDING_DIMS.balancedProductionRag,
  },
  code: {
    provider: 'google',
    model: 'gemini-embedding-2',
    dimensions: EMBEDDING_DIMS.balancedProductionRag,
  },
  skillsMarkdown: {
    provider: 'openai',
    model: 'text-embedding-3-large',
    dimensions: EMBEDDING_DIMS.balancedProductionRag,
  },
  /** Separate Vectorize / File Search index — do not upsert into OpenAI 1536 lanes. */
  imagesVideosAudioPdfs: {
    provider: 'google',
    model: 'gemini-embedding-2',
    dimensions: EMBEDDING_DIMS.balancedProductionRag,
  },
});

export const embeddingPolicy = Object.freeze({
  primaryTextRag: 'text-embedding-3-large',
  codeIndex: 'gemini-embedding-2',
  multimodalAssetSearch: 'gemini-embedding-2',
  googleFileSearchStore: 'gemini-embedding-2',
  migrationRule: 'do not mix vectors; create a new index or fully re-embed',
  productionDimensions: EMBEDDING_DIMS.balancedProductionRag,
});

/**
 * @param {'docs'|'code'|'skillsMarkdown'} [laneKey]
 * @returns {EmbeddingRouteSpec}
 */
export function resolveTextEmbeddingRoute(laneKey = 'docs') {
  const key = String(laneKey || 'docs');
  return EMBEDDING_ROUTES[key] || EMBEDDING_ROUTES.docs;
}

/** @returns {EmbeddingRouteSpec} */
export function resolveMultimodalEmbeddingRoute() {
  return EMBEDDING_ROUTES.imagesVideosAudioPdfs;
}

/**
 * Google API model id (may include models/ prefix in catalog).
 * @param {string} [modelKey]
 * @returns {string}
 */
export function googleEmbeddingApiModelId(modelKey) {
  const k = String(modelKey || embeddingPolicy.multimodalAssetSearch).trim().replace(/^models\//, '');
  return k || 'gemini-embedding-2';
}
