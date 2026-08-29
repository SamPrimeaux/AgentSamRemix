/**
 * Tool-call log provenance — distinguish live execution vs physical tool-cache retrieval.
 */

/**
 * @param {{
 *   resultSource?: string|null,
 *   result_source?: string|null,
 *   cacheHit?: boolean|number|null,
 *   cache_hit?: boolean|number|null,
 * }} fields
 */
export function resolveToolCallLogProvenance(fields = {}) {
  const src = String(fields.resultSource ?? fields.result_source ?? '').trim().toLowerCase();
  const cacheHit =
    fields.cacheHit === true ||
    fields.cache_hit === true ||
    fields.cacheHit === 1 ||
    fields.cache_hit === 1 ||
    src === 'tool_cache';

  if (cacheHit || src === 'tool_cache') {
    return { cache_hit: 1, external_execution: 0, result_source: 'tool_cache' };
  }
  return { cache_hit: 0, external_execution: 1, result_source: 'live' };
}
