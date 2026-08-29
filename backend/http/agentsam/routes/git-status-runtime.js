/**
 * Status bar runtime contracts — live GitHub / PTY / tunnel probes (no deployments table).
 */
import { resolveTerminalWorkspaceId } from '../../../identity/bootstrap.js';
import { fetchAuthUserTenantId } from '../../../../src/core/auth.js';
import { userCanAccessWorkspace } from '../../../identity/workspace/access.js';
import { resolveGitHubToken } from './git-runtime.js';
import { getWorkspaceGithubRepo } from '../../../identity/workspace/agentsam-workspace.js';
import { persistUserGitActiveBranch, readUserGitActiveBranch } from '../../../../src/core/workspace-user-prefs.js';

const GH_HEADERS_BASE = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'inneranimalmedia-status-bar/1.0',
};

async function resolveAuthTenantId(env, authUser) {
  if (authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  const uid = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!uid || !env?.DB) return '';
  let tid = await fetchAuthUserTenantId(env, uid).catch(() => null);
  if (!tid && authUser?.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email).catch(() => null);
  }
  return tid != null ? String(tid).trim() : '';
}

/**
 * Resolve github_repo for status / Changes / merkle.
 * Prefer explicit `repo` | `github_repo` query (UI open explorer) over workspace D1 lock.
 * @returns {Promise<{ repo?: string, workspace_id?: string, tenant_id?: string, error?: string, status?: number }>}
 */
export async function fetchWorkspaceGithubRepo(env, authUser, request, url) {
  if (!env?.DB) return { error: 'DB not configured', status: 503 };

  const tw = await resolveTerminalWorkspaceId(
    env,
    request,
    authUser,
    url.searchParams.get('workspace_id'),
  );
  if (!tw.workspaceId) {
    const code = tw.error === 'Forbidden' ? 403 : 400;
    return { error: tw.error || 'workspace_missing', status: code };
  }

  const tenantId = await resolveAuthTenantId(env, authUser);
  if (!tenantId) return { error: 'tenant_missing', status: 403 };

  const overrideRaw = String(
    url.searchParams.get('repo') || url.searchParams.get('github_repo') || '',
  )
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '');
  if (overrideRaw.includes('/')) {
    return { repo: overrideRaw, workspace_id: tw.workspaceId, tenant_id: tenantId };
  }

  const repo = (await getWorkspaceGithubRepo(env, tw.workspaceId)) || '';
  if (!repo || !repo.includes('/')) {
    return {
      error: 'no_github_repo',
      workspace_id: tw.workspaceId,
      status: 200,
    };
  }

  return { repo, workspace_id: tw.workspaceId, tenant_id: tenantId };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 * @returns {Promise<string|null>}
 */
export async function readUserWorkspaceActiveBranch(env, userId, workspaceId) {
  return readUserGitActiveBranch(env, userId, workspaceId);
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} branch
 */
export async function persistUserWorkspaceActiveBranch(env, userId, workspaceId, branch) {
  return persistUserGitActiveBranch(env, userId, workspaceId, branch);
}

async function githubBranchExists(repoSlug, branch, token) {
  const enc = encodeURIComponent(String(branch || '').trim());
  if (!enc || !repoSlug || !token) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repoSlug}/branches/${enc}`, {
      headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Compare tracking branch (default) vs active branch for status-bar sync arrows.
 * When includeFiles is true, also return compare file list (additive — SourcePanel ignores).
 * @param {string} repoSlug
 * @param {string} token
 * @param {string} base
 * @param {string} head
 * @param {{ includeFiles?: boolean }} [opts]
 */
async function fetchGithubBranchCompare(repoSlug, token, base, head, opts = {}) {
  const b = String(base || '').trim();
  const h = String(head || '').trim();
  const includeFiles = opts?.includeFiles === true;
  if (!repoSlug || !token || !b || !h) {
    return { ahead_by: null, behind_by: null, files: includeFiles ? [] : undefined };
  }
  if (b === h) {
    return { ahead_by: 0, behind_by: 0, files: includeFiles ? [] : undefined };
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoSlug}/compare/${encodeURIComponent(b)}...${encodeURIComponent(h)}`,
      { headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return { ahead_by: null, behind_by: null, files: includeFiles ? [] : undefined };
    }
    const j = await res.json().catch(() => ({}));
    const out = {
      ahead_by: typeof j.ahead_by === 'number' ? j.ahead_by : null,
      behind_by: typeof j.behind_by === 'number' ? j.behind_by : null,
    };
    if (includeFiles && Array.isArray(j.files)) {
      out.files = j.files.slice(0, 300).map((f) => ({
        path: f?.filename != null ? String(f.filename) : '',
        filename: f?.filename != null ? String(f.filename) : '',
        status: f?.status != null ? String(f.status) : 'modified',
        sha: f?.sha != null ? String(f.sha) : null,
        previous_filename: f?.previous_filename != null ? String(f.previous_filename) : null,
      })).filter((f) => f.path);
    } else if (includeFiles) {
      out.files = [];
    }
    return out;
  } catch {
    return { ahead_by: null, behind_by: null, files: includeFiles ? [] : undefined };
  }
}

