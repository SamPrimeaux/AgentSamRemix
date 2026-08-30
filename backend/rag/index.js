export {
  LANES,
  isKnownLane,
  laneNamesForRoute,
  normalizeLaneName,
  resolveRagLane,
  resolveVectorizeBindingForTable,
} from './lanes/registry.js';
export {
  ensureSupabaseWorkspaceId,
  isSupabaseWorkspaceUuid,
  resolveSupabaseWorkspaceId,
} from './scope/workspace.js';
export {
  assertEmbeddingDimensions,
  embedTextForLane,
  resolveEmbeddingSpec,
} from './embeddings/lane-router.js';
export {
  contentHash,
  sanitizeMetadata,
  vectorLiteral,
} from './vector-utils.js';
export { writeMemoryLane } from './writers.js';
export {
  queryPgvectorLane,
  queryVectorizeLane,
  queryRouteRagLanes,
  retrieveContextPack,
} from './retrieval/lanes.js';
export {
  SEMANTIC_LANE_KEYS,
  SEMANTIC_LANE_REGISTRY,
  dispatchSemanticRetrieval,
  embeddingSpecForSemanticLane,
  semanticQueryHash,
} from './retrieval/semantic.js';

export {
  retrieveKnowledge,
  RETRIEVAL_POLICY_VERSION,
  analyzeRetrievalQuery,
  createDenseSearchService,
  expandAstGraph,
  reciprocalRankFusion,
  selectDiverseCandidates,
  redundantTokenRatio,
  packEvidence,
  rankingEntropy,
  scoreMargin,
  percentile,
  marginalGainPerMillisecond,
  recallAtK,
  precisionAtK,
  meanReciprocalRank,
  ndcgAtK,
  contextEfficiency,
  citationMetrics,
} from './retrieval/index.js';
export { createRetrievalRuntimeServices } from './retrieval/runtime-services.js';
