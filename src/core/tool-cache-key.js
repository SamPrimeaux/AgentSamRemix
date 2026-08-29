/**
 * Compat shim — tool cache v2 lives in backend/services/tool-cache/ via bridge.
 */
import {
  lookupToolCache,
  writeToolCacheResult,
  runToolCacheMaintenance,
  resolveToolCachePolicyFromRow,
  isToolCacheEnabled,
  buildAgentsamToolCacheKey,
  normalizeSemanticToolInput,
  TOOL_CACHE_MAX_OUTPUT_CHARS,
} from './tool-cache-bridge.js';

export {
  lookupToolCache,
  writeToolCacheResult,
  runToolCacheMaintenance,
  resolveToolCachePolicyFromRow,
  isToolCacheEnabled,
  buildAgentsamToolCacheKey,
  normalizeSemanticToolInput,
  TOOL_CACHE_MAX_OUTPUT_CHARS,
};

/** @deprecated v1 SQL — maintenance uses unix columns now */
export const TOOL_CACHE_NOT_EXPIRED_SQL =
  `(fresh_until_unix IS NULL OR fresh_until_unix > unixepoch())`;
export const TOOL_CACHE_EXPIRED_SQL =
  `stale_until_unix IS NOT NULL AND stale_until_unix < unixepoch()`;

/** @deprecated Use resolveToolCachePolicyFromRow + isToolCacheEnabled */
export const NON_CACHEABLE_TOOL_KEYS = new Set();

/** @deprecated Use isToolCacheEnabled(resolveToolCachePolicyFromRow(row), toolKey) */
export function isToolCacheEligible(toolKey, toolRow = null) {
  return isToolCacheEnabled(
    resolveToolCachePolicyFromRow(toolRow || { tool_key: toolKey }),
    toolKey,
  );
}