/**
 * Resolve display branch: user preference (D1) when valid on GitHub, else repo default_branch.
 * @param {any} env
 * @param {{ id?: string }} authUser
 * @param {{ repo: string, workspace_id: string }} repoCtx
 * @param {string} token
 * @param {string} defaultBranch
 */
export async function resolveWorkspaceGitBranch(env, authUser, repoCtx, token, defaultBranch) {
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  const workspaceId = repoCtx?.workspace_id != null ? String(repoCtx.workspace_id).trim() : '';
  const repoSlug = String(repoCtx?.repo || '').replace('https://github.com/', '').trim();
  const fallback = defaultBranch != null ? String(defaultBranch).trim() : '';
  if (!fallback) throw new Error('github_default_branch_unresolved');

  const persisted = userId && workspaceId
    ? await readUserWorkspaceActiveBranch(env, userId, workspaceId)
    : null;

  if (persisted && (await githubBranchExists(repoSlug, persisted, token))) {
    return {
      branch: persisted,
      default_branch: fallback,
      active_branch: persisted,
      branch_source: 'user',
    };
  }

  return {
    branch: fallback,
    default_branch: fallback,
    active_branch: persisted,
    branch_source: 'default',
  };
}

/**
 * POST body: { branch, workspace_id? } — persist per-user active branch for workspace repo.
 */
export async function setUserWorkspaceActiveBranch(env, authUser, request, body) {
  if (!env?.DB) return { error: 'DB not configured', status: 503 };
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!userId) return { error: 'Unauthorized', status: 401 };

  const branch = body?.branch != null ? String(body.branch).trim() : '';
  if (!branch) return { error: 'branch required', status: 400 };

  const url = new URL(request.url);
  const explicitWs = body?.workspace_id != null ? String(body.workspace_id).trim() : '';
  const tw = await resolveTerminalWorkspaceId(
    env,
    request,
    authUser,
    explicitWs || url.searchParams.get('workspace_id'),
  );
  if (!tw.workspaceId) {
    return { error: tw.error || 'workspace_missing', status: tw.error === 'Forbidden' ? 403 : 400 };
  }
  if (!(await userCanAccessWorkspace(env, authUser, tw.workspaceId))) {
    return { error: 'Forbidden', status: 403 };
  }

  const scopedUrl = new URL(request.url);
  scopedUrl.searchParams.set('workspace_id', tw.workspaceId);
  const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, scopedUrl);
  if (repoCtx.error === 'no_github_repo') {
    return { error: 'no_github_repo', workspace_id: tw.workspaceId, status: 400 };
  }
  if (repoCtx.error) {
    return { error: repoCtx.error, status: repoCtx.status || 500 };
  }

  const owner = repoCtx.repo.split('/')[0];
  const { token, error, status } = await resolveGitHubToken(authUser, env, owner);
  if (error) return { error, status: status || 401 };

  const repoSlug = repoCtx.repo.replace('https://github.com/', '');
  if (!(await githubBranchExists(repoSlug, branch, token))) {
    return { error: 'branch_not_found', branch, repo: repoCtx.repo, status: 404 };
  }

  await persistUserWorkspaceActiveBranch(env, userId, tw.workspaceId, branch);
  return {
    ok: true,
    branch,
    workspace_id: tw.workspaceId,
    repo: repoCtx.repo,
    branch_source: 'user',
  };
}

