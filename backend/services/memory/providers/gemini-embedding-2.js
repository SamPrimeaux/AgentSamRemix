import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_EMBEDDING_MODEL,
} from '../constants.js';
import { requireNonEmptyString } from '../memory-policy.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini Embedding 2 provider.
 *
 * Request shape matches backend/embeddings/google-gemini-embed.js so a
 * later factor-in can swap this class for embedTextGemini without a
 * payload rewrite. Tests inject fetchImpl and never hit the network.
 */
export class GeminiEmbedding2Provider {
  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    model = MEMORY_EMBEDDING_MODEL,
    dimensions = MEMORY_EMBEDDING_DIMENSIONS,
  } = {}) {
    this.apiKey = requireNonEmptyString(apiKey, 'Gemini apiKey');
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetch implementation is required');
    }
    this.fetch = fetchImpl;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = requireNonEmptyString(model, 'embedding model');
    this.dimensions = Number(dimensions);
    if (!Number.isInteger(this.dimensions) || this.dimensions <= 0) {
      throw new TypeError('embedding dimensions must be a positive integer');
    }
  }

  async embedDocument(text, { title = null } = {}) {
    return this.#embed(text, { taskType: 'RETRIEVAL_DOCUMENT', title });
  }

  async embedQuery(text) {
    return this.#embed(text, { taskType: 'RETRIEVAL_QUERY', title: null });
  }

  async #embed(text, { taskType, title }) {
    const normalized = requireNonEmptyString(text, 'embedding text');
    const url =
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:embedContent` +
      `?key=${encodeURIComponent(this.apiKey)}`;

    const body = {
      model: `models/${this.model}`,
      content: { parts: [{ text: normalized }] },
      outputDimensionality: this.dimensions,
      taskType,
    };
    if (title && taskType === 'RETRIEVAL_DOCUMENT') {
      body.title = String(title).trim();
    }

    const response = await this.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `Gemini embedding failed (${response.status}): ${truncate(errBody, 500)}`,
      );
    }

    const json = await response.json();
    let vector = json?.embedding?.values;
    if (!Array.isArray(vector) && Array.isArray(json?.embedding)) {
      vector = json.embedding;
    }
    if (!Array.isArray(vector)) {
      throw new Error('Gemini embedding response did not contain embedding.values');
    }
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Gemini embedding dimension mismatch: expected ${this.dimensions}, received ${vector.length}`,
      );
    }
    if (!vector.every(Number.isFinite)) {
      throw new Error('Gemini embedding contains a non-finite value');
    }
    return vector;
  }
}

function truncate(value, max) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
