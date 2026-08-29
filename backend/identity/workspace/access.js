/**
 * Workspace visibility and access — membership-scoped for identity resolution.
 *
 * This is the backend-owned access contract. It intentionally performs no
 * product work and never grants access from tenant identity alone.
 */
import {
  fetchAuthUserTenantId,
  platformTenantIdFromEnv,
} from '../users/tenant.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function isWorkspaceBlocklisted(env, workspaceId, userId) {
  if (!env?.DB || !workspaceId || !userId) return false;
  try {
    const row = await env.DB.prepare(
      'SELECT owner_user_id FROM agentsam_workspace_blocklist WHERE workspace_id = ? LIMIT 1',
    ).bind(String(workspaceId).trim()).first();
    return row ? trim(row.owner_user_id) !== trim(userId) : false;
  } catch {
    return false;
  }
}

export async function workspaceMemberUserCandidates(env, authUser) {
  const uid = trim(authUser?.id);
  const email = trim(authUser?.email);
  const ids = new Set();
  if (uid) ids.add(uid);
  if (!env?.DB) return [...ids];
  try {
    const row = await env.DB.prepare(
      `SELECT u.id AS app_user_id
       FROM auth_users au
       LEFT JOIN users u ON u.auth_id = au.id OR LOWER(COALESCE(u.email, '')) = LOWER(au.email)
       WHERE au.id = ? OR LOWER(COALESCE(au.email, '')) = LOWER(?)
       LIMIT 1`,
    ).bind(uid, email || uid).first();
    if (trim(row?.app_user_id)) ids.add(trim(row.app_user_id));
  } catch {}
  return [...ids];
}

async function workspaceRowExists(env, workspaceId) {
  if (!env?.DB || !workspaceId) return false;
  try {
    const primary = await env.DB.prepare(
      'SELECT id FROM agentsam_workspace WHERE id = ? LIMIT 1',
    ).bind(workspaceId).first();
    if (primary?.id) return true;
    const fallback = await env.DB.prepare(
      'SELECT 1 AS ok FROM workspaces WHERE id = ? LIMIT 1',
    ).bind(workspaceId).first();
    return Boolean(fallback);
  } catch {
    return false;
  }
}

const AGENTSAM_WORKSPACE_SELECT = `
  SELECT id, workspace_slug, tenant_id, project_id, name, display_name, description,
         root_path, r2_bucket, r2_prefix, status, metadata_json,
         github_repo, default_model_id, primary_subagent_id,
         d1_database_id, d1_binding, worker_name, workspace_ref_id,
         cloudflare_account_id, cloudflare_images_account_hash, byok_r2_bucket, deploy_url, kv_namespace_id,
         created_at, updated_at
    FROM agentsam_workspace`;

/** Canonical backend read of the workspace registry row. */
export async function readAgentsamWorkspace(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  return env.DB.prepare(`${AGENTSAM_WORKSPACE_SELECT} WHERE id = ? LIMIT 1`)
    .bind(wid)
    .first()
    .catch(() => null);
}

export async function resolveWorkspaceOwnerUserId(env, workspaceId) {
  if (!env?.DB || !workspaceId) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT user_id FROM workspaces WHERE id = ? LIMIT 1',
    ).bind(workspaceId).first();
    return trim(row?.user_id) || null;
  } catch {
    return null;
  }
}

