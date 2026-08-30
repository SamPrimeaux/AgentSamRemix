/**
 * Identity spine — canonical entry for "who is this request?"
 *
 * This module owns request authentication and the authenticated-user leaf.
 * Session transport is kept in `sessions/`; workspace authorization remains a
 * lower-level identity dependency.
 *
 * @module backend/identity/resolve-identity
 */

import { validateMcpToken } from './tokens/mcp-bearer.js';
import { resolveMachineProof } from '../auth/bridge-key-auth.js';
import { AuthError } from '../auth/errors.js';
import {
  loadAgentSamUserPolicyCached,
  loadMembershipCached,
} from './permissions/index.js';
import { fetchAuthUserTenantId } from './users/tenant.js';
import { computeAuthCapabilities, trimSessionField } from './sessions/fields.js';
import { getSession } from './sessions/read.js';
import { resolveRequestWorkspace } from './workspace/request-resolve.js';
import { identityContextFromAuthContext } from './contracts/identity-context.js';
import { resolveCanonicalWorkspace } from './workspace-resolve.js';

/** Per-request auth resolution cache (primed once at Worker front door). */
const requestAuthCache = new WeakMap();

function extractBearerToken(request) {
  const auth = request?.headers?.get?.('Authorization');
  if (!auth || !String(auth).toLowerCase().startsWith('bearer ')) return null;
  const token = String(auth).slice(7).trim();
  return token || null;
}

/**
 * Canonical user object from resolveAuth() AuthContext.
 * @param {AuthContext} ctx
 */
export function userFromAuthContext(ctx) {
  const userId = trimSessionField(ctx?.userId);
  if (!userId) return null;

  const authType = trimSessionField(ctx?.authType) || 'session';
  const tenantId = trimSessionField(ctx?.tenantId) || null;
  if (authType === 'session' && !tenantId) return null;

  return {
    id: userId,
    auth_id: userId,
    user_id: userId,
    tenant_id: tenantId,
    active_tenant_id: tenantId,
    auth_type: authType,
    capabilities: ctx.capabilities ?? {
      canRunPty: false,
      canRunMcp: false,
      canDeploy: false,
    },
    session_id: ctx.sessionId ?? null,
    person_uuid: ctx.personUuid ?? null,
    email: ctx.email ?? null,
    name: ctx.name ?? null,
    display_name: ctx.displayName ?? null,
    avatar_url: null,
    membership_role: ctx.membership?.role ?? null,
  };
}

/**
 * Single auth gate: session or MCP bearer → auth_users → memberships → policy.
 *
 * @param {Request} request
 * @param {any} env
 * @param {{ required?: boolean, workspaceIdOverride?: string | null }} [opts]
 * @returns {Promise<AuthContext | null>}
 */
