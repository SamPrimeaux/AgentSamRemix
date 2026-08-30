/**
 * agentsam_bootstrap resolution — multi-tenant workspace + bootstrap row selection.
 */
import {
  getAuthUser,
  getRequestAuth,
  userFromAuthContext,
} from './resolve-identity.js';
import { getSession } from './sessions/read.js';
import { fetchAuthUserTenantId } from './users/tenant.js';
import { getWorkspaceTenantIdWithFallback } from './workspace/agentsam-workspace.js';
import {
  userCanAccessWorkspace,
  workspaceMemberUserCandidates,
} from './workspace/access.js';

export const WORKSPACE_CONTEXT_MISSING = 'WORKSPACE_CONTEXT_MISSING';
/** workspace_settings.workspace_root missing or invalid for the resolved workspace id */
export const WORKSPACE_ROOT_CONTEXT_MISSING = 'WORKSPACE_ROOT_CONTEXT_MISSING';

function trim(s) {
  if (s == null) return '';
  const t = String(s).trim();
  return t;
}

/** @param {any} env @param {any} authUser @param {string} uid @param {string} candidate */
async function acceptWorkspaceIfMember(env, authUser, uid, candidate) {
  const wid = trim(candidate);
  if (!wid || !env?.DB) return '';
  const actor = authUser?.id ? authUser : uid ? { id: uid } : null;
  if (!actor) return '';
  // No superadmin short-circuit — phantoms must fail registry check for everyone.
  if (await userCanAccessWorkspace(env, actor, wid)) return wid;
  return '';
}

/** First active workspace_members row for user (auth_users.id or linked users.id). */
async function resolveFirstMemberWorkspaceId(env, authUser, uid) {
  const candidates = await workspaceMemberUserCandidates(
    env,
    authUser?.id ? authUser : { id: uid },
  );
  if (!candidates.length || !env?.DB) return '';
  const ph = candidates.map(() => '?').join(', ');
  try {
    const wm = await env.DB.prepare(
      `SELECT workspace_id FROM workspace_members
       WHERE user_id IN (${ph}) AND COALESCE(is_active, 1) = 1
       ORDER BY COALESCE(joined_at, created_at) DESC
       LIMIT 1`,
    )
      .bind(...candidates)
      .all();
    const row = wm.results?.[0];
    return row?.workspace_id ? trim(row.workspace_id) : '';
  } catch {
    return '';
  }
}

