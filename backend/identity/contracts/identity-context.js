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

/**
 * authUser — SSOT for "who is this person," sourced from exactly one
 * table (`auth_users`) via exactly one query, defined in exactly this
 * function. No other file in this codebase may run
 * `SELECT ... FROM auth_users` directly — CI enforces this
 * (see "Single auth_users read authority invariant" in ci.yml).
 *
 * Fields are strictly facts about the person from that one row.
 * Request-scoped data (workspace, tenant, capabilities) is resolved
 * alongside this by identityContextFromAuthContext(), never folded
 * into authUser itself — a person's identity doesn't change per
 * request; their workspace/capabilities do.
 *
 * Any function gating permissions or spending money must receive its
 * authUser from this call (directly or via IdentityContext.user) —
 * never construct or accept a hand-built {id, email, ...} object as
 * if it were one.
 *
 * @param {{ DB: any }} env
 * @param {string} id auth_users.id (au_*)
 * @returns {Promise<IdentityUser | null>}
 */
export async function loadAuthUser(env, id) {
  const authUserId = String(id ?? '').trim();
  if (!authUserId || !env?.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, person_uuid, email, display_name FROM auth_users WHERE id = ? LIMIT 1`,
  ).bind(authUserId).first().catch(() => null);
  if (!row?.id) return null;
  return {
    id: String(row.id),
    personId: row.person_uuid ?? null,
    email: row.email ?? null,
    displayName: row.display_name ?? null,
  };
}

/**
 * Resolve a raw/legacy identifier to the canonical auth_users.id.
 *
 * Companion to loadAuthUser() for the one legitimate case where a
 * caller doesn't yet have a canonical au_* id — a legacy session, an
 * OAuth callback keyed by email, an older stored reference. This is
 * still the only file allowed to query auth_users; callers pass in
 * whatever raw id/email they have and get back a canonical id (or
 * null), then call loadAuthUser() with that id if they need the full
 * record.
 *
 * @param {{ DB: any }} env
 * @param {{ id?: string|null, email?: string|null }} raw
 * @returns {Promise<string|null>}
 */
export async function resolveAuthUserId(env, raw = {}) {
  const id = String(raw?.id ?? '').trim();
  const email = String(raw?.email ?? '').trim();
  if (!id && !email) return null;

  // Already canonical — no DB hit needed.
  if (/^au_[A-Za-z0-9_-]+$/.test(id)) return id;

  if (!env?.DB) return null;

  if (id) {
    const byId = await env.DB.prepare(`SELECT id FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(id).first().catch(() => null);
    if (byId?.id) return String(byId.id);
  }

  const lookupEmail = email || (id.includes('@') ? id : '');
  if (lookupEmail) {
    const byEmail = await env.DB.prepare(`SELECT id FROM auth_users WHERE lower(email) = lower(?) LIMIT 1`)
      .bind(lookupEmail).first().catch(() => null);
    if (byEmail?.id) return String(byEmail.id);
  }

  return null;
}
