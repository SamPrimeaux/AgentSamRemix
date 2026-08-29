/**
 * Peel manifest — tracks migration from src/core → backend/identity.
 * Update status when a module moves; do not duplicate logic in both places.
 *
 * @module backend/identity/peel-manifest
 */

/** @typedef {'live'|'adapter'|'peel_target'|'deprecated'} PeelStatus */

/**
 * @type {readonly { id: string, status: PeelStatus, canonical: string, legacy?: string, notes?: string }[]}
 */
export const IDENTITY_PEEL_MANIFEST = Object.freeze([
  {
    id: 'resolve_identity',
    status: 'live',
    canonical: 'backend/identity/resolve-identity.js',
    legacy: 'src/core/auth/request-auth.js (deleted)',
    notes: 'resolveIdentity() and resolveAuth() share the backend identity spine',
  },
  {
    id: 'auth_user_leaf',
    status: 'live',
    canonical: 'backend/identity/resolve-identity.js',
    legacy: 'src/core/auth/auth-user.js (deleted)',
    notes: 'getAuthUser is owned by the backend identity spine',
  },
  {
    id: 'oauth_token_leaf',
    status: 'live',
    canonical: 'src/core/user-oauth-token.js',
    legacy: 'src/api/oauth.js (token readers removed)',
    notes: 'Supabase token resolution + generic OAuth decryptors live below worker-composition',
  },
  {
    id: 'session_read',
    status: 'live',
    canonical: 'backend/identity/sessions/read.js',
    legacy: 'src/core/auth/session-read.js (deleted)',
  },
  {
    id: 'session_write',
    status: 'live',
    canonical: 'backend/identity/sessions/write.js',
    legacy: 'src/core/auth/session-write.js (deleted)',
  },
  {
    id: 'edge_session_jwt',
    status: 'live',
    canonical: 'backend/auth/session-tokens.js',
    legacy: 'src/core/auth/edge-session-token.js (deleted 2026-08-27)',
    notes: 'Transport only — claims in contracts/jwt-transport-claims.js',
  },
  {
    id: 'user_resolver',
    status: 'live',
    canonical: 'backend/identity/users/repository.js',
  },
  {
    id: 'workspace_access',
    status: 'live',
    canonical: 'backend/identity/workspace/access.js',
    legacy: 'src/core/workspace-access.js (compatibility re-export)',
    notes: 'workspace_members = relationship; memberships = capability flags',
  },
  {
    id: 'workspace_authority',
    status: 'live',
    canonical: 'backend/identity/workspace/authority.js',
    legacy: 'src/core/workspace-authority.js (deleted)',
    notes: 'Role/admin/tunnel authority now lives in identity plane; legacy core path no longer imports backend',
  },
  {
    id: 'workspace_membership',
    status: 'live',
    canonical: 'backend/identity/workspace/membership.js',
  },
  {
    id: 'workspace_resolve_login',
    status: 'live',
    canonical: 'backend/identity/workspace-resolve.js',
    legacy: 'src/api/oauth.js (removed)',
    notes: 'OAuth login workspace pick only — unify with workspace/resolve.js later',
  },
  {
    id: 'user_policy',
    status: 'live',
    canonical: 'backend/identity/permissions/user-policy.js',
    notes: 'User/workspace policy loading only; Agent Sam tool authorization is a separate peel.',
  },
  {
    id: 'capabilities',
    status: 'live',
    canonical: 'backend/identity/sessions/fields.js (computeAuthCapabilities)',
  },
  {
    id: 'mcp_bearer',
    status: 'peel_target',
    canonical: 'backend/identity/tokens/mcp-bearer.js',
    legacy: 'src/core/mcp-auth.js',
    notes: 'KV mirror iam:mcp:token:{hash}; D1 mcp_workspace_tokens is truth',
  },
  {
    id: 'bootstrap_compile',
    status: 'live',
    canonical: 'backend/services/bootstrap/resolve.js',
    legacy: 'backend/identity/bootstrap.js (bridge)',
    notes: 'Identity consumes via bootstrap-link.js; perm snapshots → MCP_TOKENS only',
  },
  {
    id: 'session_context_kv',
    status: 'live',
    canonical: 'backend/services/session-context/kv-keys.js',
    legacy: 'src/core/session-context-kv-bridge.js',
    notes: 'Human lane → SESSION_CACHE only',
  },
  {
    id: 'god_table_platform_operators',
    status: 'deprecated',
    canonical: '(dropped)',
    legacy: 'platform_operators',
    notes: 'SSOT: docs/platform/drop-god-tables-2026-08.md — move tunnel_* to terminal_connections.metadata_json; gate via agentsam_user_policy + user_governance_roles',
  },
  {
    id: 'god_table_superadmin_identity',
    status: 'deprecated',
    canonical: '(dropped)',
    legacy: 'superadmin_identity',
    notes: 'Zero runtime JS refs — archive + DROP with platform_operators wave',
  },
  {
    id: 'god_table_superadmin_accounts',
    status: 'deprecated',
    canonical: '(dropped)',
    legacy: 'superadmin_accounts',
    notes: 'Zero runtime JS refs — archive + DROP',
  },
  {
    id: 'god_table_admin',
    status: 'deprecated',
    canonical: '(dropped)',
    legacy: 'admin',
    notes: 'Zero runtime JS refs — verify no CMS FK then DROP',
  },
  {
    id: 'operator_gate_policy_only',
    status: 'peel_target',
    canonical: 'backend/identity/permissions/platform-grant.js',
    legacy: 'src/core/operator-identity.js + platform_operators query',
    notes: 'userIsPlatformOperator = policy.platform_operator OR user_governance_roles only',
  },
  {
    id: 'tunnel_owner_terminal_connections',
    status: 'peel_target',
    canonical: 'terminal_connections.metadata_json (conn_gcp_iam_tunnel)',
    legacy: 'platform_operators.tunnel_*',
  },
  {
    id: 'legacy_token_hash_kv',
    status: 'deprecated',
    canonical: 'iam:mcp:token:{hash}',
    legacy: 'token_hash:{hash}',
  },
  {
    id: 'deploy_kv_markers',
    status: 'deprecated',
    canonical: 'D1 deployments',
    legacy: 'agent_sam:deploy:* in MCP_TOKENS',
    notes: 'Guarded — must not return',
  },
  {
    id: 'notification_prefs',
    status: 'live',
    canonical: 'backend/identity/notification-prefs.js',
    legacy: 'src/core/notification-prefs.js (deleted)',
    notes: 'user_settings.settings_json.notify + D1 recipient resolve — never RESEND_TO. src/core/notification-prefs.js remains for notifySam/keys-security until those peel.',
  },
  {
    id: 'notify_user',
    status: 'live',
    canonical: 'backend/identity/notify-user.js',
    legacy: 'src/core/notifications.js notifySam (operator/RESEND_TO path remains)',
    notes: 'User-scoped email; identity.notifyUser + tool-loop approval + settings test',
  },
]);

/**
 * @param {string} id
 * @returns {(typeof IDENTITY_PEEL_MANIFEST)[number] | undefined}
 */
export function peelEntry(id) {
  return IDENTITY_PEEL_MANIFEST.find((e) => e.id === id);
}
