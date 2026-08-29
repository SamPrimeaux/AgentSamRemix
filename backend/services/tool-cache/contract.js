/**
 * Tool result cache v2 — contract constants and hard safety denies.
 */

export const TOOL_CACHE_CONTRACT_VERSION = 1;

export const DEFAULT_MAX_INLINE_BYTES = 16384;

export const CACHE_STRATEGIES = new Set(['ttl', 'versioned', 'immutable']);
export const CACHE_SCOPES = new Set(['global', 'tenant', 'workspace', 'user', 'session']);

export const CACHE_SCOPE_WORKSPACE_SENTINEL = '__tenant__';
export const CACHE_SCOPE_GLOBAL_SENTINEL = '__global__';

/** Strip from normalized semantic input — never part of cache identity. */
export const VOLATILE_INPUT_KEYS = new Set([
  'request_id',
  'requestId',
  'trace_id',
  'traceId',
  'nonce',
  'timestamp',
  'client_request_id',
  'clientRequestId',
  'turn_id',
  'turnId',
  'message_id',
  'messageId',
  '_cache_bust',
  '_nonce',
]);

/** Always deny tool-result cache regardless of D1 policy misconfiguration. */
export const HARD_DENY_TOOL_CACHE_KEYS = new Set([
  'agentsam_d1_query',
  'd1_query',
  'agentsam_d1_write',
  'agentsam_d1_delete',
  'agentsam_terminal_local',
  'agentsam_terminal_remote',
  'agentsam_terminal_sandbox',
  'agentsam_deploy',
  'agentsam_github_write',
  'agentsam_github_patch',
  'agentsam_github_pr',
  'agentsam_github_commit_tree',
  'agentsam_memory_save',
  'agentsam_memory_write',
  'agentsam_send_email',
  'agentsam_notify',
  'agentsam_r2_put',
  'agentsam_r2_upload',
  'agentsam_r2_delete',
]);

const HARD_DENY_PREFIXES = [
  'agentsam_terminal_',
  'agentsam_d1_write',
  'agentsam_ticket_',
  'agentsam_deploy',
];

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {string} toolKey
 */
export function isHardDeniedToolCacheKey(toolKey) {
  const tk = String(toolKey || '').trim();
  if (!tk) return true;
  if (HARD_DENY_TOOL_CACHE_KEYS.has(tk)) return true;
  for (const p of HARD_DENY_PREFIXES) {
    if (tk === p || tk.startsWith(p)) return true;
  }
  return false;
}

/**
 * @param {unknown} raw
 */
function unwrapCachePolicyBlock(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.cache && typeof raw.cache === 'object') return raw.cache;
  return raw;
}

const DISABLED_POLICY = {
  eligible: false,
  enabled: false,
  strategy: 'none',
  scope: 'workspace',
  ttl_sec: 0,
  stale_sec: 0,
  max_inline_bytes: DEFAULT_MAX_INLINE_BYTES,
};

/**
 * @param {unknown} raw
 */
export function parseCachePolicyJson(raw) {
  if (raw == null || raw === '') return { ...DISABLED_POLICY };

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DISABLED_POLICY };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DISABLED_POLICY };

  const block = unwrapCachePolicyBlock(parsed);
  const strategyRaw = trim(block.strategy);
  const strategy = CACHE_STRATEGIES.has(strategyRaw) ? strategyRaw : 'none';
  const scope = CACHE_SCOPES.has(trim(block.scope)) ? trim(block.scope) : 'workspace';
  const eligible = block.eligible === true || block.enabled === true;
  const ttl_sec = Math.max(0, Math.floor(Number(block.ttl_seconds ?? block.ttl_sec) || 0));
  const stale_sec = Math.max(
    ttl_sec,
    Math.max(0, Math.floor(Number(block.stale_seconds ?? block.stale_sec) || ttl_sec || 3600)),
  );
  const maxChars = Math.floor(Number(block.max_output_chars) || 0);
  const max_inline_bytes =
    maxChars > 0
      ? Math.max(1024, Math.min(65536, maxChars))
      : Math.max(
          1024,
          Math.min(65536, Math.floor(Number(block.max_inline_bytes) || DEFAULT_MAX_INLINE_BYTES)),
        );
  const enabled = eligible && strategy !== 'none';
  return { eligible, enabled, strategy, scope, ttl_sec, stale_sec, max_inline_bytes };
}

/**
 * Canonical non-null tenant/workspace ids for D1 UNIQUE + scope boundaries.
 * @param {{ scope?: string }} policy
 * @param {{ tenantId?: string|null, workspaceId?: string|null }} scopeContext
 */
export function normalizeCacheScopeIds(policy, scopeContext) {
  const scope = trim(policy?.scope) || 'workspace';
  const tenantId = trim(scopeContext?.tenantId);
  if (!tenantId) {
    throw new Error('tool_cache_tenant_id_required');
  }

  let workspaceId = trim(scopeContext?.workspaceId);
  if (scope === 'global') {
    workspaceId = workspaceId || CACHE_SCOPE_GLOBAL_SENTINEL;
  } else if (scope === 'tenant') {
    workspaceId = workspaceId || CACHE_SCOPE_WORKSPACE_SENTINEL;
  } else if (!workspaceId) {
    throw new Error('tool_cache_workspace_id_required');
  }

  return { tenantId, workspaceId, scope };
}

/**
 * @param {Record<string, unknown>|null|undefined} toolRow
 */
export function resolveToolCachePolicyFromRow(toolRow) {
  const toolKey = String(toolRow?.tool_key || toolRow?.tool_name || '').trim();
  if (isHardDeniedToolCacheKey(toolKey)) {
    return parseCachePolicyJson({ cache: { eligible: false, strategy: 'ttl', scope: 'workspace' } });
  }
  return parseCachePolicyJson(toolRow?.cache_policy_json);
}

/**
 * @param {{ eligible?: boolean, enabled?: boolean, strategy?: string }} policy
 * @param {string} toolKey
 */
export function isToolCacheEnabled(policy, toolKey) {
  if (isHardDeniedToolCacheKey(toolKey)) return false;
  return (policy?.eligible === true || policy?.enabled === true) && policy?.strategy !== 'none';
}