async function readWorkspaceGitCache(env, workspaceId) {
  if (!env?.DB || !workspaceId) return null;
  const row = await env.DB.prepare(
    `SELECT checkpoint_sha, checkpoint_label, updated_at, last_agent_action
     FROM agentsam_workspace_state
     WHERE workspace_id = ?
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  return row || null;
}

/**
 * Agent git status bar — live GitHub when token/repo available; D1 cache otherwise. Never 404.
 */
export async function fetchAgentGitStatus(env, authUser, request, url) {
  const tw = await resolveTerminalWorkspaceId(
    env,
    request,
    authUser,
    url.searchParams.get('workspace_id'),
  );
  const workspaceId = tw.workspaceId || null;
  const includeFiles = url.searchParams.get('include_files') === '1';
  if (!workspaceId) {
    return {
      status: 'no_workspace',
      branch: null,
      repo: null,
      repo_full_name: null,
      workspace_id: null,
      dirty: false,
      ...(includeFiles ? { files: [], staged: [], unstaged: [] } : {}),
    };
  }

  const cached = await readWorkspaceGitCache(env, workspaceId);
  const branchFromCache =
    cached?.checkpoint_label != null && String(cached.checkpoint_label).trim() !== ''
      ? String(cached.checkpoint_label).trim()
      : 'main';
  const lastUpdated = cached?.updated_at != null ? Number(cached.updated_at) : null;

  const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, url);
  if (repoCtx.error === 'no_github_repo') {
    return {
      status: 'no_repo',
      branch: branchFromCache,
      repo: null,
      repo_full_name: null,
      workspace_id: workspaceId,
      dirty: false,
      last_updated: lastUpdated,
      checkpoint_sha: cached?.checkpoint_sha ?? null,
      ...(includeFiles ? { files: [], staged: [], unstaged: [] } : {}),
    };
  }
  if (repoCtx.error) {
    return {
      status: 'cached',
      branch: branchFromCache,
      repo: repoCtx.repo ?? null,
      repo_full_name: repoCtx.repo ?? null,
      workspace_id: workspaceId,
      dirty: false,
      last_updated: lastUpdated,
      checkpoint_sha: cached?.checkpoint_sha ?? null,
      detail: repoCtx.error,
      ...(includeFiles ? { files: [], staged: [], unstaged: [] } : {}),
    };
  }

  const owner = repoCtx.repo.split('/')[0];
  const { token, error } = await resolveGitHubToken(authUser, env, owner);
  if (error || !token) {
    return {
      status: 'cached',
      branch: branchFromCache,
      repo: repoCtx.repo,
      repo_full_name: repoCtx.repo,
      workspace_id: workspaceId,
      dirty: false,
      last_updated: lastUpdated,
      checkpoint_sha: cached?.checkpoint_sha ?? null,
      ...(includeFiles ? { files: [], staged: [], unstaged: [] } : {}),
    };
  }

  const live = await fetchGitStatusFromGitHub(env, authUser, request, url, { includeFiles });
  if (live.error) {
    return {
      status: 'cached',
      branch: branchFromCache,
      repo: repoCtx.repo,
      repo_full_name: repoCtx.repo,
      workspace_id: workspaceId,
      dirty: false,
      last_updated: lastUpdated,
      checkpoint_sha: cached?.checkpoint_sha ?? null,
      detail: live.error,
      ...(includeFiles ? { files: [], staged: [], unstaged: [] } : {}),
    };
  }

  // Changes / include_files = GitHub compare only. Never merge D1 change_sets
  // (Accept/Reject staging log) as fake dirty — see MERKLE-FS-ADAPTER Slice 1.
  const files = Array.isArray(live.files) ? live.files : [];

  return {
    status: 'live',
    branch: live.branch,
    default_branch: live.default_branch ?? live.branch,
    active_branch: live.active_branch ?? null,
    branch_source: live.branch_source ?? 'default',
    repo: live.repo,
    repo_full_name: live.repo_full_name,
    workspace_id: live.workspace_id || workspaceId,
    dirty: files.length > 0,
    last_updated: lastUpdated,
    checkpoint_sha: cached?.checkpoint_sha ?? null,
    ahead_by: live.ahead_by ?? null,
    behind_by: live.behind_by ?? null,
    tracking_branch: live.tracking_branch ?? live.default_branch ?? live.branch,
    ...(includeFiles
      ? {
          files,
          staged: [],
          unstaged: [],
        }
      : {}),
  };
}

/**
 * Live GitHub repo metadata for status bar (branch + repo from GET /repos/{owner}/{repo}).
 */
export async function fetchGitStatusFromGitHub(env, authUser, request, url, opts = {}) {
  const includeFiles = opts?.includeFiles === true;
  const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, url);
  if (repoCtx.error) return repoCtx;

  const owner = repoCtx.repo.split('/')[0];
  const { token, error, status } = await resolveGitHubToken(authUser, env, owner);
  if (error) return { error, status: status || 401 };

  const repoSlug = repoCtx.repo.replace('https://github.com/', '');
  const ghRes = await fetch(`https://api.github.com/repos/${repoSlug}`, {
    headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` },
  });

  if (!ghRes.ok) {
    const detail = await ghRes.text().catch(() => '');
    return {
      error: 'github_api',
      status: ghRes.status >= 400 && ghRes.status < 500 ? ghRes.status : 502,
      detail: detail.slice(0, 300),
      workspace_id: repoCtx.workspace_id,
    };
  }

  const gh = await ghRes.json().catch(() => ({}));
  const fullName =
    gh?.full_name != null && String(gh.full_name).trim() !== ''
      ? String(gh.full_name).trim()
      : repoCtx.repo;
  const defaultBranch = gh?.default_branch != null ? String(gh.default_branch).trim() : '';
  if (!defaultBranch) {
    return {
      error: 'github_default_branch_unresolved',
      status: 502,
      workspace_id: repoCtx.workspace_id,
      repo: fullName,
      repo_full_name: fullName,
    };
  }
  const resolved = await resolveWorkspaceGitBranch(env, authUser, repoCtx, token, defaultBranch);
  const compare = await fetchGithubBranchCompare(
    repoSlug,
    token,
    defaultBranch,
    resolved.branch,
    { includeFiles },
  );

  return {
    branch: resolved.branch,
    default_branch: resolved.default_branch,
    active_branch: resolved.active_branch,
    branch_source: resolved.branch_source,
    repo: fullName,
    repo_full_name: fullName,
    workspace_id: repoCtx.workspace_id,
    ahead_by: compare.ahead_by,
    behind_by: compare.behind_by,
    tracking_branch: defaultBranch,
    ...(includeFiles ? { files: Array.isArray(compare.files) ? compare.files : [] } : {}),
  };
}

/**
 * Live PTY backend probe via env.PTY_SERVICE (no D1).
 * @returns {Promise<{ status: 'connected' | 'disconnected' }>}
 */
export async function pingPtyServiceHealth(env) {
  if (!env?.PTY_SERVICE) return { status: 'disconnected' };
  const paths = ['/health', 'http://localhost/health', 'http://localhost:3099/health'];
  for (const path of paths) {
    try {
      const target = path.startsWith('http') ? path : `http://localhost${path}`;
      const res = await env.PTY_SERVICE.fetch(new Request(target, { method: 'GET' }));
      if (res.ok) return { status: 'connected' };
    } catch {
      /* try next path */
    }
  }
  return { status: 'disconnected' };
}

