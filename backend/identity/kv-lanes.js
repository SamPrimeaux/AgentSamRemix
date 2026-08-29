/**
 * Identity plane KV lane registry — single import surface for key families.
 * SSOT prose: docs/platform/kv-lane-ssot-2026-08.md
 *
 * Bindings:
 *   env.SESSION_CACHE  → production-KV_SESSIONS  (human session + UI context)
 *   env.KV             → MCP_TOKENS              (agent authority cache only)
 */

export {
  SESSION_KV_PREFIX,
  LEGACY_SESSION_KV_PREFIX,
  SESSION_CTX_PREFIX,
  SESSION_PREFS_PREFIX,
  SESSION_UI_FF_PREFIX,
  sessionKvKey,
  legacySessionKvKey,
  sessionContextKey,
  sessionPrefsKey,
  sessionUiFlagsKey,
} from '../services/session-context/kv-keys.js';

export {
  LEGACY_BOOTSTRAP_KV_PREFIX,
  MCP_PERM_POINTER_PREFIX,
  MCP_PERM_SNAPSHOT_PREFIX,
  MCP_TOKEN_KV_PREFIX,
  MCP_ALLOWLIST_VERSION_PREFIX,
  IAM_SYSTEM_ACTOR_CACHE_KEY,
  LEGACY_TOKEN_HASH_PREFIX,
  LEGACY_OAUTH_ALLOWLIST_VERSION_PREFIX,
  mcpPermPointerKey,
  mcpPermSnapshotKey,
  mcpTokenKvKey,
  mcpAllowlistVersionKey,
  mcpPermSnapshotLookupKeys,
  legacyBootstrapKvCacheKey,
} from '../services/bootstrap/kv-keys.js';

/**
 * Legacy → modern key migration (MCP_TOKENS). Reads try modern first, then legacy.
 * Writes must use modern keys only.
 *
 * @type {readonly { legacy: string, modern: string, namespace: 'MCP_TOKENS'|'SESSION_CACHE'|'NONE', action: string }[]}
 */
export const KV_KEY_MIGRATION = Object.freeze([
  {
    legacy: 'agentsam:bootstrap:{context_hash}',
    modern: 'iam:mcp:perm-snapshot:{context_hash}',
    namespace: 'MCP_TOKENS',
    action: 'read_fallback_only — stop writing legacy prefix',
  },
  {
    legacy: 'token_hash:{sha256}',
    modern: 'iam:mcp:token:{sha256}',
    namespace: 'MCP_TOKENS',
    action: 'dual_read — migrate all writers to iam:mcp:token:',
  },
  {
    legacy: 'oauth_allowlist_version:{client}',
    modern: 'iam:mcp:allowlist-version:{client}',
    namespace: 'MCP_TOKENS',
    action: 'dual_read — migrate writers',
  },
  {
    legacy: 'agent_sam:deploy:*',
    modern: '(none)',
    namespace: 'NONE',
    action: 'DELETE — D1 deployments + pwa-build-meta.json only',
  },
  {
    legacy: 'iam_sess_v1:{session_id}',
    modern: 'iam:sess:{session_id}',
    namespace: 'SESSION_CACHE',
    action: 'dual_write — prefer iam:sess:',
  },
]);

/**
 * Keys that must never be written to MCP_TOKENS (enforced in backend/worker/kv-storage-policy.js).
 * @type {readonly string[]}
 */
export const MCP_TOKENS_WRITE_BANS = Object.freeze([
  'agent_sam:deploy:',
  'iam:sess:',
  'iam_sess_v1:',
  'iam:ctx:',
  'iam:prefs:',
  'iam:ff:',
  'auth:ensure:',
]);

/**
 * Keys that must never be written to SESSION_CACHE.
 * @type {readonly string[]}
 */
export const SESSION_CACHE_WRITE_BANS = Object.freeze([
  'iam:mcp:perm:',
  'iam:mcp:perm-snapshot:',
  'iam:mcp:token:',
  'token_hash:',
  'agentsam:bootstrap:',
]);
