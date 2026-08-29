/**
 * Portable identity contracts — transport-agnostic shapes for IAM runtime.
 * Peel target: eventually shared with @inneranimalmedia/agentsam-sdk identity package.
 *
 * @module backend/identity/contracts/identity-context
 */

/**
 * @typedef {Object} IdentityUser
 * @property {string} id Canonical auth_users.id (au_*).
 * @property {string|null} [personId] person_uuid when present.
 * @property {string|null} [email]
 * @property {string|null} [displayName]
 */

/**
 * @typedef {Object} IdentityTenant
 * @property {string|null} id tenant_* when resolved.
 */

/**
 * @typedef {Object} IdentityWorkspace
 * @property {string|null} id Active request workspace (ws_*).
 * @property {string|null} [storedActiveId] auth_users.active_workspace_id — do not conflate with request scope.
 */

/**
 * @typedef {Object} IdentityMembership
 * @property {string|null} role memberships.role or workspace relationship role.
 * @property {number} [canRunPty] 0|1
 * @property {number} [canRunMcp] 0|1
 * @property {number} [canDeploy] 0|1
 */

/**
 * @typedef {Object} IdentityCapabilityBag
 * @property {boolean} canRunPty
 * @property {boolean} canRunMcp
 * @property {boolean} canDeploy
 */

/**
 * @typedef {Object} IdentityContext
 * @property {boolean} authenticated
 * @property {'session'|'mcp'|'bridge'|'none'} authType
 * @property {string|null} sessionId
 * @property {IdentityUser} user
 * @property {IdentityTenant} tenant
 * @property {IdentityWorkspace} workspace
 * @property {IdentityMembership|null} membership
 * @property {IdentityCapabilityBag} capabilities
 */

/** @returns {IdentityContext} */
export function emptyIdentityContext() {
  return {
    authenticated: false,
    authType: 'none',
    sessionId: null,
    user: { id: '', personId: null, email: null, displayName: null },
    tenant: { id: null },
    workspace: { id: null, storedActiveId: null },
    membership: null,
    capabilities: { canRunPty: false, canRunMcp: false, canDeploy: false },
  };
}

/**
 * Map request-auth data into the portable IdentityContext.
 * @param {Record<string, any> | null | undefined} ctx
 * @returns {IdentityContext}
 */
export function identityContextFromAuthContext(ctx) {
  if (!ctx?.userId) return emptyIdentityContext();

  const caps = ctx.capabilities ?? {};
  const mem = ctx.membership;

  return {
    authenticated: true,
    authType:
      ctx.authType === 'mcp' || ctx.authType === 'bridge'
        ? ctx.authType
        : 'session',
    sessionId: ctx.sessionId ?? null,
    user: {
      id: String(ctx.userId),
      personId: ctx.personUuid ?? null,
      email: ctx.email ?? null,
      displayName: ctx.displayName ?? ctx.name ?? null,
    },
    tenant: { id: ctx.tenantId ?? null },
    workspace: {
      id: ctx.workspaceId ?? null,
      storedActiveId: ctx.storedActiveWorkspaceId ?? null,
    },
    membership: mem
      ? {
          role: mem.role ?? null,
          canRunPty: Number(mem.can_run_pty) === 1 ? 1 : 0,
          canRunMcp: Number(mem.can_run_mcp) === 1 ? 1 : 0,
          canDeploy: Number(mem.can_deploy) === 1 ? 1 : 0,
        }
      : null,
    capabilities: {
      canRunPty: Boolean(caps.canRunPty),
      canRunMcp: Boolean(caps.canRunMcp),
      canDeploy: Boolean(caps.canDeploy),
    },
  };
}