export async function resolveAuth(request, env, opts = {}) {
  if (request && requestAuthCache.has(request) && !opts.workspaceIdOverride) {
    const cached = requestAuthCache.get(request);
    if (cached) return cached;
    if (!opts.required) return null;
    throw new AuthError('Unauthorized', { status: 401, code: 'SESSION_MISSING' });
  }

  const required = opts.required !== false;
  const bearer = extractBearerToken(request);
  let authType = 'session';
  let userId = '';
  let tenantId = null;
  let workspaceId = null;
  let sessionId = null;
  let sessionRaw = null;

  if (bearer) {
    const mcp = await validateMcpToken(env, bearer);
    const mcpUserId = mcp?.userId != null ? trimSessionField(mcp.userId) : '';
    if (mcpUserId) {
      authType = 'mcp';
      userId = mcpUserId;
      tenantId = trimSessionField(mcp.tenantId) || null;
      workspaceId = trimSessionField(mcp.workspaceId) || null;
    } else {
      const bridge = resolveMachineProof(request, env);
      if (bridge?.delegatedUserId) {
        authType = bridge.type;
        userId = bridge.delegatedUserId;
      }
    }
  }

  if (!userId) {
    sessionRaw = await getSession(env, request);
    if (!sessionRaw) {
      if (required) throw new AuthError('Unauthorized', { status: 401, code: 'SESSION_MISSING' });
      return null;
    }
    userId = trimSessionField(sessionRaw.user_id);
    sessionId = trimSessionField(sessionRaw.session_id) || null;
    if (!tenantId) tenantId = trimSessionField(sessionRaw.tenant_id) || null;
  }

  if (!userId) {
    if (required) throw new AuthError('Unauthorized', { status: 401, code: 'USER_MISSING' });
    return null;
  }

  const isEdgeSession = sessionRaw?.edge === true;
  const rowFromSessionRaw = () => {
    if (!sessionRaw?.user_id) return null;
    return {
      id: userId,
      email: sessionRaw.email ?? null,
      name: sessionRaw.display_name ?? sessionRaw.name ?? null,
      display_name: sessionRaw.display_name ?? sessionRaw.name ?? null,
      person_uuid: sessionRaw.person_uuid ?? null,
      active_tenant_id: sessionRaw.tenant_id ?? null,
      tenant_id: sessionRaw.tenant_id ?? null,
      active_workspace_id: sessionRaw.workspace_id ?? null,
    };
  };

  let row = null;
  if (isEdgeSession) {
    row = rowFromSessionRaw();
  } else if (env?.DB) {
    try {
      row = await env.DB.prepare('SELECT * FROM auth_users WHERE id = ? LIMIT 1').bind(userId).first();
    } catch (error) {
      console.warn('[resolveAuth]', error?.message || error);
      row = rowFromSessionRaw();
    }
  } else {
    row = rowFromSessionRaw();
  }

  if (!row?.id) {
    if (required) throw new AuthError('Unauthorized', { status: 401, code: 'USER_NOT_FOUND' });
    return null;
  }

  if (!tenantId) {
    tenantId =
      trimSessionField(row.active_tenant_id) || trimSessionField(row.tenant_id) || null;
  }
  if (!tenantId && userId && !isEdgeSession) {
    tenantId = trimSessionField(await fetchAuthUserTenantId(env, userId)) || null;
  }

  const dbActiveWs = trimSessionField(row.active_workspace_id);
  const sessionWs =
    trimSessionField(sessionRaw?.workspace_id) ||
    trimSessionField(sessionRaw?.workspaceId) ||
    null;
  const workspaceResolution = await resolveRequestWorkspace(env, {
    request,
    userId,
    tenantId,
    authType,
    requestedWorkspaceId: opts.workspaceIdOverride,
    storedActiveWorkspaceId: dbActiveWs,
    sessionWorkspaceId: sessionWs,
    tokenWorkspaceId: workspaceId,
  });
  if (!workspaceResolution.id) {
    throw new AuthError(
      'Workspace required: this account has no authorized workspace for the request.',
      { status: 403, code: 'WORKSPACE_REQUIRED' },
    );
  }
  workspaceId = workspaceResolution.id;

  let membership;
  let policy;
  let capabilities;
  const workspaceChanged =
    isEdgeSession &&
    workspaceResolution.source === 'request' &&
    trimSessionField(sessionRaw?.workspace_id) &&
    workspaceId !== trimSessionField(sessionRaw?.workspace_id);

  if (isEdgeSession && sessionRaw?.capabilities && !workspaceChanged) {
    capabilities = sessionRaw.capabilities;
    membership = {
      role: null,
      can_run_pty: capabilities.canRunPty ? 1 : 0,
      can_run_mcp: capabilities.canRunMcp ? 1 : 0,
      can_deploy: capabilities.canDeploy ? 1 : 0,
      org_id: null,
    };
    policy = null;
  } else {
    membership = workspaceId ? await loadMembershipCached(env, userId, workspaceId) : null;
    policy = await loadAgentSamUserPolicyCached(env, userId, workspaceId || '');
    capabilities = computeAuthCapabilities(membership, policy);
  }

  const out = {
    userId: String(row.id),
    email: row.email != null ? String(row.email) : null,
    name: row.name != null ? String(row.name) : null,
    displayName: row.display_name ?? row.name ?? null,
    personUuid: row.person_uuid != null ? String(row.person_uuid) : null,
    tenantId,
    workspaceId: workspaceId || null,
    storedActiveWorkspaceId: dbActiveWs || null,
    sessionId,
    authType,
    membership,
    policy,
    capabilities,
    sessionRaw,
  };
  if (request && !opts.workspaceIdOverride) requestAuthCache.set(request, out);
  return out;
}

export async function primeRequestAuth(request, env) {
  if (!request || requestAuthCache.has(request)) return;
  try {
    requestAuthCache.set(request, (await resolveAuth(request, env, { required: false })) ?? null);
  } catch {
    requestAuthCache.set(request, null);
  }
}

