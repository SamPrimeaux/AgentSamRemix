/**
 * Resolve a unified actor for MCP and protected API paths.
 * Fails closed on missing tenancy or illegal workspace override.
 */

import { resolveAuth } from './auth.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * @typedef {{
 *   ok: true,
 *   userId: string,
 *   authUserId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   personUuid: string | null,
 *   sessionId: string | null,
 *   agentId: string | null,
 *   actorType: 'user'|'service',
 *   actorSource: string,
 *   roles: string[],
 *   scopes: string[],
 *   mayUsePrivilegedTerminal: boolean,
 * }} ResolvedActorOk
 */

/**
 * @typedef {{
 *   ok: false,
 *   code: 'ACTOR_CONTEXT_MISSING'|'WORKSPACE_ACCESS_DENIED',
 *   message: string,
 * }} ResolvedActorErr
 */

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   workspaceIdParam?: string | null,
 *   agentId?: string | null,
 *   actorSource?: string | null,
 *   serviceActor?: {
 *     userId: string,
 *     tenantId: string,
 *     workspaceId: string,
 *     personUuid?: string | null,
 *     sessionId?: string | null,
 *     agentId?: string | null,
 *     source?: string | null,
 *   } | null,
 * }} [options]
 * @returns {Promise<ResolvedActorOk|ResolvedActorErr>}
 */
export async function resolveActorContext(request, env, options = {}) {
  const opts = options || {};

  if (opts.serviceActor) {
    const sa = opts.serviceActor;
    const userId = trim(sa.userId);
    const tenantId = trim(sa.tenantId);
    const workspaceId = trim(sa.workspaceId);
    if (!userId.startsWith('au_') || !tenantId || !workspaceId) {
      return {
        ok: false,
        code: 'ACTOR_CONTEXT_MISSING',
        message: 'service actor requires au_* userId and tenant/workspace',
      };
    }
    return {
      ok: true,
      userId,
      authUserId: userId,
      tenantId,
      workspaceId,
      personUuid: sa.personUuid != null ? trim(sa.personUuid) || null : null,
      sessionId: sa.sessionId != null ? trim(sa.sessionId) || null : null,
      agentId: sa.agentId != null ? trim(sa.agentId) || null : null,
      actorType: 'service',
      actorSource: trim(sa.source) || 'system',
      roles: [],
      scopes: [],
      mayUsePrivilegedTerminal: false,
    };
  }

  const workspaceIdParam = opts.workspaceIdParam != null ? trim(opts.workspaceIdParam) : '';

  let auth = null;
  try {
    auth = await resolveAuth(request, env, {
      required: true,
      workspaceIdOverride: workspaceIdParam || null,
    });
  } catch (e) {
    return {
      ok: false,
      code: 'ACTOR_CONTEXT_MISSING',
      message: e?.message || 'unauthorized',
    };
  }

  const userId = trim(auth?.userId);
  const tenantId = trim(auth?.tenantId);
  let workspaceId = trim(auth?.workspaceId);
  const personUuid =
    auth?.personUuid != null && trim(auth.personUuid) !== '' ? trim(auth.personUuid) : null;
  const sessionId =
    auth?.sessionId != null && trim(auth.sessionId) !== '' ? trim(auth.sessionId) : null;

  if (!userId || !tenantId || !workspaceId) {
    return {
      ok: false,
      code: 'ACTOR_CONTEXT_MISSING',
      message: 'missing userId, tenantId, or workspaceId',
    };
  }

  if (workspaceIdParam && workspaceIdParam !== workspaceId) {
    const { authorizeWorkspaceAccess } = await import('./workspace-access.js');
    const ok = await authorizeWorkspaceAccess(env, userId, workspaceIdParam);
    if (!ok) {
      return {
        ok: false,
        code: 'WORKSPACE_ACCESS_DENIED',
        message: 'workspace not in registry or not allowed for user',
      };
    }
    workspaceId = ok;
  }

  let mayUsePrivilegedTerminal = false;
  try {
    const { userMayUsePrivilegedTerminal } = await import('../../backend/identity/workspace/grants.js');
    mayUsePrivilegedTerminal = await userMayUsePrivilegedTerminal(env, { id: userId }, workspaceId);
  } catch (_) {}

  const roles = auth?.membership?.role ? [String(auth.membership.role)] : [];
  const scopes = [];
  if (auth?.capabilities?.canRunPty) scopes.push('pty');
  if (auth?.capabilities?.canRunMcp) scopes.push('mcp');
  if (auth?.capabilities?.canDeploy) scopes.push('deploy');

  return {
    ok: true,
    userId,
    authUserId: userId,
    tenantId,
    workspaceId,
    personUuid,
    sessionId,
    agentId: opts.agentId != null ? trim(opts.agentId) || null : null,
    actorType: 'user',
    actorSource: trim(opts.actorSource) || 'dashboard',
    roles,
    scopes,
    mayUsePrivilegedTerminal,
  };
}
