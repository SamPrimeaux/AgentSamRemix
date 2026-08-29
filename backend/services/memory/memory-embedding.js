import { MEMORY_EMBEDDING_DIMENSIONS } from './constants.js';

/**
 * Owns text → Gemini Embedding 2 → 1536-d vector.
 * The provider is injected so tests never call Google.
 */
export class MemoryEmbedding {
  constructor(provider) {
    if (!provider || typeof provider.embedDocument !== 'function') {
      throw new TypeError('embeddingProvider.embedDocument() is required');
    }
    if (typeof provider.embedQuery !== 'function') {
      throw new TypeError('embeddingProvider.embedQuery() is required');
    }
    this.provider = provider;
  }

  async embedDocument(text, opts = {}) {
    const vector = await this.provider.embedDocument(text, opts);
    assertEmbedding(vector);
    return vector;
  }

  async embedQuery(text) {
    const vector = await this.provider.embedQuery(text);
    assertEmbedding(vector);
    return vector;
  }
}

export function assertEmbedding(vector) {
  if (!Array.isArray(vector) || vector.length !== MEMORY_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding must contain ${MEMORY_EMBEDDING_DIMENSIONS} dimensions`,
    );
  }
  if (!vector.every(Number.isFinite)) {
    throw new Error('embedding contains a non-finite value');
  }
}
