/**
 * Canonical Provider-Neutral Embedding & Vector Interfaces.
 * Establishes standard contracts for embedding providers, vector projections,
 * provider capabilities, and vector repository adapters.
 */

export interface EmbeddingInput {
  text: string;
  task?: 'document' | 'query';
  dimensions?: number;
  embeddingSpaceKey?: string;
  routeKey?: string;
}

export interface EmbeddingBatchInput {
  texts: string[];
  task?: 'document' | 'query';
  dimensions?: number;
  embeddingSpaceKey?: string;
  routeKey?: string;
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  model: string;
  dimensions: number;
  version: string;
  embeddingSpaceKey: string;
}

export interface BatchEmbeddingResult {
  vectors: number[][];
  provider: string;
  model: string;
  dimensions: number;
  version: string;
  embeddingSpaceKey: string;
}

export interface ProviderCapability {
  providerKey: string;
  displayName: string;
  modelKey: string;
  supportedDimensions: number[];
  defaultDimensions: number;
  supportedTasks: Array<'document' | 'query'>;
  maxBatchSize: number;
  isAvailable: boolean;
  statusReason?: string;
  costPer1MTokensUsd: number;
  contextWindowTokens: number;
}

export interface EmbeddingProvider {
  readonly key: string;
  getCapability(): ProviderCapability;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
  embedBatch(input: EmbeddingBatchInput): Promise<BatchEmbeddingResult>;
}

export interface ResolveProviderOptions {
  preferredProvider?: string;
  requiredProvider?: string;
  preferredModel?: string;
  requiredDimensions?: number;
  requiredEmbeddingSpaceKey?: string;
  task?: 'document' | 'query';
}

export interface VectorProjectionItem {
  id: string;
  documentId: string;
  ticker: string;
  chunkIndex: number;
  sectionTitle?: string;
  chunkText: string;
  tokenCount: number;
  charCount: number;
  routeKey: string;
  embeddingSpaceKey: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: string;
  vector: number[];
  similarityBoost?: number;
  metadata?: Record<string, any>;
  createdAt?: string;
}

export interface VectorMatch {
  chunkId: string;
  documentId: string;
  ticker: string;
  chunkIndex: number;
  sectionTitle?: string;
  chunkText: string;
  tokenCount: number;
  charCount: number;
  similarity: number;
  routeKey?: string;
  embeddingSpaceKey: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: string;
  metadata?: Record<string, any>;
}

export interface VectorSearchParams {
  vector: number[];
  embeddingSpaceKey: string;
  provider?: string;
  model?: string;
  dimensions?: number;
  ticker?: string;
  documentType?: string;
  topK?: number;
  minSimilarity?: number;
}

export interface VectorRepository {
  upsertProjections(items: VectorProjectionItem[]): Promise<void>;
  search(params: VectorSearchParams): Promise<VectorMatch[]>;
  deleteByDocument(documentId: string): Promise<void>;
  getProjectionsByDocument(documentId: string): Promise<VectorProjectionItem[]>;
}
