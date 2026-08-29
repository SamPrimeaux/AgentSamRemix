/**
 * agentsam_workspace — SSOT for workspace identity and runtime bindings.
 * UI-only columns (settings_json, state_json, theme_id, user_id) remain on `workspaces` compat.
 */

function trim(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/** @param {unknown} raw */
export function parseWorkspaceMetadata(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? o : {};
  } catch {
    return {};
  }
}

/**
 * Column-first BYOK / deploy fields (metadata_json fallback).
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveWorkspaceCloudflareAccountId(row) {
  if (!row) return null;
  const fromCol = trim(row.cloudflare_account_id);
  if (fromCol) return fromCol;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  return trim(meta.cloudflare_account_id) || trim(meta.cf_account_id) || trim(meta.account_id) || null;
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveWorkspaceByokR2Bucket(row) {
  if (!row) return null;
  const fromCol = trim(row.byok_r2_bucket);
  if (fromCol) return fromCol;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  const fromMeta = trim(meta.byok_r2_bucket) || trim(meta.r2_bucket_override) || null;
  if (fromMeta) return fromMeta;
  return resolveWorkspaceR2Bucket(row);
}

/**
 * Shared workspace R2 bucket (collab lane) — not a platform Worker binding.
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveWorkspaceR2Bucket(row) {
  if (!row) return null;
  const fromCol = trim(row.r2_bucket);
  if (fromCol) return fromCol;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  return trim(meta.r2_bucket) || null;
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveWorkspaceDeployUrl(row) {
  if (!row) return null;
  const fromCol = trim(row.deploy_url);
  if (fromCol) return fromCol;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  return trim(meta.deploy_url) || trim(meta.live_url) || null;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceCloudflareAccountId(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  return resolveWorkspaceCloudflareAccountId(row);
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceByokR2Bucket(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  return resolveWorkspaceByokR2Bucket(row);
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceR2Bucket(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  return resolveWorkspaceR2Bucket(row);
}

/**
 * Keep projects.workspace_id aligned with agentsam_workspace.project_id (SSOT).
 * Prevents silent drift where UI/list filters use projects.workspace_id while
 * execution paths prefer agentsam bindings.
 * @param {any} env
 * @param {string} projectId
 * @param {string|null|undefined} executionWorkspaceId
 * @param {string|null|undefined} currentProjectWorkspaceId
 */