/**
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 */
export async function resolveTenantIdForWorkspace(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) return null;
  try {
    const tw = await env.DB.prepare(
      `SELECT tenant_id FROM tenant_workspaces
       WHERE workspace_id = ? AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(ws)
      .first();
    if (tw?.tenant_id) return trim(tw.tenant_id) || null;
    return await getWorkspaceTenantIdWithFallback(env, ws);
  } catch {
    return null;
  }
}

/**
 * Default workspace id for a tenant (tenant_workspaces.is_default).
 */
export async function resolveDefaultWorkspaceIdForTenant(env, tenantId) {
  const tid = trim(tenantId);
  if (!tid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT workspace_id FROM tenant_workspaces
       WHERE tenant_id = ? AND COALESCE(is_default, 0) = 1 AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(tid)
      .first();
    return row?.workspace_id ? trim(row.workspace_id) || null : null;
  } catch {
    return null;
  }
}

/**
 * Resolves effective workspace for authenticated requests without hardcoding tenant workspaces.
 *
 * Do not hardcode tenant_id, workspace_id, user_id, person_uuid, or auth IDs in runtime API/tool/agent
 * code — derive identity from session, auth_users, workspace membership, and env-backed platform scope.
 * Use resolveCanonicalUserId (auth) + this helper, then pass the result as runtimeContext downstream.
 *
 * @returns {Promise<{ workspaceId: string|null, error: string|null }>}
 */
export async function resolveEffectiveWorkspaceId(env, request, authUser, cache) {
  if (!env?.DB) return { workspaceId: null, error: WORKSPACE_CONTEXT_MISSING };

  let workspaceId = '';
  let session = cache?.__session ?? null;

  if (request) {
    let authCtx = cache?.__authCtx;
    if (authCtx === undefined) {
      authCtx = await getRequestAuth(request, env, { required: false }).catch(() => null);
      if (cache && typeof cache === 'object') cache.__authCtx = authCtx;
    }
    const primedUser = authCtx ? userFromAuthContext(authCtx) : null;
    if (primedUser?.workspace_id && !authUser) {
      authUser = primedUser;
    }

    if (!session) {
      session = await getSession(env, request).catch(() => null);
      if (cache && typeof cache === 'object') cache.__session = session;
    }
  }

  const uid = trim(authUser?.id);

  const headerCandidate =
    trim(request?.headers?.get?.('x-iam-workspace-id')) ||
    trim(authUser?.workspace_id) ||
    '';
  if (headerCandidate) {
    workspaceId = await acceptWorkspaceIfMember(env, authUser, uid, headerCandidate);
  }

  if (!workspaceId && session?.workspace_id) {
    workspaceId = await acceptWorkspaceIfMember(env, authUser, uid, session.workspace_id);
  }

  if (!workspaceId && uid) {
    try {
      const au = await env.DB.prepare(
        `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
      )
        .bind(uid)
        .first();
      if (au?.active_workspace_id) {
        workspaceId = await acceptWorkspaceIfMember(env, authUser, uid, au.active_workspace_id);
      }
    } catch (_) {}
  }

  let tenantId = trim(authUser?.tenant_id) || trim(session?.tenant_id) || '';

  if (!tenantId && uid) {
    tenantId = trim(await fetchAuthUserTenantId(env, uid).catch(() => null));
  }

  if (!workspaceId && tenantId) {
    const tenantDefault = trim(await resolveDefaultWorkspaceIdForTenant(env, tenantId)) || '';
    if (tenantDefault) {
      workspaceId = await acceptWorkspaceIfMember(env, authUser, uid, tenantDefault);
    }
  }

  if (!workspaceId && uid) {
    workspaceId = await resolveFirstMemberWorkspaceId(env, authUser, uid);
  }

  if (!workspaceId) {
    return { workspaceId: null, error: WORKSPACE_CONTEXT_MISSING };
  }

  return { workspaceId, error: null };
}

/**
 * Terminal: optional explicit workspace from URL/body must pass membership checks; otherwise session/auth resolution.
 *
 * @returns {Promise<{ workspaceId: string|null, error: string|null }>}
 */
export async function resolveTerminalWorkspaceId(env, request, authUser, explicitRaw) {
  const explicit = trim(explicitRaw);
  if (explicit) {
    if (!(await userCanAccessWorkspace(env, authUser, explicit))) {
      return { workspaceId: null, error: 'Forbidden' };
    }
    return { workspaceId: explicit, error: null };
  }
  const base = await resolveEffectiveWorkspaceId(env, request, authUser, {});
  if (base.error || !base.workspaceId) {
    return { workspaceId: null, error: WORKSPACE_CONTEXT_MISSING };
  }
  return { workspaceId: base.workspaceId, error: null };
}

/**
 * Active bootstrap row for the given identity + workspace scope.
 *
 * Selection order (user isolation):
 * 1. user_id + workspace_id (active) — canonical
 * 2. person_uuid + workspace_id only when row.user_id is empty or matches userId
 * 3. Legacy: user_id-only when exactly one active bootstrap exists AND workspace is a member workspace
 *
 * Tenant-only rows (user_id NULL) are never returned — they caused cross-user capability bleed.
 *
 * @param {any} env
 * @param {{ userId?: string|null, personUuid?: string|null, tenantId?: string|null, workspaceId?: string|null }} opts
 */
