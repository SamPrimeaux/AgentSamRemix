/**
 * Worker bridge: src/ prompt-pattern callers ↔ backend/services/prompt-pattern.
 */
export {
  PROMPT_PATTERN_CONTRACT_VERSION,
  VOLATILE_PROMPT_LAYER_KEYS,
} from '../../backend/services/prompt-pattern/contract.js';

export {
  hashPromptContent,
  computePromptPatternHash,
  compilePromptManifest,
  augmentPromptManifestVolatile,
  recordRunPromptPatternStats,
  resolveDominantPromptPatternHash,
} from '../../backend/services/prompt-pattern/manifest.js';

export {
  parsePromptLayerKeys,
  volatileLayerKeysFromRoute,
  isStablePromptLayerKey,
  resolveStablePrefixFragments,
} from '../../backend/services/prompt-pattern/layer-resolve.js';

export { computePromptCacheInputEconomics } from '../../backend/services/prompt-pattern/economics/pricing.js';

export {
  recordPromptCacheObservation,
  bumpPromptCacheOnCompaction,
} from '../../backend/services/prompt-pattern/economics/observe.js';