async function workspaceTenantId(env, workspaceId) {
  if (!env?.DB || !workspaceId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(
         (SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1),
         (SELECT COALESCE(tenant_id, owner_tenant_id, default_tenant_id)
            FROM workspaces WHERE id = ? LIMIT 1)
       ) AS tenant_id`,
    ).bind(workspaceId, workspaceId).first();
    return trim(row?.tenant_id) || null;
  } catch {
    return null;
  }
}

async function resolveWorkspaceAccessContext(env, authUser) {
  const candidates = await workspaceMemberUserCandidates(env, authUser);
  let tenantId = trim(authUser?.tenant_id) || null;
  if (!tenantId && authUser?.id) tenantId = await fetchAuthUserTenantId(env, authUser.id);
  if (!tenantId && authUser?.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
  const platformTenantId = platformTenantIdFromEnv(env);
  return {
    candidates,
    tenantId,
    seeNullTenantUnowned: platformTenantId && tenantId === platformTenantId ? 1 : 0,
  };
}

function workspaceTenantMatchesUser(workspaceTenant, userTenant) {
  const wt = trim(workspaceTenant);
  const ut = trim(userTenant);
  if (!ut) return false;
  return !wt || wt === ut;
}

export async function userCanAccessWorkspace(env, authUser, workspaceId) {
  const uid = trim(authUser?.id);
  const wid = trim(workspaceId);
  if (!env?.DB || !uid || !wid) return false;
  if (await isWorkspaceBlocklisted(env, wid, uid)) return false;
  if (!(await workspaceRowExists(env, wid))) return false;

  const { candidates, tenantId } = await resolveWorkspaceAccessContext(env, authUser);
  if (!candidates.length) return false;
  try {
    const placeholders = candidates.map(() => '?').join(', ');
    const member = await env.DB.prepare(
      `SELECT 1 AS ok FROM workspace_members
       WHERE workspace_id = ? AND user_id IN (${placeholders})
         AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    ).bind(wid, ...candidates).first();
    if (member) return true;

    const workspaceTenant = await workspaceTenantId(env, wid);
    if (!workspaceTenantMatchesUser(workspaceTenant, tenantId)) return false;
    const owner = await resolveWorkspaceOwnerUserId(env, wid);
    return Boolean(owner && candidates.includes(owner));
  } catch {
    return false;
  }
}

export async function authorizeWorkspaceAccess(env, userId, workspaceId) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!uid || !wid) return null;
  return (await userCanAccessWorkspace(env, { id: uid }, wid)) ? wid : null;
}

export async function authorizeFirstWorkspace(env, userId, candidates) {
  for (const candidate of candidates || []) {
    const authorized = await authorizeWorkspaceAccess(env, userId, candidate);
    if (authorized) return authorized;
  }
  return null;
}

export { resolveWorkspaceAccessContext };

function inClausePlaceholders(candidates) {
  return candidates.length > 0 ? candidates.map(() => '?').join(', ') : "''";
}

export function repoAlignedWorkspaceName(row) {
  if (!row) return '';
  const githubRepo = trim(row.github_repo);
  if (githubRepo) {
    const repo = trim(githubRepo.split('/').at(-1));
    if (repo) return repo;
  }
  const worker = trim(row.worker_name);
  if (worker) return worker;
  const slug = trim(row.slug) || trim(row.handle) || trim(row.workspace_slug);
  if (slug) return slug;
  const id = trim(row.id);
  if (id) return id.replace(/^ws_/, '') || id;
  return trim(row.display_name) || trim(row.name) || 'workspace';
}

