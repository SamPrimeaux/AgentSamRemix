/**
 * User/workspace-scoped bootstrap attachments — no platform R2 or tenant-wide bucket leakage.
 * Resolves persisted account state from D1 (auth_users, user_settings, agentsam_bootstrap).
 */
import {
  fetchAuthUserTenantId,
} from './auth.js';
import {
  resolveActiveBootstrap,
  resolveEffectiveWorkspaceId,
  resolveTenantIdForWorkspace,
  WORKSPACE_CONTEXT_MISSING,
} from '../../backend/identity/bootstrap.js';
import { fetchUserGithubLogin, fetchWorkspaceGithubRepo } from './github-repo-scope.js';
import { loadUserCloudflareR2Credentials } from './user-storage-r2-credentials.js';
import { listWorkspaceMemberR2Buckets } from './r2-storage-scope.js';
import { listWorkspaceMemberD1Grants } from './workspace-d1-access.js';
import { userCanAccessWorkspace } from './workspace-access.js';
import { fetchAuthUserWorkspacePrefs } from '../../backend/identity/workspace-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonSafe(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/**
 * Bootstrap row must belong to the requesting user (never another user's row).
 * @param {Record<string, unknown>|null|undefined} row
 * @param {string} userId
 */
export function bootstrapRowMatchesUser(row, userId) {
  const uid = trim(userId);
  if (!row || !uid) return false;
  const rowUid = trim(row.user_id);
  if (!rowUid) return false;
  return rowUid === uid;
}

/**
 * Tenant-scoped storage names only (project_storage). Never platform Worker bindings.
 * @param {any} env
 * @param {string} tenantId
 */
export async function loadTenantScopedStorageNames(env, tenantId) {
  const tid = trim(tenantId);
  if (!tid || !env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT storage_name, storage_id, storage_type
         FROM project_storage
        WHERE tenant_id = ? AND COALESCE(status, 'active') = 'active'
        ORDER BY storage_name`,
    )
      .bind(tid)
      .all();
    return (results || []).map((r) => ({
      name: trim(r.storage_name) || trim(r.storage_id),
      storage_id: trim(r.storage_id) || null,
      storage_type: trim(r.storage_type) || 'r2',
    }));
  } catch {
    return [];
  }
}

/**
 * Load D1-persisted workspace preference for this user (survives browser tab close).
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 */
export async function loadPersistedWorkspacePreference(env, authUser) {
  const userId = trim(authUser?.id);
  if (!userId || !env?.DB) {
    return {
      active_workspace_id: null,
      default_workspace_id: null,
      preferred_workspace_id: null,
      preferred_source: null,
    };
  }

  const prefs = await fetchAuthUserWorkspacePrefs(env, userId);

  const activeWorkspaceId = prefs.active_workspace_id;
  const defaultWorkspaceId = prefs.default_workspace_id;

  const candidates = [
    { id: activeWorkspaceId, source: 'auth_users.active_workspace_id' },
    { id: defaultWorkspaceId, source: 'auth_users.default_workspace_id' },
    { id: prefs.canonical_workspace_id, source: 'auth_users.canonical_workspace' },
  ];

  for (const c of candidates) {
    if (!c.id) continue;
    if (await userCanAccessWorkspace(env, authUser, c.id)) {
      return {
        active_workspace_id: activeWorkspaceId,
        default_workspace_id: defaultWorkspaceId,
        preferred_workspace_id: c.id,
        preferred_source: c.source,
      };
    }
  }

  return {
    active_workspace_id: activeWorkspaceId,
    default_workspace_id: defaultWorkspaceId,
    preferred_workspace_id: null,
    preferred_source: null,
  };
}

/**
 * Resolve workspace + tenant for the authenticated user (request-aware when provided).
 * @param {any} env
 * @param {{
 *   authUser: Record<string, unknown>,
 *   request?: Request|null,
 *   cache?: Record<string, unknown>,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 * }} opts
 */
export async function resolvePersistedUserAccount(env, opts) {
  const authUser = opts.authUser || {};
  const userId = trim(authUser.id);

  if (!userId) {
    return {
      user_id: null,
      tenant_id: null,
      workspace_id: null,
      workspace_source: null,
      workspace_error: WORKSPACE_CONTEXT_MISSING,
      persisted: null,
    };
  }

  const persisted = await loadPersistedWorkspacePreference(env, authUser);

  let workspaceId = trim(opts.workspaceId) || '';
  let workspaceSource = workspaceId ? 'caller' : null;
  let workspaceError = null;

  if (!workspaceId && opts.request) {
    const wsRes = await resolveEffectiveWorkspaceId(env, opts.request, authUser, opts.cache || {});
    workspaceId = trim(wsRes.workspaceId);
    workspaceSource = workspaceId ? 'resolve_effective_workspace' : null;
    workspaceError = wsRes.error || null;
  }

  if (!workspaceId && persisted.preferred_workspace_id) {
    workspaceId = persisted.preferred_workspace_id;
    workspaceSource = persisted.preferred_source;
  }

  let tenantId =
    trim(opts.tenantId) ||
    trim(authUser.active_tenant_id) ||
    trim(authUser.tenant_id) ||
    '';

  if (!tenantId) {
    tenantId = trim(await fetchAuthUserTenantId(env, userId)) || '';
  }
  if (!tenantId && workspaceId) {
    tenantId = trim(await resolveTenantIdForWorkspace(env, workspaceId)) || '';
  }

  if (!workspaceId) {
    workspaceError = workspaceError || WORKSPACE_CONTEXT_MISSING;
  }

  return {
    user_id: userId,
    tenant_id: tenantId || null,
    workspace_id: workspaceId || null,
    workspace_source: workspaceSource,
    workspace_error: workspaceError,
    persisted,
  };
}

/**
 * Idempotent minimal agentsam_bootstrap row for user + workspace (stops bootstrap_missing churn).
 * @param {any} env
 * @param {{
 *   authUser: Record<string, unknown>,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 * }} opts
 */
export async function ensureUserBootstrapRow(env, opts) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  if (!env?.DB || !userId || !workspaceId) return null;

  try {
    const { resolveAgentSamBootstrap } = await import('./bootstrap-service-bridge.js');
    const resolved = await resolveAgentSamBootstrap(env, {
      userId,
      requestedWorkspaceId: workspaceId,
      authUser: opts.authUser,
      refresh: true,
    });
    if (!resolved.ok || !resolved.row) return null;
    if (!bootstrapRowMatchesUser(resolved.row, userId)) return null;
    return resolved.row;
  } catch {
    return null;
  }
}

/**
 * Safe runtime slice merged into /api/agentsam/config and agent bootstrap cache.
 * @param {any} env
 * @param {{
 *   authUser: { id?: string, tenant_id?: string, is_superadmin?: number|boolean },
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   bootstrapRow?: Record<string, unknown>|null,
 *   account?: Record<string, unknown>|null,
 * }} opts
 */
export async function buildScopedBootstrapContext(env, opts) {
  const authUser = opts.authUser || {};
  const userId = trim(authUser.id);
  const workspaceId = trim(opts.workspaceId);
  const tenantId =
    trim(opts.tenantId) ||
    trim(authUser.tenant_id) ||
    '';
  const account = opts.account || {};

  const [githubLogin, workspaceRepo, tenantBuckets, r2Creds, workspaceMemberBuckets, workspaceMemberD1] =
    await Promise.all([
    userId ? fetchUserGithubLogin(env, userId) : Promise.resolve(null),
    workspaceId ? fetchWorkspaceGithubRepo(env, tenantId, workspaceId) : Promise.resolve(null),
    tenantId ? loadTenantScopedStorageNames(env, tenantId) : Promise.resolve([]),
    userId ? loadUserCloudflareR2Credentials(env, userId) : Promise.resolve(null),
    userId ? listWorkspaceMemberR2Buckets(env, authUser) : Promise.resolve([]),
    userId ? listWorkspaceMemberD1Grants(env, authUser) : Promise.resolve([]),
  ]);

  const capabilities = parseJsonSafe(opts.bootstrapRow?.capabilities_json, {});
  const persisted = account.persisted || null;

  return {
    isolation: {
      mode: 'user_workspace',
      user_id: userId || null,
      tenant_id: tenantId || null,
      workspace_id: workspaceId || null,
    },
    account: {
      user_id: userId || null,
      tenant_id: tenantId || null,
      workspace_id: workspaceId || null,
      workspace_source: account.workspace_source || null,
      active_workspace_id: persisted?.active_workspace_id ?? null,
      default_workspace_id: persisted?.default_workspace_id ?? null,
      bootstrap_present: !!opts.bootstrapRow,
    },
    github: {
      login: githubLogin,
      workspace_repo: workspaceRepo,
      owner_namespace: githubLogin || null,
    },
    storage: {
      tenant_buckets: tenantBuckets,
      workspace_member_buckets: workspaceMemberBuckets,
      workspace_member_d1: workspaceMemberD1,
      r2_byok_connected: !!(r2Creds?.accessKeyId && r2Creds?.secretAccessKey),
      platform_r2_visible: false,
      media_upload_bucket: null,
    },
    capabilities,
  };
}

/**
 * API payload: bootstrap row (user-matched only) + scoped_context.
 * Resolves workspace/tenant/bootstrap from D1 when request + authUser are provided.
 * @param {any} env
 * @param {{
 *   authUser: { id?: string, tenant_id?: string, is_superadmin?: number|boolean },
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   bootstrapRow?: Record<string, unknown>|null,
 *   request?: Request|null,
 *   cache?: Record<string, unknown>,
 *   ensureBootstrap?: boolean,
 * }} opts
 */
export async function buildBootstrapApiPayload(env, opts) {
  const authUser = opts.authUser || {};
  const userId = trim(authUser.id);

  const account = await resolvePersistedUserAccount(env, {
    authUser,
    request: opts.request ?? null,
    cache: opts.cache,
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId,
  });

  const workspaceId = trim(opts.workspaceId) || account.workspace_id || '';
  const tenantId = trim(opts.tenantId) || account.tenant_id || trim(authUser.tenant_id) || '';

  let row =
    opts.bootstrapRow !== undefined
      ? opts.bootstrapRow
      : workspaceId && userId
        ? await resolveActiveBootstrap(env, {
            userId,
            personUuid: authUser.person_uuid ?? null,
            tenantId: tenantId || null,
            workspaceId,
          })
        : null;

  let matched = bootstrapRowMatchesUser(row, userId) ? row : null;

  if (!matched && workspaceId && userId && opts.ensureBootstrap !== false) {
    matched = await ensureUserBootstrapRow(env, {
      authUser,
      userId,
      workspaceId,
      tenantId,
    });
  }

  const scoped_context = await buildScopedBootstrapContext(env, {
    authUser,
    workspaceId,
    tenantId,
    bootstrapRow: matched,
    account,
  });

  const base = {
    workspace_id: workspaceId || null,
    user_id: userId || null,
    tenant_id: tenantId || null,
    scoped_context,
    account: scoped_context.account,
    workspace_source: account.workspace_source,
    workspace_error: account.workspace_error,
  };

  if (!matched) {
    return {
      ...base,
      bootstrap_missing: true,
    };
  }

  return {
    ...matched,
    ...base,
    bootstrap_missing: false,
  };
}
