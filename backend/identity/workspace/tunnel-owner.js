/**
 * iam-tunnel owner config — D1 terminal_connections only (conn_gcp_iam_tunnel).
 * Never hardcode au_*, Unix owner names, or /home/<owner>/… paths in runtime.
 */

export const IAM_TUNNEL_CONNECTION_ID = 'conn_gcp_iam_tunnel';

const CACHE_TTL_MS = 60_000;

/** @type {{ at: number, cfg: IamTunnelOwnerConfig|null }} */
let cache = { at: 0, cfg: null };

/**
 * @typedef {{
 *   authUserId: string,
 *   unixUser: string,
 *   daemonUnixUser: string,
 *   repoPath: string,
 *   execosPath: string,
 *   reposRoot: string,
 *   defaultWorkspaceId: string|null,
 *   githubOwners: Set<string>,
 * }} IamTunnelOwnerConfig
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseMetadataJson(raw) {
  const s = trim(raw);
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * @param {any} env
 * @param {string} authUserId
 * @returns {Promise<Set<string>>}
 */
export async function loadGithubOwnersForAuthUser(env, authUserId) {
  const uid = trim(authUserId);
  const out = new Set();
  if (!uid || !env?.DB) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT lower(account_identifier) AS login
         FROM user_oauth_tokens
        WHERE user_id = ?
          AND lower(provider) IN ('github', 'github_app')
          AND COALESCE(is_active, 1) = 1`,
    )
      .bind(uid)
      .all();
    for (const row of results || []) {
      const login = trim(row?.login).toLowerCase();
      if (login) out.add(login);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * @param {any} env
 * @returns {Promise<IamTunnelOwnerConfig|null>}
 */
export async function loadIamTunnelOwnerConfig(env) {
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS && cache.cfg) return cache.cfg;

  if (!env?.DB) {
    cache = { at: now, cfg: null };
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, username, remote_exec_user, workspace_id, metadata_json
         FROM terminal_connections
        WHERE id = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(IAM_TUNNEL_CONNECTION_ID)
      .first();

    const authUserId = trim(row?.user_id);
    const unixUser = trim(row?.remote_exec_user) || trim(row?.username);
    const meta = parseMetadataJson(row?.metadata_json);
    const daemonUnixUser = trim(meta.tunnel_daemon_unix_user) || 'agentsam';
    const repoPath = trim(meta.tunnel_repo_path);
    const execosPath = trim(meta.tunnel_execos_path);
    const reposRoot = trim(meta.tunnel_repos_root);

    if (!authUserId || !unixUser || !repoPath || !execosPath) {
      cache = { at: now, cfg: null };
      return null;
    }

    const githubOwners = await loadGithubOwnersForAuthUser(env, authUserId);

    /** @type {IamTunnelOwnerConfig} */
    const cfg = {
      authUserId,
      unixUser,
      daemonUnixUser,
      repoPath,
      execosPath,
      reposRoot: reposRoot || `/home/${unixUser}/repos`,
      defaultWorkspaceId: trim(row?.workspace_id) || null,
      githubOwners,
    };
    cache = { at: now, cfg };
    return cfg;
  } catch (e) {
    console.warn('[iam-tunnel-owner-config] load failed:', e?.message ?? e);
    cache = { at: now, cfg: null };
    return null;
  }
}

/** Test / post-migrate helper — clears in-memory cache. */
export function clearIamTunnelOwnerConfigCache() {
  cache = { at: 0, cfg: null };
}

/**
 * @param {any} env
 * @param {string|null|undefined} userId
 */
export async function userIdIsIamTunnelOwnerFromConfig(env, userId) {
  const uid = trim(userId);
  if (!uid) return false;
  const cfg = await loadIamTunnelOwnerConfig(env);
  if (!cfg?.authUserId) return false;
  if (cfg.authUserId === uid) return true;
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM auth_users a
         JOIN auth_users b ON a.person_uuid = b.person_uuid
        WHERE a.id = ?
          AND b.id = ?
          AND a.person_uuid IS NOT NULL
          AND trim(a.person_uuid) != ''
        LIMIT 1`,
    )
      .bind(uid, cfg.authUserId)
      .first();
    return Number(row?.ok) === 1;
  } catch {
    return false;
  }
}

/**
 * @param {any} env
 * @returns {Promise<string|null>}
 */
export async function resolveIamTunnelOwnerUnixUser(env) {
  const cfg = await loadIamTunnelOwnerConfig(env);
  return cfg?.unixUser || null;
}

/** @param {any} env */
export async function resolveIamGcpPlatformRepo(env) {
  const cfg = await loadIamTunnelOwnerConfig(env);
  return cfg?.repoPath || null;
}

/** @param {any} env */
export async function resolveIamGcpExecosHome(env) {
  const cfg = await loadIamTunnelOwnerConfig(env);
  return cfg?.execosPath || null;
}

/** @param {any} env */
export async function resolveIamTunnelDaemonUnixUser(env) {
  const cfg = await loadIamTunnelOwnerConfig(env);
  return cfg?.daemonUnixUser || null;
}

/** @param {any} env */
export async function resolveIamGcpReposRoot(env) {
  const cfg = await loadIamTunnelOwnerConfig(env);
  return cfg?.reposRoot || null;
}
