/**
 * Links identity resolution → agentsam_bootstrap materialization.
 *
 * Login/session truth: SESSION_CACHE (iam:sess, iam:ctx) — see session-context service.
 * Agent authority truth: D1 compile → MCP_TOKENS (iam:mcp:perm*) — NOT duplicated in JWT.
 *
 * Call after resolveIdentity() when a handler needs compiled agent authority.
 */

export { resolveAgentSamBootstrap } from '../services/bootstrap/resolve.js';
export { CURRENT_BOOTSTRAP_COMPILER_VERSION } from '../services/bootstrap/hash.js';

/**
 * When to trigger bootstrap recompile (non-exhaustive; see backend/services/bootstrap/INTEGRATION.md):
 * - GET /api/agent/bootstrap when Agent Sam needs compiled authority
 * - policy / governance / agent-flag change
 * - keys lifecycle (create, rotate, revoke)
 *
 * Bootstrap row id: asb_{workspace_id}_{user_id}
 * D1 table: agentsam_bootstrap
 */