/** Canonical membership-scoped workspace listing for HTTP/API composition. */
export async function listAccessibleWorkspaces(db, env, authUser, opts = {}) {
  const { candidates, tenantId, seeNullTenantUnowned } = await resolveWorkspaceAccessContext(env, authUser);
  const orderBy = opts.orderBy || 'aw.updated_at DESC';
  const limit = opts.limit != null && Number(opts.limit) > 0 ? Math.min(Number(opts.limit), 500) : null;
  const limitSql = limit ? ` LIMIT ${limit}` : '';
  if (!candidates.length && !seeNullTenantUnowned) return [];

  const placeholders = inClausePlaceholders(candidates);
  const tid = trim(tenantId);
  const tenantClause = tid
    ? ` AND (
        aw.tenant_id IS NULL
        OR aw.tenant_id = ?
        OR EXISTS (
          SELECT 1 FROM workspace_members wm_collab
          WHERE wm_collab.workspace_id = aw.id
            AND wm_collab.user_id IN (${placeholders})
            AND COALESCE(wm_collab.is_active, 1) = 1
        )
      )`
    : ` AND (
        aw.tenant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM workspace_members wm_collab
          WHERE wm_collab.workspace_id = aw.id
            AND wm_collab.user_id IN (${placeholders})
            AND COALESCE(wm_collab.is_active, 1) = 1
        )
      )`;
  const sql = `
    SELECT DISTINCT aw.id, aw.display_name, aw.workspace_slug AS slug,
      aw.worker_name, aw.d1_database_id, aw.d1_binding, aw.metadata_json,
      COALESCE(w.workspace_type, w.category) AS workspace_type,
      aw.status, aw.r2_prefix,
      COALESCE(NULLIF(TRIM(w.github_repo), ''), aw.github_repo) AS github_repo,
      aw.root_path,
      w.pty_path,
      w.settings_json,
      aw.description, aw.tenant_id, w.user_id, aw.created_at, aw.updated_at,
      aw.name, aw.workspace_slug AS handle, w.category, w.brand,
      COALESCE(wm.role, 'owner') AS member_role
    FROM agentsam_workspace aw
    LEFT JOIN workspaces w ON w.id = aw.id
    LEFT JOIN workspace_members wm
      ON wm.workspace_id = aw.id AND wm.user_id IN (${placeholders})
    LEFT JOIN agentsam_workspace_blocklist bl
      ON bl.workspace_id = aw.id
    WHERE (
        EXISTS (
          SELECT 1 FROM workspace_members wm2
          WHERE wm2.workspace_id = aw.id
            AND wm2.user_id IN (${placeholders})
            AND COALESCE(wm2.is_active, 1) = 1
        )
        OR w.user_id IN (${placeholders})
      )
      ${tenantClause}
      AND aw.status != 'archived'
      AND (bl.workspace_id IS NULL OR bl.owner_user_id IN (${placeholders}))
    ORDER BY ${orderBy}${limitSql}`;
  const binds = [...candidates, ...candidates, ...candidates, ...candidates];
  if (tid) binds.push(tid);
  binds.push(...candidates);
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

function firstWorkspaceDatabaseName(row) {
  let metadata = {};
  try {
    metadata = row?.metadata_json && typeof row.metadata_json === 'object'
      ? row.metadata_json
      : JSON.parse(String(row?.metadata_json || '{}'));
  } catch {
    metadata = {};
  }
  const entries = Array.isArray(metadata?.d1_databases) ? metadata.d1_databases : [];
  for (const entry of entries) {
    const databaseId = trim(entry?.database_id);
    if (!databaseId) continue;
    return trim(entry?.database_name) || trim(row?.workspace_slug) || trim(row?.slug) || trim(entry?.binding) || databaseId;
  }
  const fallbackId = trim(row?.d1_database_id);
  if (!fallbackId) return null;
  return trim(row?.workspace_slug) || trim(row?.slug) || trim(row?.d1_binding) || fallbackId;
}

/** Settings API projection over the canonical workspace listing. */
export async function fetchWorkspaceRowsForSettingsApi(db, env, authUser) {
  const rows = await listAccessibleWorkspaces(db, env, authUser, {
    orderBy: 'COALESCE(aw.display_name, aw.name, aw.id) ASC',
  });
  return rows.map((workspace) => {
    const aligned = repoAlignedWorkspaceName(workspace);
    return {
      id: workspace.id,
      name: aligned,
      display_name: aligned,
      slug: workspace.slug ?? workspace.handle ?? null,
      github_repo: workspace.github_repo ?? null,
      root_path: workspace.root_path ?? null,
      pty_path: workspace.pty_path ?? null,
      status: workspace.status ?? null,
      category: workspace.category ?? workspace.workspace_type ?? null,
      brand: workspace.brand ?? null,
      database_studio_name: firstWorkspaceDatabaseName(workspace),
      worker_name: workspace.worker_name ?? null,
    };
  });
}
