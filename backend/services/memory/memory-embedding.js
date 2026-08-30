/** Runtime-dimension embedding validator around an injected provider. */
export class MemoryEmbedding {
  constructor(provider, dimensions) {
    if (!provider || typeof provider.embedDocument !== 'function') {
      throw new TypeError('embeddingProvider.embedDocument() is required');
    }
    if (typeof provider.embedQuery !== 'function') {
      throw new TypeError('embeddingProvider.embedQuery() is required');
    }
    this.dimensions = requireDimensions(dimensions);
    this.provider = provider;
  }

  async embedDocument(text, opts = {}) {
    return assertEmbedding(await this.provider.embedDocument(text, opts), this.dimensions);
  }

  async embedQuery(text) {
    return assertEmbedding(await this.provider.embedQuery(text), this.dimensions);
  }
}

function requireDimensions(value) {
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypeError('embedding dimensions must be a positive integer');
  }
  return dimensions;
}

export function assertEmbedding(vector, expectedDimensions) {
  const dimensions = requireDimensions(expectedDimensions);
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`embedding must contain ${dimensions} dimensions`);
  }
  if (!vector.every(Number.isFinite)) throw new Error('embedding contains a non-finite value');
  return vector;
}
