/**
 * Resolve which owner/name a GitHub API call may use for this authenticated user.
 * Owner must match the connected OAuth login; bare slugs are not expanded.
 */
import { getUserGithubToken } from '../integrations/github.js';
import { getWorkspaceGithubRepo } from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseRepoParts(repo) {
  const s = trim(repo);
  if (!s.includes('/')) {
    return { owner: '', slug: s };
  }
  const idx = s.indexOf('/');
  return {
    owner: s.slice(0, idx).trim().toLowerCase(),
    slug: s.slice(idx + 1).trim(),
  };
}

function fullRepo(ownerLogin, slug) {
  const o = trim(ownerLogin);
  const sl = trim(slug);
  if (!o || !sl) return null;
  return `${o}/${sl}`;
}

/**
 * Join split `{ owner, repo }` args into `owner/name` when both are present.
 * @param {{ owner?: unknown, org?: unknown, repo?: unknown, repository?: unknown, repository_full_name?: unknown }} params
 * @returns {string}
 */
export function composeGithubRepoArg(params = {}) {
  const repo = trim(
    params.repo ?? params.repository ?? params.repository_full_name ?? '',
  );
  if (repo.includes('/')) return repo;
  const owner = trim(params.owner ?? params.org ?? '');
  if (owner && repo) return `${owner}/${repo}`;
  return repo;
}

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} workspaceId
 */
export async function fetchWorkspaceGithubRepo(env, tenantId, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  const repo = (await getWorkspaceGithubRepo(env, wid)) || '';
  return repo.includes('/') ? repo : null;
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function fetchUserGithubLogin(env, userId) {
  const uid = trim(userId);
  if (!uid) return null;
  try {
    const row = await getUserGithubToken(env, uid, '');
    const login = trim(row?.account_identifier);
    return login || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{
 *   userId: string,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   requestedRepo?: string|null,
 *   isSuperadmin?: boolean,
 *   allowWorkspaceFillIn?: boolean,
 * }} input
 * @returns {Promise<{ repo: string|null, reason?: string, blocked?: boolean, suggested_repo?: string|null, hint?: string }>}
 */
export async function resolveGithubRepoForToolCall(env, input) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  const requested = trim(input.requestedRepo);
  const allowWorkspaceFillIn = input.allowWorkspaceFillIn !== false;

  if (!userId) {
    return { repo: null, blocked: true, reason: 'user_id_required' };
  }

  const [workspaceRepo, userLogin] = await Promise.all([
    workspaceId ? fetchWorkspaceGithubRepo(env, input.tenantId, workspaceId) : null,
    fetchUserGithubLogin(env, userId),
  ]);

  if (!userLogin) {
    return {
      repo: null,
      blocked: true,
      reason: 'github_not_connected',
    };
  }

  const userOwner = userLogin.toLowerCase();

  const acceptRepo = (repo, meta = {}) => {
    const full = trim(repo);
    if (!full || !full.includes('/')) return null;
    const owner = parseRepoParts(full).owner;
    if (owner !== userOwner) return null;
    return { repo: full, ...meta };
  };

  if (requested) {
    const direct = acceptRepo(requested);
    if (direct) return direct;

    const { owner, slug } = parseRepoParts(requested);

    if (!requested.includes('/')) {
      const suggested = slug ? fullRepo(userLogin, slug) : null;
      return {
        repo: null,
        blocked: true,
        reason: 'repo_must_be_owner_slash_name',
        suggested_repo: suggested,
        hint: suggested
          ? `Pass repo as "${suggested}" — bare slugs are not expanded.`
          : 'Pass repo as owner/repository.',
      };
    }

    if (owner && owner !== userOwner) {
      const suggested = slug ? fullRepo(userLogin, slug) : null;
      return {
        repo: null,
        blocked: true,
        reason: `repo_owner_mismatch:${requested}`,
        suggested_repo: suggested,
        hint: suggested
          ? `Repo owner must be your GitHub login \`${userLogin}\`. Retry with "${suggested}" if that is the intended repo.`
          : `Repo owner must be your GitHub login \`${userLogin}\`. Requested: ${requested}.`,
      };
    }

    return {
      repo: null,
      blocked: true,
      reason: `repo_not_in_user_scope:${requested}`,
      suggested_repo: null,
    };
  }

  if (allowWorkspaceFillIn && workspaceRepo) {
    const ws = acceptRepo(workspaceRepo);
    if (ws) return { ...ws, reason: 'workspace_github_repo_fill_in' };
  }

  return {
    repo: null,
    blocked: !allowWorkspaceFillIn,
    reason: allowWorkspaceFillIn
      ? 'no_repo_context'
      : 'explicit_repo_required_for_mutation',
    hint: allowWorkspaceFillIn
      ? undefined
      : 'Pass repo as owner/repository — workspace fill-in is disabled for this call.',
  };
}

/**
 * Drop client-supplied owner/name that fails OAuth-login scope; otherwise return it.
 * @param {any} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, clientRepo?: string|null }} input
 */
export async function sanitizeGithubRepoContextForChat(env, input) {
  const clientRepo = trim(input.clientRepo);
  if (!clientRepo) return null;
  const resolved = await resolveGithubRepoForToolCall(env, {
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    requestedRepo: clientRepo,
  });
  if (resolved.blocked || !resolved.repo) return null;
  return resolved.repo;
}

/**
 * Resolve github owner/repo for the current chat turn.
 * Explicit only: project context, body fields, or Files/active-file envelope.
 * Never fills from workspaces.github_repo (chat ≠ workspace settings metadata).
 *
 * @param {any} env
 * @param {{
 *   body?: Record<string, unknown>|null,
 *   projectContext?: { github_repo?: string|null, client_authority?: boolean }|null,
 *   activeFileEnvelope?: Record<string, unknown>|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 * }} input
 * @returns {Promise<string|null>}
 */
export async function resolveChatGithubRepoContext(env, input) {
  const userId = trim(input.userId);
  const tenantId = trim(input.tenantId);
  const workspaceId = trim(input.workspaceId);
  const project = input.projectContext && typeof input.projectContext === 'object' ? input.projectContext : null;

  let candidate = trim(project?.github_repo);
  if (!candidate) {
    candidate = trim(
      input.body?.active_repo ??
        input.body?.activeRepo ??
        input.body?.github_repo_context ??
        input.body?.githubRepoContext ??
        input.body?.selectedGithubRepoContext,
    );
  }
  if (!candidate) {
    candidate = trim(input.activeFileEnvelope?.github_repo);
  }
  if (!candidate) return null;

  const normalized = candidate
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .trim();
  if (!normalized || !normalized.includes('/')) return null;
  if (!userId) return null;

  try {
    return (
      (await sanitizeGithubRepoContextForChat(env, {
        userId,
        tenantId: tenantId || null,
        workspaceId: workspaceId || null,
        clientRepo: normalized,
      })) || null
    );
  } catch (e) {
    console.warn('[github-repo-scope] chat_repo_sanitize', e?.message ?? e);
    return null;
  }
}
