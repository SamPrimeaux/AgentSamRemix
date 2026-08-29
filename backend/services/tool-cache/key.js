/**
 * Semantic input normalization + cache key material.
 */

import { TOOL_CACHE_CONTRACT_VERSION, VOLATILE_INPUT_KEYS } from './contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {unknown} value
 */
export function stableSortValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableSortValue);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = stableSortValue(value[k]);
  }
  return out;
}

/**
 * @param {unknown} input
 */
export function normalizeSemanticToolInput(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return input ?? {};
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (VOLATILE_INPUT_KEYS.has(k)) continue;
    if (k.startsWith('_')) continue;
    out[k] = stableSortValue(v);
  }
  return out;
}

/**
 * @param {string} text
 */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {{
 *   scope?: string,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   sessionId?: string|null,
 * }} scope
 */
export function buildScopeIdentity(scope = {}) {
  const kind = trim(scope.scope) || 'workspace';
  switch (kind) {
    case 'global':
      return 'global';
    case 'tenant':
      return `tenant:${trim(scope.tenantId) || 'unknown'}`;
    case 'user':
      return `user:${trim(scope.userId) || 'unknown'}@ws:${trim(scope.workspaceId) || 'unknown'}`;
    case 'session':
      return `session:${trim(scope.sessionId) || 'unknown'}@ws:${trim(scope.workspaceId) || 'unknown'}`;
    case 'workspace':
    default:
      return `workspace:${trim(scope.workspaceId) || 'unknown'}@tenant:${trim(scope.tenantId) || 'unknown'}`;
  }
}

/**
 * @param {{
 *   toolKey: string,
 *   toolRevision?: string|null,
 *   policy: { scope?: string },
 *   scopeContext: Record<string, unknown>,
 *   normalizedInput: unknown,
 *   sourceVersion?: string|null,
 *   varyHash?: string|null,
 * }} input
 */
export async function buildToolCacheKeyHash(input) {
  const toolKey = trim(input.toolKey);
  const toolRevision = trim(input.toolRevision) || '0';
  const scopeIdentity = buildScopeIdentity({
    scope: input.policy?.scope,
    tenantId: input.scopeContext.tenantId,
    workspaceId: input.scopeContext.workspaceId,
    userId: input.scopeContext.userId,
    sessionId: input.scopeContext.sessionId,
  });
  const semanticJson = JSON.stringify(input.normalizedInput ?? {});
  const normalizedInputHash = await sha256Hex(semanticJson);
  const sourceVersion = trim(input.sourceVersion) || '';
  const varyHash = trim(input.varyHash) || '';
  const payload = [
    TOOL_CACHE_CONTRACT_VERSION,
    toolKey,
    toolRevision,
    scopeIdentity,
    normalizedInputHash,
    sourceVersion,
    varyHash,
  ].join('|');
  const cacheKeyHash = await sha256Hex(payload);
  return { cacheKeyHash, normalizedInputHash, scopeIdentity, semanticJson };
}

/**
 * @param {unknown} result
 */
export async function hashToolResult(result) {
  const json = JSON.stringify(result ?? null);
  return sha256Hex(json);
}
