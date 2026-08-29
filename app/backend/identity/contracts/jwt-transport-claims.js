/**
 * JWT transport claims — identity passport only, never full authorization.
 *
 * Rule: JWT proves *who* and *which session/workspace pin* — not tool policy.
 * Authorization compiles from D1 → MCP_TOKENS (`iam:mcp:perm*`) at bootstrap time.
 *
 * @module backend/identity/contracts/jwt-transport-claims
 */

/** @typedef {'browser_session'|'mcp_bearer'|'identity_oidc'} JwtTransportKind */

/**
 * Minimum claims for browser edge session JWT (HS256, HttpOnly cookie).
 * Implementation: backend/auth/session-tokens.js
 *
 * @typedef {Object} BrowserSessionJwtClaims
 * @property {string} sub auth_users.id (au_*)
 * @property {string} sid auth_sessions.id
 * @property {string|null} [tid] tenant_id
 * @property {string|null} [wid] workspace_id pin at mint time
 * @property {string|null} [pid] person_uuid
 * @property {number} rev auth revocation generation (KV iam_auth_rev_v1:*)
 * @property {number} exp unix seconds
 * @property {number} [iat]
 * @property {number} [v] EDGE_SESSION_TOKEN_VERSION
 */

/**
 * MCP user bearer JWT payload (signed blob + HMAC suffix).
 * Authority mirror: D1 mcp_workspace_tokens + optional KV iam:mcp:token:{hash}.
 * Implementation: src/core/mcp-auth.js
 *
 * @typedef {Object} McpBearerJwtPayload
 * @property {string} userId au_*
 * @property {string} workspaceId ws_*
 * @property {string} tenantId tenant_*
 * @property {string} jti mcp_workspace_tokens.id
 */

/**
 * Claims that must NEVER appear in a transport JWT (use bootstrap perm-snapshot instead).
 * @type {readonly string[]}
 */
export const JWT_FORBIDDEN_AUTHZ_CLAIMS = Object.freeze([
  'capabilities',
  'can_run_pty',
  'can_run_mcp',
  'can_deploy',
  'allowed_tools',
  'governance_roles',
  'agent_flags',
  'policy_hash',
  'tool_risk_level_max',
  'is_superadmin',
]);

/**
 * @param {Record<string, unknown>} payload
 * @returns {string[]} forbidden keys present in payload
 */
export function findForbiddenAuthzClaims(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return JWT_FORBIDDEN_AUTHZ_CLAIMS.filter((k) => Object.prototype.hasOwnProperty.call(payload, k));
}
