/**
 * Compat re-exports — prompt pattern economics lives in backend/services/prompt-pattern/.
 */
export {
  recordPromptCacheObservation,
  bumpPromptCacheOnCompaction,
  resolveDominantPromptPatternHash,
  recordRunPromptPatternStats,
  compilePromptManifest,
  computePromptPatternHash,
  computePromptCacheInputEconomics,
} from './prompt-pattern-bridge.js';

/** @deprecated Use recordPromptCacheObservation with a compiled PromptManifest */
export async function logPromptCacheUsage(env, tenantId, layerKeys, routeKey, provider, modelKey, tokenCount) {
  void layerKeys;
  void routeKey;
  void tokenCount;
  return recordPromptCacheObservation(env, {
    manifest: { pattern_hash: '', contract_version: 1 },
    tenantId,
    provider,
    modelKey,
    cacheReadTokens: 0,
  });
}