export function primeRequestAuthWithContext(request, authContext) {
  if (request) requestAuthCache.set(request, authContext ?? null);
}

export function peekRequestAuth(request) {
  if (!request || !requestAuthCache.has(request)) return undefined;
  return requestAuthCache.get(request) ?? null;
}

export async function getRequestAuth(request, env, opts = {}) {
  if (request && requestAuthCache.has(request)) {
    const cached = requestAuthCache.get(request);
    if (cached) return cached;
    if (!opts.required) return null;
    throw new AuthError('Unauthorized', { status: 401, code: 'SESSION_MISSING' });
  }
  const ctx = await resolveAuth(request, env, opts);
  if (request) requestAuthCache.set(request, ctx ?? null);
  return ctx;
}

export async function authUserFromRequest(request, env, authCtx = undefined, routeAuthUser = null) {
  if (routeAuthUser) return routeAuthUser;
  if (authCtx !== undefined) return authCtx ? userFromAuthContext(authCtx) : null;
  const peeked = peekRequestAuth(request);
  if (peeked !== undefined) return peeked ? userFromAuthContext(peeked) : null;
  const ctx = await getRequestAuth(request, env, { required: false });
  return ctx ? userFromAuthContext(ctx) : null;
}

export async function resolveRequestContext(request, env, opts = {}) {
  const ctx = await resolveAuth(request, env, opts);
  if (!ctx) return { error: 'unauthenticated' };
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    tenantId: ctx.tenantId,
    authType: ctx.authType === 'mcp' || ctx.authType === 'bridge' ? 'bearer' : 'session',
  };
}

export async function getSamContext(request, env) {
  const authCtx = await getRequestAuth(request, env, { required: false });
  const session = authCtx?.sessionRaw ?? (await getSession(env, request).catch(() => null));
  const authUser = authCtx ? userFromAuthContext(authCtx) : null;
  return { session, authUser, authCtx };
}

export async function getAuthUser(request, env, opts = {}) {
  try {
    const ctx = await getRequestAuth(request, env, { required: false, ...opts });
    return ctx ? userFromAuthContext(ctx) : null;
  } catch (error) {
    if (error instanceof AuthError) {
      if (Number(error.status) === 403) throw error;
      return null;
    }
    console.warn('[getAuthUser]', error?.message || error);
    return null;
  }
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Load the persisted workspace preference for one authenticated account.
 * This is preference data only; authorization is performed by resolveIdentity().
 *
 * @param {any} env
 * @param {string} userId
 */
export async function fetchAuthUserWorkspacePrefs(env, userId) {
  const uid = trim(userId);
  if (!env?.DB || !uid) {
    return {
      active_workspace_id: null,
      default_workspace_id: null,
      canonical_workspace_id: null,
    };
  }

  const row = await env.DB.prepare(
    `SELECT active_workspace_id, default_workspace_id
       FROM auth_users
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(uid)
    .first()
    .catch(() => null);
  const canonical = await resolveCanonicalWorkspace(env, uid);

  return {
    active_workspace_id: trim(row?.active_workspace_id) || null,
    default_workspace_id: trim(row?.default_workspace_id) || null,
    canonical_workspace_id: canonical ? String(canonical) : null,
  };
}

/**
 * Golden function — returns portable IdentityContext for handlers, bootstrap, MCP authority.
 *
 * @param {Request} request
 * @param {any} env
 * @param {{ required?: boolean, workspaceIdOverride?: string | null }} [opts]
 * @returns {Promise<import('./contracts/identity-context.js').IdentityContext>}
 */
export async function resolveIdentity(request, env, opts = {}) {
  const ctx = await resolveAuth(request, env, opts);
  return identityContextFromAuthContext(ctx);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ required?: boolean, workspaceIdOverride?: string | null }} [opts]
 * @returns {Promise<import('./contracts/identity-context.js').IdentityContext | null>}
 */
export async function resolveIdentityOptional(request, env, opts = {}) {
  try {
    const ctx = await resolveAuth(request, env, { ...opts, required: false });
    if (!ctx) return null;
    return identityContextFromAuthContext(ctx);
  } catch (error) {
    if (Number(error?.status) === 403) throw error;
    return null;
  }
}
