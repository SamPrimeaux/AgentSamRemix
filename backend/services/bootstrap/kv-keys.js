/**
 * MCP_TOKENS (env.KV) key families — resolved agent identity + agentic authority.
 * SSOT: docs/platform/kv-lane-ssot-2026-08.md
 */

/** @deprecated Read fallback only — use mcpPermSnapshotKey */
export const LEGACY_BOOTSTRAP_KV_PREFIX = 'agentsam:bootstrap:';

export const MCP_PERM_POINTER_PREFIX = 'iam:mcp:perm:';
export const MCP_PERM_SNAPSHOT_PREFIX = 'iam:mcp:perm-snapshot:';
export const MCP_TOKEN_KV_PREFIX = 'iam:mcp:token:';
export const MCP_ALLOWLIST_VERSION_PREFIX = 'iam:mcp:allowlist-version:';
export const PLANE_POINTER_PREFIX = 'iam:plane:';
export const PLANE_SNAPSHOT_PREFIX = 'iam:plane-snapshot:';
export const GRANT_PREFIX = 'iam:grant:';
export const CATALOG_GENERATION_KV_KEY = 'iam:agent:catalog-generation';
export const PROFILE_GENERATION_KV_PREFIX = 'iam:agent:profile-gen:';
/** Compiled IAM service/agent actor (cron + platform writes) — MCP_TOKENS only. */
export const IAM_SYSTEM_ACTOR_CACHE_KEY = 'iam:mcp:system-actor:v1';

/** @deprecated Read fallback only */
export const LEGACY_TOKEN_HASH_PREFIX = 'token_hash:';

/** @deprecated Read fallback only */
export const LEGACY_OAUTH_ALLOWLIST_VERSION_PREFIX = 'oauth_allowlist_version:';

/**
 * Mutable pointer: au + workspace → current context_hash.
 * @param {string} userId canonical au_*
 * @param {string} workspaceId
 */
export function mcpPermPointerKey(userId, workspaceId) {
  const uid = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  if (!uid || !ws) return '';
  return `${MCP_PERM_POINTER_PREFIX}${uid}:${ws}`;
}

/**
 * Immutable compiled authority snapshot (content-addressed).
 * @param {string} contextHash
 */
export function mcpPermSnapshotKey(contextHash) {
  const h = String(contextHash || '').trim();
  if (!h) return '';
  return `${MCP_PERM_SNAPSHOT_PREFIX}${h}`;
}

/** @param {string} contextHash */
export function legacyBootstrapKvCacheKey(contextHash) {
  const h = String(contextHash || '').trim();
  if (!h) return '';
  return `${LEGACY_BOOTSTRAP_KV_PREFIX}${h}`;
}

/** Back-compat alias — prefer mcpPermSnapshotKey */
export function bootstrapKvCacheKey(contextHash) {
  return mcpPermSnapshotKey(contextHash);
}

/**
 * @param {string} tokenHash hex sha256
 */
export function mcpTokenKvKey(tokenHash) {
  const h = String(tokenHash || '').trim();
  if (!h) return '';
  return `${MCP_TOKEN_KV_PREFIX}${h}`;
}

/** @param {string} clientKey */
export function mcpAllowlistVersionKey(clientKey) {
  const c = String(clientKey || '').trim();
  if (!c) return '';
  return `${MCP_ALLOWLIST_VERSION_PREFIX}${c}`;
}

/** @param {string} planeId */
export function planePointerKey(planeId) {
  const id = String(planeId || '').trim();
  if (!id) return '';
  return `${PLANE_POINTER_PREFIX}${id}`;
}

/** @param {string} hash */
export function planeSnapshotKey(hash) {
  const h = String(hash || '').trim();
  if (!h) return '';
  return `${PLANE_SNAPSHOT_PREFIX}${h}`;
}

/** @param {string} grantHash */
export function delegationGrantKey(grantHash) {
  const h = String(grantHash || '').trim();
  if (!h) return '';
  return `${GRANT_PREFIX}${h}`;
}

/**
 * Snapshot lookup keys (new first, legacy fallback).
 * @param {string} contextHash
 */
export function mcpPermSnapshotLookupKeys(contextHash) {
  const h = String(contextHash || '').trim();
  if (!h) return [];
  const modern = mcpPermSnapshotKey(h);
  const legacy = legacyBootstrapKvCacheKey(h);
  return modern === legacy ? [modern] : [modern, legacy];
}