export async function resolveActiveBootstrap(env, opts) {
  if (!env?.DB) return null;

  let wid = trim(opts.workspaceId);
  const uid = trim(opts.userId);
  const pid = trim(opts.personUuid);
  let tid = trim(opts.tenantId);

  if (!tid && wid) {
    tid = trim(await resolveTenantIdForWorkspace(env, wid)) || '';
  }

  if (!wid && tid && uid) {
    wid = trim(await resolveDefaultWorkspaceIdForTenant(env, tid)) || '';
    if (wid) {
      const actor = { id: uid };
      if (!(await userCanAccessWorkspace(env, actor, wid))) wid = '';
    }
  }

  let row = null;

  if (wid && uid) {
    row = await env.DB.prepare(
      `SELECT * FROM agentsam_bootstrap
       WHERE COALESCE(is_active, 1) = 1 AND user_id = ? AND workspace_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
      .bind(uid, wid)
      .first()
      .catch(() => null);
  }

  if (!row && wid && pid && uid) {
    row = await env.DB.prepare(
      `SELECT * FROM agentsam_bootstrap
       WHERE COALESCE(is_active, 1) = 1 AND person_uuid = ? AND workspace_id = ?
         AND (user_id IS NULL OR trim(user_id) = '' OR user_id = ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
      .bind(pid, wid, uid)
      .first()
      .catch(() => null);
    if (row && trim(row.user_id) && trim(row.user_id) !== uid) row = null;
  }

  if (!row && !wid && uid) {
    try {
      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM agentsam_bootstrap
         WHERE user_id = ? AND COALESCE(is_active, 1) = 1`,
      )
        .bind(uid)
        .first();
      const n = Number(cnt?.n || 0);
      if (n === 1) {
        row = await env.DB.prepare(
          `SELECT * FROM agentsam_bootstrap
           WHERE user_id = ? AND COALESCE(is_active, 1) = 1
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
          .bind(uid)
          .first()
          .catch(() => null);
        if (row?.workspace_id) {
          const actor = { id: uid };
          if (!(await userCanAccessWorkspace(env, actor, trim(row.workspace_id)))) row = null;
        }
      }
    } catch (_) {}
  }

  return row || null;
}

/**
 * Workspace + bootstrap slice for routing / telemetry (replaces legacy user-only bootstrap SELECT).
 *
 * @returns {Promise<{ workspace_id: string|null, bootstrap: object|null, error: string|null }>}
 */
export async function resolveBootstrapWorkspaceContext(env, request, userId, cache) {
  const uid = userId != null ? String(userId).trim() : '';
  if (!uid) {
    return { workspace_id: null, bootstrap: null, error: WORKSPACE_CONTEXT_MISSING };
  }

  if (cache && typeof cache === 'object' && cache.__bootstrapCtx != null) {
    return cache.__bootstrapCtx;
  }

  const primedAuthUser = cache && typeof cache === 'object' ? cache.__authUser : null;
  const authUser =
    primedAuthUser ||
    (request ? await getAuthUser(request, env).catch(() => null) : null);

  let syntheticAuth = authUser;
  if (!syntheticAuth && uid && env?.DB) {
    try {
      const ur = await env.DB.prepare(`SELECT * FROM auth_users WHERE id = ? LIMIT 1`).bind(uid).first();
      if (ur) {
        syntheticAuth = {
          id: ur.id,
          tenant_id: ur.tenant_id,
          person_uuid: ur.person_uuid,
          email: ur.email,
        };
      }
    } catch (_) {}
  }

  const wsRes = await resolveEffectiveWorkspaceId(env, request, syntheticAuth, cache || {});
  if (wsRes.error) {
    const out = { workspace_id: null, bootstrap: null, error: wsRes.error };
    if (cache && typeof cache === 'object') cache.__bootstrapCtx = out;
    return out;
  }

  const wid = wsRes.workspaceId;
  const tid =
    trim(syntheticAuth?.tenant_id) ||
    trim(await fetchAuthUserTenantId(env, uid).catch(() => null)) ||
    trim(await resolveTenantIdForWorkspace(env, wid)) ||
    '';

  const boot = await resolveActiveBootstrap(env, {
    userId: uid,
    personUuid: syntheticAuth?.person_uuid || null,
    tenantId: tid || null,
    workspaceId: wid,
  });

  const out = {
    workspace_id: wid,
    bootstrap: boot || null,
    error: null,
  };
  if (cache && typeof cache === 'object') cache.__bootstrapCtx = out;
  return out;
}
