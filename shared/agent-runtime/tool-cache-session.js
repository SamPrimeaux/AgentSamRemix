/**
 * Shared tool-cache session binding — keep read/write/key material aligned across
 * dispatchToolCall, catalog-execution-runtime, and MCP parity paths.
 */

import { resolveToolCallLogProvenance } from '../../shared/agent-runtime/tool-call-log-provenance.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Canonical source_version for cache key + versioned invalidation.
 * Must match catalog-execution-runtime (ref/sha in input are also in normalizedInputHash).
 *
 * @param {unknown} toolInput
 * @param {Record<string, unknown>} [context]
 */
export function resolveToolCacheSourceVersion(toolInput, context = {}) {
  const inp = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput : {};
  const ctx = context && typeof context === 'object' ? context : {};
  const raw =
    ctx.source_version ??
    ctx.sourceVersion ??
    inp.source_version ??
    inp.sourceVersion ??
    inp.ref ??
    inp.sha ??
    inp.generation ??
    null;
  const v = trim(raw);
  return v || null;
}

/**
 * @param {unknown} toolInput
 * @param {Record<string, unknown>} [context]
 */
export function resolveToolCacheSourceEtag(toolInput, context = {}) {
  const inp = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput : {};
  const ctx = context && typeof context === 'object' ? context : {};
  const raw = ctx.source_etag ?? ctx.sourceEtag ?? inp.source_etag ?? inp.etag ?? null;
  const v = trim(raw);
  return v || null;
}

/**
 * @param {unknown} toolInput
 * @param {Record<string, unknown>} [context]
 */
export function buildToolCacheLookupOpts(toolInput, context = {}) {
  const ctx = context && typeof context === 'object' ? context : {};
  return {
    tenantId: ctx.tenantId ?? ctx.tenant_id ?? null,
    workspaceId: ctx.workspaceId ?? ctx.workspace_id ?? null,
    userId: ctx.userId ?? ctx.user_id ?? null,
    sessionId: ctx.sessionId ?? ctx.session_id ?? ctx.conversationId ?? ctx.conversation_id ?? null,
    sourceVersion: resolveToolCacheSourceVersion(toolInput, ctx),
    sourceEtag: resolveToolCacheSourceEtag(toolInput, ctx),
  };
}

/**
 * @param {unknown} result
 * @param {{ cache_hit?: number, external_execution?: number, result_source?: string, cacheHit?: boolean, resultSource?: string }} provenance
 */
export function attachToolCacheProvenance(result, provenance) {
  const p = resolveToolCallLogProvenance({
    cache_hit: provenance.cache_hit,
    result_source: provenance.result_source,
    cacheHit: provenance.cacheHit ?? provenance.cache_hit === 1,
    resultSource: provenance.resultSource ?? provenance.result_source,
  });
  return tagToolCacheProvenance(result, {
    cacheHit: p.cache_hit === 1,
    resultSource: p.result_source,
  });
}

/**
 * Non-enumerable provenance — survives dispatch without polluting JSON.stringify(tool_result).
 * @param {unknown} value
 * @param {{ cacheHit?: boolean, resultSource?: string }} provenance
 */
export function tagToolCacheProvenance(value, provenance) {
  if (!value || typeof value !== 'object') return value;
  const cacheHit = provenance?.cacheHit === true;
  const resultSource =
    provenance?.resultSource != null && String(provenance.resultSource).trim() !== ''
      ? String(provenance.resultSource).trim()
      : cacheHit
        ? 'tool_cache'
        : 'live';
  try {
    Object.defineProperty(value, '__cacheProvenance', {
      value: { cacheHit, resultSource },
      enumerable: false,
      configurable: true,
    });
  } catch {
    /* frozen/sealed — fall back to enumerable fields for ledger only */
    try {
      Object.assign(value, resolveToolCallLogProvenance({ cacheHit, resultSource }));
    } catch {
      /* no-op */
    }
  }
  return value;
}

/**
 * @param {unknown} execResult
 */
export function extractToolCacheProvenance(execResult) {
  if (execResult && typeof execResult === 'object' && !Array.isArray(execResult)) {
    const hidden = /** @type {Record<string, unknown>} */ (execResult).__cacheProvenance;
    if (hidden && typeof hidden === 'object') {
      const h = /** @type {{ cacheHit?: boolean, resultSource?: string }} */ (hidden);
      return resolveToolCallLogProvenance({
        cacheHit: h.cacheHit,
        resultSource: h.resultSource,
      });
    }
    const o = /** @type {Record<string, unknown>} */ (execResult);
    return resolveToolCallLogProvenance({
      cache_hit: o.cache_hit,
      result_source: o.result_source,
      cacheHit: o.cacheHit,
      resultSource: o.resultSource,
    });
  }
  return resolveToolCallLogProvenance({});
}

/**
 * @param {string} toolName
 * @param {{ ok?: boolean, error?: string }} writeResult
 */
export function warnToolCacheWriteFailure(toolName, writeResult) {
  if (!writeResult || writeResult.ok !== false) return;
  console.warn(
    '[agentsam_tool_cache] write_skipped',
    JSON.stringify({
      tool_key: trim(toolName) || null,
      error: trim(writeResult.error) || 'unknown',
    }),
  );
}
