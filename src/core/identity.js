/**
 * src/core/identity.js
 *
 * Resolves authenticated identity from a live request.
 * Returns null if session is missing or expired.
 * Callers must handle null as 401 — never substitute defaults.
 *
 * Authorization gates should use getRequestAuth + authUser (see dashboard-api-identity.js).
 * No isSuperadmin / isPlatformOperator god bits on this object.
 */
import {
  authContextToLegacyUser,
  peekRequestAuth,
  getRequestAuth,
  fetchAuthUserTenantId,
} from './auth.js';
import {
  resolveDefaultWorkspaceForTenant,
  ensureUserTenantWorkspace,
} from '../../backend/identity/workspace/provisioning.js';
import { userCanAccessWorkspace } from '../../backend/identity/workspace/access.js';

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function envAllowsAutoProvision(env) {
  const raw = env?.ALLOW_USER_PROVISIONING;
  if (raw == null) return true;
  const s = String(raw).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no') return false;
  return true;
}

/**
 * Request-scoped actor context for tenancy, workspace headers, and MCP tool scope.
 * Prefer getRequestAuth for new code — this wraps the legacy actor/session merge path.
 */
export async function resolveIamActorContext(request, env) {
  let authCtx = peekRequestAuth(request);
  if (authCtx === undefined) {
    authCtx = await getRequestAuth(request, env, { required: false }).catch(() => null);
  }
  const actor = authCtx ? authContextToLegacyUser(authCtx) : null;

  let tenantId = trimOrNull(actor?.tenant_id) || trimOrNull(authCtx?.tenantId);
  let workspaceIdHeader = trimOrNull(request?.headers?.get?.('x-iam-workspace-id'));
  let workspaceId =
    workspaceIdHeader ||
    trimOrNull(actor?.workspace_id) ||
    trimOrNull(actor?.active_workspace_id) ||
    trimOrNull(authCtx?.workspaceId);

  let userId =
    trimOrNull(actor?.id) ||
    trimOrNull(actor?.user_id) ||
    trimOrNull(authCtx?.userId);

  if (!tenantId && userId && env?.DB) {
    try {
      tenantId = trimOrNull(await fetchAuthUserTenantId(env, userId));
    } catch (_) {}
  }

  const personUuid =
    actor?.person_uuid != null && String(actor.person_uuid).trim() !== ''
      ? String(actor.person_uuid).trim()
      : authCtx?.personUuid != null
        ? String(authCtx.personUuid).trim()
        : null;

  if (workspaceIdHeader && userId && env?.DB && actor) {
    const allowed = await userCanAccessWorkspace(env, actor, workspaceIdHeader);
    if (!allowed) {
      workspaceIdHeader = null;
      workspaceId =
        trimOrNull(actor?.workspace_id) ||
        trimOrNull(actor?.active_workspace_id) ||
        trimOrNull(authCtx?.workspaceId);
    } else {
      workspaceId = workspaceIdHeader;
    }
  }

  if (!workspaceId && tenantId && env?.DB) {
    workspaceId = await resolveDefaultWorkspaceForTenant(env, tenantId);
  }

  const sessionId =
    trimOrNull(actor?.session_id) ||
    trimOrNull(authCtx?.sessionId) ||
    null;

  if (envAllowsAutoProvision(env) && env?.DB && userId) {
    if (!tenantId || !workspaceId) {
      try {
        const provision = await ensureUserTenantWorkspace(env, {
          id: userId,
          email: actor?.email ?? null,
          name: actor?.name ?? null,
          tenant_id: actor?.tenant_id ?? null,
          active_tenant_id: actor?.active_tenant_id ?? null,
          active_workspace_id: actor?.active_workspace_id ?? null,
          person_uuid: actor?.person_uuid ?? null,
        });
        if (!tenantId) tenantId = trimOrNull(provision?.tenantId);
        if (!workspaceId) workspaceId = trimOrNull(provision?.workspaceId);
      } catch {
        /* warn-only */
      }
    }
  }

  const error =
    userId && tenantId && !workspaceId ? 'WORKSPACE_CONTEXT_MISSING' : null;

  return {
    actor,
    authCtx,
    session: authCtx?.sessionRaw ?? null,
    tenantId,
    workspaceId,
    userId,
    personUuid,
    sessionId,
    error,
  };
}

export async function resolveIdentity(env, request) {
  if (!env?.DB) return null;

  const ctx = await resolveIamActorContext(request, env);
  if (!ctx.userId) return null;

  const tenantId = ctx.tenantId;
  if (!tenantId) return null;

  let workspaceIdResolved = ctx.workspaceId;
  let workspaceSlug = null;
  let defaultModelId = null;

  const user = ctx.actor;

  if (workspaceIdResolved) {
    try {
      const row = await env.DB.prepare(
        `SELECT aw.id AS workspace_id, aw.workspace_slug AS handle, aw.default_model_id
         FROM agentsam_workspace aw
         WHERE aw.id = ?
         LIMIT 1`,
      )
        .bind(workspaceIdResolved)
        .first();
      if (row) {
        workspaceSlug = row.handle ?? null;
        defaultModelId = row.default_model_id ?? null;
      }
    } catch (_) {}
  } else {
    const defaultWs = await env.DB.prepare(
      `SELECT tw.workspace_id AS workspace_id, aw.workspace_slug AS handle,
              aw.default_model_id
       FROM tenant_workspaces tw
       JOIN agentsam_workspace aw ON aw.id = tw.workspace_id
       WHERE tw.tenant_id = ?
         AND tw.is_default = 1
         AND tw.is_active = 1
       LIMIT 1`,
    )
      .bind(tenantId)
      .first()
      .catch(() => null);

    const fallbackWs = defaultWs
      ? null
      : await env.DB.prepare(
          `SELECT aw.id AS workspace_id, aw.workspace_slug AS handle,
                  aw.default_model_id
           FROM agentsam_workspace aw
           WHERE aw.status = 'active'
             AND aw.tenant_id = ?
           ORDER BY aw.created_at ASC
           LIMIT 1`,
        )
          .bind(tenantId)
          .first()
          .catch(() => null);

    const ws = defaultWs || fallbackWs || null;
    workspaceIdResolved = ws?.workspace_id ?? null;
    workspaceSlug = ws?.handle ?? null;
    defaultModelId = ws?.default_model_id ?? null;
  }

  return {
    userId: ctx.userId,
    tenantId,
    workspaceId: workspaceIdResolved,
    workspaceSlug,
    defaultModelId,
    email: user?.email ?? null,
    name: user?.name ?? null,
    personUuid: ctx.personUuid,
    sessionId: ctx.sessionId,
    error: ctx.error,
  };
}

export async function resolveSessionIds(env, request) {
  const id = await resolveIdentity(env, request);
  if (!id) return null;
  return {
    userId: id.userId,
    tenantId: id.tenantId,
    workspaceId: id.workspaceId,
  };
}

/** Multi-user runtime actor contract (no seed-id fallbacks). */
export {
  runtimeActorFromIamContext,
  assertRuntimeActor,
  assertRuntimeActorForTool,
  assertActorContext,
  isRuntimeActorComplete,
  ledgerBindingsFromActor,
  isCanonicalAuthUserId,
  isTenantId,
  isWorkspaceId,
} from './runtime-actor.js';
