/**
 * Worker bridge: src/ tool-cache callers ↔ backend/services/tool-cache.
 */
export {
  TOOL_CACHE_CONTRACT_VERSION,
  DEFAULT_MAX_INLINE_BYTES,
  parseCachePolicyJson,
  resolveToolCachePolicyFromRow,
  isToolCacheEnabled,
  isHardDeniedToolCacheKey,
} from '../../backend/services/tool-cache/contract.js';

export {
  normalizeSemanticToolInput,
  stableSortValue,
  buildToolCacheKeyHash,
  buildScopeIdentity,
  hashToolResult,
} from '../../backend/services/tool-cache/key.js';

export { lookupToolCache } from '../../backend/services/tool-cache/read.js';
export { writeToolCacheResult } from '../../backend/services/tool-cache/write.js';
export { runToolCacheMaintenance } from '../../backend/services/tool-cache/maintenance.js';

/** @deprecated Use lookupToolCache / writeToolCacheResult */
export async function buildAgentsamToolCacheKey(toolKey, toolInput) {
  const { buildToolCacheKeyHash, normalizeSemanticToolInput } = await import(
    '../../backend/services/tool-cache/key.js'
  );
  const { resolveToolCachePolicyFromRow } = await import(
    '../../backend/services/tool-cache/contract.js'
  );
  const policy = resolveToolCachePolicyFromRow({ tool_key: toolKey });
  if (!policy.enabled) return { cacheKey: null, inputHash: null };
  const normalizedInput = normalizeSemanticToolInput(toolInput);
  const { cacheKeyHash, normalizedInputHash } = await buildToolCacheKeyHash({
    toolKey,
    toolRevision: '0',
    policy,
    scopeContext: {},
    normalizedInput,
  });
  return { cacheKey: cacheKeyHash, inputHash: normalizedInputHash };
}

export const TOOL_CACHE_MAX_OUTPUT_CHARS = 16384;