/**
 * Tunnel health — fetch TERMINAL_WS_URL/health when configured; else derive from PTY (binary).
 * @returns {Promise<{ healthy: boolean, status: 'connected' | 'disconnected' }>}
 */
export async function pingTunnelHealth(env) {
  const wsUrl = String(env?.TERMINAL_WS_URL || '').trim().replace(/\/$/, '');
  if (wsUrl) {
    try {
      const res = await fetch(`${wsUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { healthy: true, status: 'connected' };
    } catch {
      /* fall through — PTY-derived binary */
    }
  }

  const pty = await pingPtyServiceHealth(env);
  const up = pty.status === 'connected';
  return { healthy: up, status: up ? 'connected' : 'disconnected' };
}

/**
 * Convert wss://… → https://…/health and GET it (cheap; no exec).
 * @param {string} wsUrl
 * @param {number} [timeoutMs]
 */
export async function pingWsOriginHealth(wsUrl, timeoutMs = 8000) {
  const raw = String(wsUrl || '').trim().split('?')[0];
  if (!raw) return { healthy: false, status: 'disconnected', error: 'health_url_missing' };
  let healthUrl = '';
  try {
    let u = raw;
    if (u.startsWith('wss://')) u = 'https://' + u.slice(6);
    else if (u.startsWith('ws://')) u = 'http://' + u.slice(5);
    else if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    healthUrl = new URL('/health', new URL(u).origin).href;
  } catch {
    return { healthy: false, status: 'disconnected', error: 'health_url_unresolved' };
  }
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    });
    if (res.ok) return { healthy: true, status: 'connected', health_url: healthUrl };
    return {
      healthy: false,
      status: 'disconnected',
      health_url: healthUrl,
      error: `health_http_${res.status}`,
    };
  } catch (e) {
    return {
      healthy: false,
      status: 'disconnected',
      health_url: healthUrl,
      error: e?.message ? String(e.message) : 'health_probe_failed',
    };
  }
}

/**
 * Resolve dock lane aliases → local | remote | sandbox | disconnected.
 * @param {unknown} raw
 * @returns {'local'|'remote'|'sandbox'|'disconnected'|null}
 */
export function normalizeTunnelStatusLane(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  if (!s) return null;
  if (s === 'disconnected' || s === 'none' || s === 'unset') return 'disconnected';
  if (s === 'local' || s === 'localpty' || s === 'user_hosted_tunnel' || s === 'mac') return 'local';
  if (
    s === 'remote' ||
    s === 'platform_vm' ||
    s === 'iamtunnel' ||
    s === 'iam-tunnel' ||
    s === 'vm' ||
    s === 'gcp'
  ) {
    return 'remote';
  }
  if (s === 'sandbox' || s === 'container' || s === 'cf_container') return 'sandbox';
  return null;
}

/**
 * Lane-scoped status ping — no container exec / smoke.
 * Missing/unset lane → disconnected (no invent-to-remote).
 * @param {any} env
 * @param {'local'|'remote'|'sandbox'|'disconnected'} lane
 * @param {{ userId?: string|null, workspaceId?: string|null }} [scope]
 */
export async function pingLaneStatus(env, lane, scope = {}) {
  const uid = scope.userId != null ? String(scope.userId).trim() : '';
  const wid = scope.workspaceId != null ? String(scope.workspaceId).trim() : '';

  if (lane === 'disconnected') {
    return {
      lane: 'disconnected',
      marker: 'disconnected',
      healthy: false,
      status: 'disconnected',
      pty_health: false,
      connections: 0,
      error: 'terminal_lane_unset',
    };
  }

  if (lane === 'remote') {
    const result = await pingTunnelHealth(env);
    const pty = await pingPtyServiceHealth(env);
    return {
      lane: 'remote',
      marker: 'platform_vm',
      healthy: result.healthy === true,
      status: result.status,
      pty_health: pty.status === 'connected',
      connections: result.healthy ? 1 : 0,
    };
  }

  if (lane === 'local') {
    let wsUrl = '';
    if (env?.DB && uid && wid) {
      try {
        const row = await env.DB.prepare(
          `SELECT ws_url FROM terminal_connections
            WHERE user_id = ? AND workspace_id = ? AND is_active = 1
              AND target_type = 'user_hosted_tunnel'
            ORDER BY is_default DESC, target_priority ASC, updated_at DESC
            LIMIT 1`,
        )
          .bind(uid, wid)
          .first();
        wsUrl = row?.ws_url != null ? String(row.ws_url).trim() : '';
      } catch {
        wsUrl = '';
      }
    }
    if (!wsUrl && env?.DB && uid) {
      try {
        const row = await env.DB.prepare(
          `SELECT ws_url FROM terminal_connections
            WHERE user_id = ? AND is_active = 1 AND target_type = 'user_hosted_tunnel'
            ORDER BY is_default DESC, target_priority ASC, updated_at DESC
            LIMIT 1`,
        )
          .bind(uid)
          .first();
        wsUrl = row?.ws_url != null ? String(row.ws_url).trim() : '';
      } catch {
        wsUrl = '';
      }
    }
    const macExec = String(env?.MAC_EXEC_URL || '').trim();
    if (!wsUrl && macExec) {
      try {
        const u = new URL(macExec);
        wsUrl = `wss://${u.host}`;
      } catch {
        /* ignore */
      }
    }
    const ping = await pingWsOriginHealth(wsUrl);
    return {
      lane: 'local',
      marker: 'localpty',
      healthy: ping.healthy === true,
      status: ping.status,
      pty_health: ping.healthy === true,
      connections: ping.healthy ? 1 : 0,
      error: ping.error || null,
    };
  }

  // sandbox — probe /health only (caller must only poll when dock is sandbox)
  const { probeMyContainer } = await import('../../../agentsam/sandbox/my-container.js');
  const probe = await probeMyContainer(env);
  return {
    lane: 'sandbox',
    marker: 'container',
    healthy: probe.ok === true,
    status: probe.ok ? 'connected' : 'disconnected',
    pty_health: false,
    connections: probe.ok ? 1 : 0,
    probe,
    error: probe.error || null,
  };
}
