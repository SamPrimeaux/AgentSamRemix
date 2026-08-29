/**
 * P0 data isolation — resolve per-user workspace + D1 binding for dashboard APIs.
 */
import { resolveCanonicalUserId } from '../../../identity/users/index.js';
import { fetchAuthUserTenantId } from '../../../../src/core/auth.js';
import { resolveEffectiveWorkspaceId } from '../../../identity/bootstrap.js';
import {
  listAccessibleD1Databases,
  resolveD1GrantByDatabaseName,
  resolveWorkspaceD1Catalog,
  resolveWorkspaceMemberD1Grant,
} from '../../../../src/core/workspace-d1-access.js';
import { getAgentsamWorkspace } from '../../../identity/workspace/agentsam-workspace.js';
import { createRemoteD1Adapter } from '../../../../src/core/remote-d1-adapter.js';

function trimHeader(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Canonical user + workspace + tenant for scoped D1 reads/writes.
 * @param {unknown} env
 * @param {unknown} authUser
 * @param {unknown} request
 * @param {{ workspaceId?: string, tenantId?: string } | null | undefined} identity
 */
export async function resolveAgentDataScope(env, authUser, request, identity = {}) {
  const rawId = String(authUser?.id || '').trim();
  const userId = rawId ? await resolveCanonicalUserId(rawId, env) : '';
  if (rawId && !userId) {
    return {
      userId: null,
      workspaceId: null,
      tenantId: null,
      error: 'auth_user_id_required',
    };
  }
  const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, identity || {});
  const workspaceId =
    String(identity?.workspaceId || wsRes?.workspaceId || authUser?.active_workspace_id || '')
      .trim() || null;
  let tenantId = String(identity?.tenantId || authUser?.tenant_id || '').trim() || null;
  if (!tenantId && userId) tenantId = await fetchAuthUserTenantId(env, userId).catch(() => null);
  return {
    userId: userId || null,
    workspaceId,
    tenantId,
  };
}

/**
 * D1 binding for Database Studio.
 * - Workspace members on collab D1 (e.g. fuel) → remote HTTP adapter (never env.DB).
 * - No env.DB fallback for human users — grants + remote adapter only.
 * @param {unknown} env
 * @param {string} userId
 * @param {unknown} authUser
 * @param {unknown} [request]
 * @returns {Promise<import('@cloudflare/workers-types').D1Database | null>}
 */
export async function resolveUserWorkspaceBinding(env, userId, authUser, request = null) {
  void userId;
  let workspaceId = '';
  let databaseName = '';

  if (request) {
    databaseName = trimHeader(request?.headers?.get?.('x-iam-database-name'));
    const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    workspaceId = String(wsRes?.workspaceId || '').trim();
  }

  if (workspaceId) {
    const row = await getAgentsamWorkspace(env, workspaceId);
    const catalog = resolveWorkspaceD1Catalog(row);
    if (catalog.length > 0) {
      const catalogNames = catalog.map((e) => e.database_name.toLowerCase());
      const dbLower = databaseName.toLowerCase();
      if (databaseName && catalogNames.includes(dbLower)) {
        const grant = await resolveD1GrantByDatabaseName(env, authUser, databaseName);
        if (grant && grant.workspace_id === workspaceId) {
          return createRemoteD1Adapter(grant);
        }
      }
      const grant = await resolveWorkspaceMemberD1Grant(env, authUser, workspaceId);
      if (grant) return createRemoteD1Adapter(grant);
      return null;
    }
  }

  // SECURITY: no unanchored database-name fallback. A D1 grant must always be
  // anchored to a server-resolved active workspaceId (resolveEffectiveWorkspaceId).
  // Previously, when workspaceId failed to resolve, this function fell back to
  // matching the client-supplied x-iam-database-name header against ANY workspace
  // the user has membership in -- selecting a database without ever confirming it
  // was the user's actual active workspace. Membership (userCanAccessWorkspace) was
  // still checked, so this was not an open cross-tenant read, but it was a real
  // "wrong workspace selected without an explicit switch" hole. Fixed 2026-06-30:
  // no anchored workspaceId == no D1 grant, full stop.

  if (workspaceId) {
    const grant = await resolveWorkspaceMemberD1Grant(env, authUser, workspaceId);
    if (grant) return createRemoteD1Adapter(grant);
    return null;
  }

  return null;
}

/**
 * Database Studio context — accessible catalogs + active database from headers.
 * @param {unknown} env
 * @param {unknown} authUser
 * @param {unknown} [request]
 */
export async function resolveD1DashboardContext(env, authUser, request = null) {
  const databases = await listAccessibleD1Databases(env, authUser);
  let activeDatabaseName = request ? trimHeader(request?.headers?.get?.('x-iam-database-name')) : '';
  let workspaceId = '';

  if (request) {
    const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    workspaceId = trimHeader(wsRes?.workspaceId);
  }

  if (workspaceId) {
    const row = await getAgentsamWorkspace(env, workspaceId);
    const catalog = resolveWorkspaceD1Catalog(row);
    if (catalog.length > 0) {
      const catalogNames = catalog.map((e) => e.database_name.toLowerCase());
      const headerLower = activeDatabaseName.toLowerCase();
      if (activeDatabaseName && catalogNames.includes(headerLower)) {
        activeDatabaseName = catalog.find((e) => e.database_name.toLowerCase() === headerLower)?.database_name
          || catalog[0].database_name;
      } else {
        activeDatabaseName = catalog[0].database_name;
      }
    } else {
      const match = databases.find((d) => d.workspace_id === workspaceId);
      if (match) activeDatabaseName = match.database_name;
    }
  } else if (!activeDatabaseName && request) {
    const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    const ws = trimHeader(wsRes?.workspaceId);
    if (ws) {
      const match = databases.find((d) => d.workspace_id === ws);
      if (match) activeDatabaseName = match.database_name;
    }
  }

  return {
    databases,
    active_database_name: activeDatabaseName || null,
    platform_available: false,
  };
}

/**
 * SQL AND clause + binds for agentsam_workflow_runs / agentsam_command_run style tables.
 * @param {{ userId?: string | null, workspaceId?: string | null, tenantId?: string | null }} scope
 * @param {{ alias?: string, requireUser?: boolean, requireWorkspace?: boolean }} opts
 */
export function scopeSqlFragment(scope, opts = {}) {
  const alias = opts.alias ? `${opts.alias}.` : '';
  const parts = [];
  const binds = [];
  if (scope.tenantId) {
    parts.push(`${alias}tenant_id = ?`);
    binds.push(scope.tenantId);
  }
  if (scope.workspaceId || opts.requireWorkspace) {
    parts.push(`${alias}workspace_id = ?`);
    binds.push(scope.workspaceId || '');
  }
  if (scope.userId || opts.requireUser) {
    parts.push(`${alias}user_id = ?`);
    binds.push(scope.userId || '');
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', binds };
}