export async function healProjectWorkspaceId(env, projectId, executionWorkspaceId, currentProjectWorkspaceId) {
  const pid = trim(projectId);
  const execWs = trim(executionWorkspaceId);
  const cur = trim(currentProjectWorkspaceId);
  if (!env?.DB || !pid || !execWs || execWs === cur) return { healed: false };
  try {
    await env.DB.prepare(
      `UPDATE projects
          SET workspace_id = ?, updated_at = datetime('now')
        WHERE id = ?
          AND COALESCE(workspace_id, '') != ?`,
    )
      .bind(execWs, pid, execWs)
      .run();
    return { healed: true, workspace_id: execWs };
  } catch (e) {
    console.warn('[agentsam-workspace] healProjectWorkspaceId', e?.message ?? e);
    return { healed: false, error: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceDeployUrl(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  return resolveWorkspaceDeployUrl(row);
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
const AGENTSAM_WORKSPACE_SELECT = `
  SELECT id, workspace_slug, tenant_id, project_id, name, display_name, description,
         root_path, r2_bucket, r2_prefix, status, metadata_json,
         github_repo, default_model_id, primary_subagent_id,
         d1_database_id, d1_binding, worker_name, workspace_ref_id,
         cloudflare_account_id, cloudflare_images_account_hash, byok_r2_bucket, deploy_url, kv_namespace_id,
         created_at, updated_at
    FROM agentsam_workspace`;

/**
 * Normalize agentsam_workspace row → CF execution targets for Agent Sam.
 * @param {Record<string, unknown>|null|undefined} row
 * @param {any} [env]
 */
export function normalizeWorkspaceBindings(row, env = null) {
  if (!row) return null;
  // Idempotent: resolveWorkspaceBindings already returns a normalized object (workspaceId, not id).
  return {
    workspaceId: trim(row.id) || trim(row.workspaceId) || null,
    slug: trim(row.workspace_slug) || trim(row.slug) || null,
    name: trim(row.display_name) || trim(row.name) || null,
    projectId: trim(row.project_id) || trim(row.projectId) || null,
    accountId:
      trim(row.cloudflare_account_id) ||
      trim(row.accountId) ||
      trim(env?.CLOUDFLARE_ACCOUNT_ID) ||
      null,
    d1DatabaseId: trim(row.d1_database_id) || trim(row.d1DatabaseId) || null,
    d1Binding: trim(row.d1_binding) || trim(row.d1Binding) || 'DB',
    workerName: trim(row.worker_name) || trim(row.workerName) || null,
    r2Bucket: trim(row.r2_bucket) || trim(row.r2Bucket) || null,
    r2Prefix: trim(row.r2_prefix) || trim(row.r2Prefix) || null,
    kvNamespaceId: trim(row.kv_namespace_id) || trim(row.kvNamespaceId) || null,
    githubRepo: trim(row.github_repo) || trim(row.githubRepo) || null,
    rootPath: trim(row.root_path) || trim(row.rootPath) || null,
    deployUrl: trim(row.deploy_url) || trim(row.deployUrl) || null,
  };
}

/**
 * Resolve full CF bindings by workspace id, slug, or project_id.
 * @param {any} env
 * @param {string|null|undefined} identifier
 */
export async function resolveWorkspaceBindings(env, identifier) {
  const id = trim(identifier);
  if (!env?.DB || !id) return null;
  const row = await env.DB.prepare(
    `${AGENTSAM_WORKSPACE_SELECT}
      WHERE status = 'active'
        AND (id = ? OR workspace_slug = ? OR project_id = ?)
      ORDER BY updated_at DESC
      LIMIT 1`,
  )
    .bind(id, id, id)
    .first()
    .catch(() => null);
  return normalizeWorkspaceBindings(row, env);
}

export async function getAgentsamWorkspace(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  return env.DB.prepare(`${AGENTSAM_WORKSPACE_SELECT} WHERE id = ? LIMIT 1`)
    .bind(wid)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function agentsamWorkspaceExists(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  return !!row;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceTenantId(env, workspaceId) {
  const row = await getAgentsamWorkspace(env, workspaceId);
  const tid = row?.tenant_id;
  return tid != null && trim(tid) ? trim(tid) : null;
}

/**
 * Owner user_id — compat read from workspaces until migrated to workspace_members-only.
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceOwnerUserId(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  const row = await env.DB.prepare(`SELECT user_id FROM workspaces WHERE id = ? LIMIT 1`)
    .bind(wid)
    .first()
    .catch(() => null);
  const uid = row?.user_id;
  return uid != null && trim(uid) ? trim(uid) : null;
}

/**
 * Tenant id — SSOT agentsam_workspace, compat fallback workspaces.
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceTenantIdWithFallback(env, workspaceId) {
  const fromAw = await getWorkspaceTenantId(env, workspaceId);
  if (fromAw) return fromAw;
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  const row = await env.DB.prepare(
    `SELECT COALESCE(tenant_id, owner_tenant_id, default_tenant_id) AS tid
       FROM workspaces WHERE id = ? LIMIT 1`,
  )
    .bind(wid)
    .first()
    .catch(() => null);
  const tid = row?.tid;
  return tid != null && trim(tid) ? trim(tid) : null;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function workspaceRowExists(env, workspaceId) {
  if (await agentsamWorkspaceExists(env, workspaceId)) return true;
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return false;
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM workspaces WHERE id = ? LIMIT 1`)
    .bind(wid)
    .first()
    .catch(() => null);
  return !!row;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function getWorkspaceGithubRepo(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  const row = await env.DB.prepare(
    `SELECT aw.github_repo AS aw_gh, w.github_repo AS w_gh
       FROM agentsam_workspace aw
       LEFT JOIN workspaces w ON w.id = aw.id
      WHERE aw.id = ?
      LIMIT 1`,
  )
    .bind(wid)
    .first()
    .catch(() => null);
  if (!row) {
    const wsOnly = await env.DB.prepare(`SELECT github_repo FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(wid)
      .first()
      .catch(() => null);
    const gh = trim(wsOnly?.github_repo);
    return gh || null;
  }
  const wsGh = trim(row.w_gh);
  const awGh = trim(row.aw_gh);
  return wsGh || awGh || null;
}

/** Operational binding fields — write agentsam_workspace only (not workspaces compat table). */
export const AGENTSAM_WORKSPACE_BINDING_PATCH_KEYS = new Set([
  'r2_prefix',
  'github_repo',
  'default_model_id',
]);

/**
 * Sync operational patch fields to agentsam_workspace (best-effort).
 * @param {any} env
 * @param {string} workspaceId
 * @param {Record<string, unknown>} col
 */
export async function patchAgentsamWorkspaceFromApiCol(env, workspaceId, col) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid || !col || typeof col !== 'object') return;
  const sets = [];
  const binds = [];
  const map = {
    display_name: 'display_name',
    name: 'name',
    slug: 'workspace_slug',
    handle: 'workspace_slug',
    r2_prefix: 'r2_prefix',
    github_repo: 'github_repo',
    description: 'description',
    default_model_id: 'default_model_id',
    status: 'status',
    worker_name: 'worker_name',
  };
  for (const [src, dst] of Object.entries(map)) {
    if (col[src] !== undefined) {
      sets.push(`${dst} = ?`);
      binds.push(col[src]);
    }
  }
  if (!sets.length) return;
  sets.push('updated_at = unixepoch()');
  binds.push(wid);
  await env.DB.prepare(`UPDATE agentsam_workspace SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run()
    .catch(() => {});
}

/**
 * Insert SSOT row when provisioning a new workspace (idempotent).
 * @param {any} env
 * @param {{ id: string, workspaceSlug: string, tenantId?: string|null, name: string, displayName?: string|null, githubRepo?: string|null, r2Prefix?: string|null, description?: string|null }} opts
 */
export async function insertAgentsamWorkspaceRow(env, opts) {
  const id = trim(opts?.id);
  if (!env?.DB || !id) return;
  const slug = trim(opts.workspaceSlug) || id.replace(/^ws_/, '');
  const name = trim(opts.name) || id;
  const displayName = trim(opts.displayName) || name;
  const tenantId = trim(opts.tenantId) || null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agentsam_workspace
       (id, workspace_slug, tenant_id, name, display_name, status,
        r2_prefix, github_repo, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, unixepoch(), unixepoch())`,
  )
    .bind(
      id,
      slug,
      tenantId,
      name,
      displayName,
      opts.r2Prefix != null && trim(opts.r2Prefix) ? trim(opts.r2Prefix) : null,
      opts.githubRepo != null && trim(opts.githubRepo) ? trim(opts.githubRepo) : null,
      opts.description != null && trim(opts.description) ? trim(opts.description) : null,
    )
    .run()
    .catch(() => {});
}
