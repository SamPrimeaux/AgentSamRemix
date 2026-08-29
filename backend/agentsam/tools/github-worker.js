/**
 * GitHub tools — user OAuth from D1 (no cookie round-trip to dashboard).
 */
import { getUserGithubToken, githubCommitHandshake } from '../../../src/integrations/github.js';
import { resolveIntegrationUserId } from '../../identity/oauth/integration-user-id.js';
import {
  readGithubSearchCache,
  writeGithubSearchCache,
} from '../../../src/core/github-search-cache.js';
import {
  filterGithubReposListForUserAsync,
  GITHUB_USER_REPOS_AFFILIATION,
} from '../../../src/core/github-repos-list-filter.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function asInt(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function missingNonEmptyStrings(params, fields) {
  const missing = [];
  for (const f of fields) {
    if (!trim(params?.[f])) missing.push(f);
  }
  return missing;
}

function missingDefined(params, fields) {
  const missing = [];
  for (const f of fields) {
    if (params?.[f] == null) missing.push(f);
  }
  return missing;
}

function missingRequiredInput(params, missing) {
  const tool = trim(params?.tool) || null;
  const operation = trim(params?.operation) || null;
  return {
    success: false,
    error: 'missing_required_input',
    missing,
    tool,
    operation,
  };
}

function toolMeta(params) {
  return {
    tool: trim(params?.tool) || null,
    operation: trim(params?.operation) || null,
  };
}

function structuredError(params, error, message, extra = null) {
  return {
    success: false,
    error,
    message: message != null ? String(message) : null,
    ...toolMeta(params),
    ...(extra && typeof extra === 'object' ? extra : null),
  };
}

function requireMutationBranch(params) {
  const branch = trim(params?.branch) || trim(params?.ref);
  if (!branch) {
    return structuredError(
      params,
      'github_branch_required',
      'GitHub mutations require an explicit branch/ref. Never invent main.',
    );
  }
  return branch;
}

function authUserFromParams(params, canonicalUserId) {
  const uid = canonicalUserId || (params.user_id != null ? String(params.user_id).trim() : '');
  if (!uid) return null;
  return { id: uid, user_id: uid };
}

/**
 * Resolve the repository default branch from GitHub metadata.
 * Fail loud when omitted — never invent `main`/`master`.
 */
async function resolveRepoDefaultBranch(token, repo, params) {
  const full = trim(repo);
  if (!full || !full.includes('/')) {
    return structuredError(params, 'invalid_input', 'repo must be owner/name to resolve default_branch');
  }
  const res = await ghJson(token, 'GET', `/repos/${full}`, null);
  if (res?.success === false) return { ...res, ...toolMeta(params) };
  const branch = trim(res.data?.default_branch);
  if (!branch) {
    return structuredError(params, 'default_branch_missing', `GitHub returned no default_branch for ${full}`, {
      repo: full,
    });
  }
  return { success: true, default_branch: branch, repo: full };
}

/** Prefer explicit branch/ref; otherwise fetch default_branch (no hard-coded main). */
async function resolveBranchOrDefault(token, repo, params, candidates = []) {
  for (const c of candidates) {
    const v = trim(c);
    if (v) return { success: true, branch: v, source: 'explicit' };
  }
  const resolved = await resolveRepoDefaultBranch(token, repo, params);
  if (resolved.success === false || resolved.error) return resolved;
  return { success: true, branch: resolved.default_branch, source: 'default_branch' };
}

async function ghGetToken(env, params) {
  const rawUid = params.user_id != null ? String(params.user_id).trim() : '';
  if (!rawUid) return structuredError(params, 'missing_required_input', 'user_id is required', { missing: ['user_id'] });
  const canonicalUserId = await resolveIntegrationUserId(env, { id: rawUid });
  if (!canonicalUserId) {
    return structuredError(
      params,
      'auth_user_id_required',
      'user_id must be auth_users.id (au_*) from the authenticated session',
      { provided_prefix: rawUid.slice(0, 4) },
    );
  }
  const account = params.account != null ? String(params.account) : params.account_identifier != null ? String(params.account_identifier) : '';
  const row = await getUserGithubToken(env, canonicalUserId, account);
  if (!row?.token) {
    return structuredError(
      params,
      'github_not_connected',
      'GitHub account not linked — sign in with GitHub or connect in Integrations',
    );
  }
  return {
    token: row.token,
    account_identifier: row.account_identifier || '',
    user: authUserFromParams(params, canonicalUserId),
  };
}

async function ghJson(token, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'InnerAnimalMedia-AgentSam',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return ghFailureFromResponse(res, json, method, path);
  }
  return { success: true, data: json };
}

const GITHUB_SEARCH_QUALIFIER_RE = /\b(repo:|user:|org:|in:)/i;

function ghRateLimitResetIso(res) {
  const raw = res.headers.get('X-RateLimit-Reset') || res.headers.get('x-ratelimit-reset');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function ghFailureFromResponse(res, json, method, path) {
  const msg =
    json?.message ||
    (json && typeof json === 'object' ? JSON.stringify(json).slice(0, 200) : String(json || ''));
  const rateLimited =
    res.status === 403 && /rate limit exceeded|secondary rate limit/i.test(String(msg));
  const notFound = res.status === 404;
  // Contents/commits/git blob 404s mean path-or-ref missing — not "repo does not exist".
  // Empty repos (no README yet) 404 on README.md and were mislabeled github_repo_not_found.
  const apiPath = String(path || '').split('?')[0];
  const isPathScoped404 =
    notFound &&
    /\/repos\/[^/]+\/[^/]+\/(contents|git\/(blobs|trees|commits|refs)|commits|compare|pulls|issues)\b/.test(
      apiPath,
    );
  let user_message;
  let errorCode = 'github_api_error';
  if (rateLimited) {
    errorCode = 'github_rate_limit_exceeded';
    user_message =
      'GitHub Search API rate limit exceeded (code search: 10/min). Scope with repo:owner/name, prefer github_get_tree or github_list_commits, or retry after rate_limit_reset.';
  } else if (res.status === 403 && /Resource not accessible by integration/i.test(String(msg))) {
    user_message = 'GitHub token lacks scope for this search. Reconnect GitHub OAuth with repo scope.';
  } else if (isPathScoped404) {
    errorCode = 'github_path_not_found';
    const repoMatch = apiPath.match(/\/repos\/([^/]+\/[^/]+)/);
    const repoHint = repoMatch ? repoMatch[1] : null;
    user_message = repoHint
      ? `Path/ref not found in \`${repoHint}\` (404). Repo may exist but be empty, or the file/ref is wrong — use agentsam_github_tree or write the file first.`
      : 'GitHub path/ref returned 404. Repo may be empty, or the file path is wrong.';
  } else if (notFound) {
    errorCode = 'github_repo_not_found';
    const repoMatch = apiPath.match(/\/repos\/([^/]+\/[^/]+)/);
    const repoHint = repoMatch ? repoMatch[1] : null;
    user_message = repoHint
      ? `GitHub could not find \`${repoHint}\` (404). Check the owner/name spelling, or call agentsam_github_repo_list to see repos you can access.`
      : 'GitHub returned 404 Not Found. Check the owner/name spelling, or call agentsam_github_repo_list.';
  }
  return {
    success: false,
    error: errorCode,
    status: res.status,
    message: `GitHub ${method} ${path} → ${res.status}: ${msg}`,
    user_message,
    rate_limit_reset: rateLimited ? ghRateLimitResetIso(res) : null,
    documentation_url: json?.documentation_url || null,
  };
}

/**
 * GitHub Search requires qualifiers for code search; unscoped queries burn the 10/min limit.
 * @param {Record<string, unknown>} params
 */
function buildGithubSearchQuery(params) {
  let q = trim(params.q);
  const repo = trim(params.repo || params.github_repo);
  if (!q) {
    return structuredError(params, 'missing_required_input', 'q is required', { missing: ['q'] });
  }
  if (repo && !/\brepo:/i.test(q)) {
    q = `repo:${repo} ${q}`;
  }
  if (!GITHUB_SEARCH_QUALIFIER_RE.test(q)) {
    return structuredError(
      params,
      'github_search_query_too_broad',
      'GitHub search requires a scoped query (repo:owner/name, user:, org:, or in:).',
      {
        user_message: repo
          ? `Use repo:${repo} <term> or github_get_tree / github_list_commits instead of global search.`
          : 'Pass repo:owner/name in q or set repo in tool input. Prefer github_get_tree or github_list_commits for repo browsing.',
        suggested_query: repo ? `repo:${repo} ${trim(params.q)}` : null,
      },
    );
  }
  return { success: true, q };
}

/**
 * @param {Record<string, unknown>} params
 * @param {'code'|'issues'} kind
 * @param {any} env
 * @param {string} query
 * @param {() => Promise<Record<string, unknown>>} fetchFresh
 */
async function githubSearchWithCache(params, kind, env, query, fetchFresh) {
  const userId = trim(params.user_id);
  const cached = await readGithubSearchCache(env, userId, kind, query);
  if (cached) {
    if (cached.error && typeof cached.error === 'object') {
      return { ...cached.error, ...toolMeta(params), query, cache_hit: true };
    }
    if (cached.results !== undefined) {
      return { success: true, query, results: cached.results, cache_hit: true };
    }
  }

  const out = await fetchFresh();
  if (out?.success === true && out.results !== undefined) {
    await writeGithubSearchCache(env, userId, kind, query, { success: true, results: out.results });
    return { ...out, cache_hit: false };
  }
  if (out?.error === 'github_rate_limit_exceeded') {
    await writeGithubSearchCache(env, userId, kind, query, { error: out });
  }
  return { ...out, cache_hit: false };
}

async function ghText(token, method, path, accept) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept || 'application/vnd.github+json',
      'User-Agent': 'InnerAnimalMedia-AgentSam',
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return {
      success: false,
      error: 'github_api_error',
      status: res.status,
      message: `GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { success: true, data: text };
}

async function ghPaged(token, pathBase, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= Math.max(1, maxPages); page++) {
    const join = pathBase.includes('?') ? '&' : '?';
    const url = `${pathBase}${join}per_page=100&page=${page}`;
    const res = await ghJson(token, 'GET', url, null);
    if (res?.success === false) return res;
    const data = res?.data;
    if (!Array.isArray(data)) return structuredError({}, 'github_api_error', 'Expected array response from GitHub paging endpoint');
    out.push(...data);
    if (data.length < 100) break;
  }
  return { success: true, data: out };
}

export const handlers = {
  async github_repos(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id']);
    if (missing.length) return missingRequiredInput(params, missing);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const data = await ghPaged(
      t.token,
      `/user/repos?sort=updated&affiliation=${GITHUB_USER_REPOS_AFFILIATION}`,
      2,
    );
    if (data?.success === false) return { ...data, ...toolMeta(params) };
    const raw = Array.isArray(data.data) ? data.data : [];
    const repos = await filterGithubReposListForUserAsync(env, raw, t.account_identifier || '');
    return { success: true, repos };
  },

  /**
   * Create a repository on the authenticated GitHub user (or org when org is set).
   * Does not require an existing workspace github_repo — greenfield scaffold path.
   */
  async github_create_repo(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'name']);
    if (missing.length) return missingRequiredInput(params, missing);
    const name = trim(params.name);
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
      return structuredError(
        params,
        'invalid_repo_name',
        'Repository name must be 1–100 chars: letters, numbers, ., _, - only.',
        { name },
      );
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;

    const org = trim(params.org || params.organization || params.owner);
    const body = {
      name,
      private: params.private === false || params.private === 'false' ? false : true,
      auto_init: params.auto_init === false || params.auto_init === 'false' ? false : true,
    };
    const description = trim(params.description);
    if (description) body.description = description.slice(0, 350);
    const homepage = trim(params.homepage || params.url);
    if (homepage) body.homepage = homepage.slice(0, 255);
    if (params.has_issues === false || params.has_issues === 'false') body.has_issues = false;
    if (params.has_projects === false || params.has_projects === 'false') body.has_projects = false;
    if (params.has_wiki === false || params.has_wiki === 'false') body.has_wiki = false;

    const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos';
    const res = await ghJson(t.token, 'POST', path, body);
    if (res?.success === false) {
      const msg = String(res.message || res.error || '');
      if (/already exists|name already exists/i.test(msg)) {
        return structuredError(
          params,
          'repo_already_exists',
          `A repository named "${name}" already exists for this account. Use agentsam_github_repo_list or pick another name.`,
          { name, org: org || null },
        );
      }
      return { ...res, ...toolMeta(params) };
    }
    const repo = res.data || {};
    const fullName = trim(repo.full_name) || `${trim(t.account_identifier) || 'user'}/${name}`;

    // Persist workspace github_repo when caller passes workspace_id (greenfield spine).
    const workspaceId = trim(params.workspace_id || params.workspaceId);
    let workspace_github_repo_set = false;
    if (workspaceId && env?.DB && fullName) {
      try {
        await env.DB.prepare(
          `UPDATE workspaces SET github_repo = ?, updated_at = unixepoch() WHERE id = ?`,
        )
          .bind(fullName, workspaceId)
          .run();
        await env.DB.prepare(
          `UPDATE agentsam_workspace SET github_repo = ?, updated_at = unixepoch() WHERE id = ?`,
        )
          .bind(fullName, workspaceId)
          .run();
        workspace_github_repo_set = true;
      } catch (e) {
        console.warn('[github_create_repo] workspace github_repo update', e?.message ?? e);
      }
    }

    return {
      success: true,
      repo: fullName,
      full_name: fullName,
      html_url: repo.html_url || null,
      clone_url: repo.clone_url || null,
      ssh_url: repo.ssh_url || null,
      default_branch: repo.default_branch || null,
      private: repo.private === true,
      owner: repo.owner?.login || t.account_identifier || null,
      created: true,
      workspace_id: workspaceId || null,
      workspace_github_repo_set,
      hint:
        'Empty repos have no README until auto_init seeds one or you write files — agentsam_github_read of missing paths returns github_path_not_found (not github_repo_not_found).',
    };
  },

  async github_file(params, env) {
    return await handlers.github_get_file(params, env);
  },

  async github_get_file(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'path']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = String(params.repo).trim();
    const path = String(params.path).trim();
    if (path === '.' || path === '/' || path === './') {
      return structuredError(
        params,
        'is_directory',
        'path "." is a directory. Use agentsam_github_tree for the file tree, then agentsam_github_read with concrete file paths.',
        { is_directory: true, path, repo },
      );
    }
    if (/[*?[\]{}]/.test(path)) {
      return structuredError(
        params,
        'glob_not_supported',
        `Globs are not supported on Contents API (${path}). Use agentsam_github_tree or agentsam_github_search, then read exact paths.`,
        { path, repo },
      );
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const ref = trim(params.ref) || trim(params.branch);
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/contents/${enc}${qs}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const data = res.data;
    // Contents API returns an array for directories — never treat as file text.
    if (Array.isArray(data)) {
      return structuredError(
        params,
        'is_directory',
        `"${path}" is a directory (${data.length} entries). Use agentsam_github_tree or agentsam_github_read with a file path.`,
        {
          is_directory: true,
          path,
          repo,
          entries: data.slice(0, 50).map((e) => ({
            name: e.name,
            path: e.path,
            type: e.type,
          })),
        },
      );
    }
    const file = data || {};
    let text = '';
    if (typeof file.content === 'string' && file.encoding === 'base64') {
      try {
        text = new TextDecoder().decode(
          Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
        );
      } catch {
        text = '';
      }
    }
    return {
      success: true,
      path,
      repo,
      sha: file.sha || null,
      size: file.size ?? null,
      encoding: file.encoding || null,
      text,
    };
  },

  async github_update_file(params, env) {
    // update_file requires sha (caller should read first).
    const missing = [
      ...missingNonEmptyStrings(params, ['user_id', 'repo', 'path', 'message', 'sha']),
      ...missingDefined(params, ['content']),
    ];
    if (missing.length) return missingRequiredInput(params, [...new Set(missing)]);
    const repo = String(params.repo).trim();
    const path = String(params.path).trim();
    const content = String(params.content);
    const message = String(params.message).trim();
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;
    const sha = trim(params.sha);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const res = await ghJson(t.token, 'PUT', `/repos/${repo}/contents/${enc}`, {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      sha,
      ...(branch ? { branch } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, commit: res.data?.commit ?? null, content: res.data?.content ?? null };
  },

  async github_create_file(params, env) {
    const missing = [
      ...missingNonEmptyStrings(params, ['user_id', 'repo', 'path', 'message']),
      ...missingDefined(params, ['content']),
    ];
    if (missing.length) return missingRequiredInput(params, [...new Set(missing)]);
    const repo = String(params.repo).trim();
    const path = String(params.path).trim();
    const content = String(params.content);
    const message = String(params.message).trim();
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const res = await ghJson(t.token, 'PUT', `/repos/${repo}/contents/${enc}`, {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      ...(branch ? { branch } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, commit: res.data?.commit ?? null, content: res.data?.content ?? null };
  },

  async github_upsert_file(params, env) {
    const missing = [
      ...missingNonEmptyStrings(params, ['user_id', 'repo', 'path', 'message']),
      ...missingDefined(params, ['content']),
    ];
    if (missing.length) return missingRequiredInput(params, [...new Set(missing)]);
    const repo = String(params.repo).trim();
    const path = String(params.path).trim();
    const content = String(params.content);
    const message = String(params.message).trim();
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    let sha = trim(params.sha);
    let created = false;
    if (!sha) {
      const existing = await ghJson(
        t.token,
        'GET',
        `/repos/${repo}/contents/${enc}?ref=${encodeURIComponent(branch)}`,
        null,
      );
      if (existing.success && existing.data?.sha) {
        sha = trim(existing.data.sha);
      } else if (existing.success === false && existing.status !== 404) {
        return { ...existing, ...toolMeta(params) };
      } else {
        created = true;
      }
    }
    const res = await ghJson(t.token, 'PUT', `/repos/${repo}/contents/${enc}`, {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      ...(sha ? { sha } : {}),
      branch,
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return {
      success: true,
      created,
      commit: res.data?.commit ?? null,
      content: res.data?.content ?? null,
    };
  },

  /**
   * Atomic multi-file commit (Git Data API) — one commit for N UTF-8 text files.
   */
  async github_commit_tree(params, env) {
    const missing = [
      ...missingNonEmptyStrings(params, ['user_id', 'repo', 'message']),
    ];
    if (missing.length) return missingRequiredInput(params, missing);
    const filesRaw = params.files ?? params.changes ?? params.paths;
    if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
      return missingRequiredInput(params, ['files']);
    }
    if (filesRaw.length > 50) {
      return structuredError(params, 'files_limit', 'Max 50 files per agentsam_github_commit_tree call');
    }
    const files = [];
    for (const f of filesRaw) {
      if (typeof f === 'string') {
        return structuredError(
          params,
          'invalid_files',
          'files entries must be { path, content } objects (not path strings alone)',
        );
      }
      const path = trim(f?.path);
      if (!path || f?.content == null) {
        return structuredError(params, 'invalid_files', 'each file requires path and content');
      }
      files.push({ path, content: String(f.content) });
    }
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;

    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;

    try {
      const { githubCommitTreeWithToken } = await import('../../../src/integrations/github.js');
      const out = await githubCommitTreeWithToken(
        t.token,
        String(params.repo).trim(),
        {
          branch,
          message: String(params.message).trim(),
          files,
        },
        env,
      );
      return { success: true, ...out, ...toolMeta(params) };
    } catch (e) {
      return structuredError(params, 'github_commit_tree_failed', e?.message ? String(e.message) : String(e));
    }
  },

  async github_delete_file(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'path', 'message']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = String(params.repo).trim();
    const path = String(params.path).trim();
    const message = String(params.message).trim();
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;

    // Must provide sha to delete via Contents API; accept provided sha or resolve it.
    let sha = trim(params.sha);
    if (!sha) {
      const get = await handlers.github_get_file({ ...params, repo, path }, env);
      if (get?.success === false) return get;
      sha = trim(get?.sha);
    }
    if (!sha) return structuredError(params, 'github_delete_failed', 'Unable to resolve file sha for deletion');

    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const res = await ghJson(t.token, 'DELETE', `/repos/${repo}/contents/${enc}`, {
      message,
      sha,
      ...(branch ? { branch } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, commit: res.data?.commit ?? null, content: res.data?.content ?? null };
  },

  async github_read_dir(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'path']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const path = trim(params.path).replace(/^\/+/, '');
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const enc = path
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const ref = trim(params.ref) || trim(params.branch);
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/contents/${enc}${qs}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const data = res.data;
    if (!Array.isArray(data)) {
      return structuredError(params, 'github_api_error', 'Expected array response for directory read');
    }
    return { success: true, entries: data };
  },

  async github_get_tree(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const recursive = params.recursive == null ? true : Boolean(params.recursive);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const branchRes = await resolveBranchOrDefault(t.token, repo, params, [params.branch, params.ref]);
    if (branchRes.success === false || branchRes.error) return branchRes;
    const branch = branchRes.branch;
    const refRes = await ghJson(t.token, 'GET', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, null);
    if (refRes?.success === false) return { ...refRes, ...toolMeta(params) };
    const sha = trim(refRes.data?.object?.sha);
    if (!sha) return structuredError(params, 'github_api_error', 'Unable to resolve branch SHA');
    const res = await ghJson(
      t.token,
      'GET',
      `/repos/${repo}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`,
      null,
    );
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, tree: res.data?.tree || [], sha: res.data?.sha || sha, branch };
  },

  async github_batch_read(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    // Accept `paths` as alias — models often pass paths instead of files.
    const rawList = Array.isArray(params.files)
      ? params.files
      : Array.isArray(params.paths)
        ? params.paths
        : null;
    if (!rawList || rawList.length === 0) {
      return {
        ...missingRequiredInput(params, ['files']),
        user_message:
          'agentsam_github_read_many requires files: string[] of exact repo paths (no globs, no directories). Use agentsam_github_tree first.',
      };
    }
    const repo = trim(params.repo);
    const MAX_BATCH = 20;
    const files = rawList.slice(0, MAX_BATCH);
    const out = await Promise.all(
      files.map(async (f) => {
        const path = trim(f?.path ?? f);
        if (!path) {
          return { path: '', sha: null, text: '', error: 'empty_path' };
        }
        const got = await handlers.github_get_file(
          {
            ...params,
            repo,
            path,
            ref: f?.ref ?? params.ref,
            branch: f?.branch ?? params.branch,
          },
          env,
        );
        if (got?.success === false) {
          return {
            path,
            sha: null,
            text: '',
            error: got?.message || got?.error || 'read_failed',
            is_directory: got?.is_directory === true,
            entries: got?.entries || undefined,
          };
        }
        return { path, sha: got?.sha ?? null, text: got?.text ?? '' };
      }),
    );
    const truncated = rawList.length > MAX_BATCH;
    return {
      success: true,
      files: out,
      truncated,
      hint: truncated
        ? `Only first ${MAX_BATCH} paths were read. Pass fewer concrete file paths.`
        : undefined,
    };
  },

  async github_patch_file(params, env) {
    const missing = [
      ...missingNonEmptyStrings(params, ['user_id', 'repo', 'path', 'find']),
      ...missingDefined(params, ['replace']),
    ];
    if (missing.length) return missingRequiredInput(params, [...new Set(missing)]);
    const branch = requireMutationBranch(params);
    if (typeof branch !== 'string') return branch;
    const find = String(params.find);
    const replace = String(params.replace);
    const replaceAll = params.replace_all === true || params.replaceAll === true;
    const message = trim(params.message) || `patch: ${trim(params.path)}`;
    const got = await handlers.github_get_file(params, env);
    if (got?.success === false) return got;
    const text = typeof got.text === 'string' ? got.text : '';
    if (!text.includes(find)) {
      return structuredError(
        params,
        'find_not_found',
        'find string not present in current file content',
        { path: got.path, sha: got.sha },
      );
    }
    const occurrences = text.split(find).length - 1;
    if (!replaceAll && occurrences !== 1) {
      return structuredError(
        params,
        'find_not_unique',
        `find matched ${occurrences} times; set replace_all=true or use a more specific find string`,
        { path: got.path, sha: got.sha, occurrences },
      );
    }
    const next = replaceAll ? text.split(find).join(replace) : text.replace(find, replace);
    return handlers.github_upsert_file(
      {
        ...params,
        content: next,
        message,
        sha: got.sha,
        branch,
      },
      env,
    );
  },

  async github_create_pr(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'title', 'head']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = String(params.repo).trim();
    const title = String(params.title).trim();
    const head = String(params.head).trim();
    const body = params.body != null ? String(params.body) : '';
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const baseRes = await resolveBranchOrDefault(t.token, repo, params, [params.base]);
    if (baseRes.success === false || baseRes.error) return baseRes;
    const base = baseRes.branch;
    const res = await ghJson(t.token, 'POST', `/repos/${repo}/pulls`, {
      title,
      head,
      base,
      body: body || undefined,
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const data = res.data || {};
    return { success: true, html_url: data.html_url, number: data.number, state: data.state };
  },

  async github_update_pr(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'pull_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const pullNumber = asInt(params.pull_number, null);
    if (!pullNumber || pullNumber <= 0) {
      return structuredError(params, 'invalid_input', 'pull_number must be a positive integer');
    }
    const body = {};
    if (params.title != null) body.title = String(params.title);
    if (params.body != null) body.body = String(params.body);
    if (params.state != null) body.state = String(params.state);
    if (params.base != null) body.base = String(params.base);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'PATCH', `/repos/${repo}/pulls/${pullNumber}`, body);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, pr: res.data };
  },

  async github_get_pr(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'pull_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const pullNumber = asInt(params.pull_number, null);
    if (!pullNumber || pullNumber <= 0) {
      return structuredError(params, 'invalid_input', 'pull_number must be a positive integer');
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/pulls/${pullNumber}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, pr: res.data };
  },

  async github_list_prs(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const state = trim(params.state) || 'open';
    const base = trim(params.base);
    const head = trim(params.head);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const qs = new URLSearchParams();
    if (state) qs.set('state', state);
    if (base) qs.set('base', base);
    if (head) qs.set('head', head);
    const res = await ghPaged(t.token, `/repos/${repo}/pulls?${qs.toString()}`, 3);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, prs: Array.isArray(res.data) ? res.data : [] };
  },

  async github_list_pr_files(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'pull_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const pullNumber = asInt(params.pull_number, null);
    if (!pullNumber || pullNumber <= 0) {
      return structuredError(params, 'invalid_input', 'pull_number must be a positive integer');
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghPaged(t.token, `/repos/${repo}/pulls/${pullNumber}/files`, 5);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, files: Array.isArray(res.data) ? res.data : [] };
  },

  async github_get_pr_diff(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'pull_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const pullNumber = asInt(params.pull_number, null);
    if (!pullNumber || pullNumber <= 0) {
      return structuredError(params, 'invalid_input', 'pull_number must be a positive integer');
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghText(t.token, 'GET', `/repos/${repo}/pulls/${pullNumber}`, 'application/vnd.github.v3.diff');
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, diff: String(res.data || '') };
  },

  async github_merge_pr(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'pull_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const pullNumber = asInt(params.pull_number, null);
    if (!pullNumber || pullNumber <= 0) {
      return structuredError(params, 'invalid_input', 'pull_number must be a positive integer');
    }
    const mergeMethod = trim(params.merge_method) || trim(params.method) || 'merge'; // merge|squash|rebase
    const commitTitle = params.commit_title != null ? String(params.commit_title) : undefined;
    const commitMessage = params.commit_message != null ? String(params.commit_message) : undefined;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'PUT', `/repos/${repo}/pulls/${pullNumber}/merge`, {
      merge_method: mergeMethod,
      ...(commitTitle ? { commit_title: commitTitle } : {}),
      ...(commitMessage ? { commit_message: commitMessage } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, result: res.data };
  },

  async github_create_comment(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'issue_number', 'body']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const issueNumber = asInt(params.issue_number, null);
    if (!issueNumber || issueNumber <= 0) {
      return structuredError(params, 'invalid_input', 'issue_number must be a positive integer');
    }
    const body = String(params.body);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'POST', `/repos/${repo}/issues/${issueNumber}/comments`, { body });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, comment: res.data };
  },

  async github_list_issues(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const state = trim(params.state) || 'open';
    const labels = trim(params.labels);
    const assignee = trim(params.assignee);
    const creator = trim(params.creator);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const qs = new URLSearchParams();
    if (state) qs.set('state', state);
    if (labels) qs.set('labels', labels);
    if (assignee) qs.set('assignee', assignee);
    if (creator) qs.set('creator', creator);
    const res = await ghPaged(t.token, `/repos/${repo}/issues?${qs.toString()}`, 3);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const list = Array.isArray(res.data) ? res.data : [];
    // Filter out PRs (GitHub represents PRs in issues list with pull_request field)
    const issues = list.filter((x) => !x?.pull_request);
    return { success: true, issues };
  },

  async github_get_issue(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'issue_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const issueNumber = asInt(params.issue_number, null);
    if (!issueNumber || issueNumber <= 0) {
      return structuredError(params, 'invalid_input', 'issue_number must be a positive integer');
    }
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/issues/${issueNumber}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, issue: res.data };
  },

  async github_create_issue(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'title']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const title = String(params.title).trim();
    const body = params.body != null ? String(params.body) : undefined;
    const labels = Array.isArray(params.labels) ? params.labels : undefined;
    const assignees = Array.isArray(params.assignees) ? params.assignees : undefined;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'POST', `/repos/${repo}/issues`, {
      title,
      ...(body != null ? { body } : {}),
      ...(labels ? { labels } : {}),
      ...(assignees ? { assignees } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, issue: res.data };
  },

  async github_update_issue(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'issue_number']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const issueNumber = asInt(params.issue_number, null);
    if (!issueNumber || issueNumber <= 0) {
      return structuredError(params, 'invalid_input', 'issue_number must be a positive integer');
    }
    const body = {};
    if (params.title != null) body.title = String(params.title);
    if (params.body != null) body.body = String(params.body);
    if (params.state != null) body.state = String(params.state);
    if (Array.isArray(params.labels)) body.labels = params.labels;
    if (Array.isArray(params.assignees)) body.assignees = params.assignees;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'PATCH', `/repos/${repo}/issues/${issueNumber}`, body);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, issue: res.data };
  },

  async github_close_issue(params, env) {
    return await handlers.github_update_issue({ ...params, state: 'closed' }, env);
  },

  async github_search_code(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'q']);
    if (missing.length) return missingRequiredInput(params, missing);
    const built = buildGithubSearchQuery(params);
    if (built.success === false || built.error) return { ...built, ...toolMeta(params) };
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    return githubSearchWithCache(params, 'code', env, built.q, async () => {
      const res = await ghJson(
        t.token,
        'GET',
        `/search/code?q=${encodeURIComponent(built.q)}`,
        null,
      );
      if (res?.success === false) return { ...res, ...toolMeta(params), query: built.q };
      return { success: true, query: built.q, results: res.data };
    });
  },

  async github_search_issues_prs(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'q']);
    if (missing.length) return missingRequiredInput(params, missing);
    const built = buildGithubSearchQuery(params);
    if (built.success === false || built.error) return { ...built, ...toolMeta(params) };
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    return githubSearchWithCache(params, 'issues', env, built.q, async () => {
      const res = await ghJson(
        t.token,
        'GET',
        `/search/issues?q=${encodeURIComponent(built.q)}`,
        null,
      );
      if (res?.success === false) return { ...res, ...toolMeta(params), query: built.q };
      return { success: true, query: built.q, results: res.data };
    });
  },

  async github_list_branches(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghPaged(t.token, `/repos/${repo}/branches`, 3);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, branches: Array.isArray(res.data) ? res.data : [] };
  },

  async github_list_commits(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const limit = Math.min(100, Math.max(1, asInt(params.limit, asInt(params.per_page, 30))));
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const refRes = await resolveBranchOrDefault(t.token, repo, params, [
      params.sha,
      params.ref,
      params.branch,
    ]);
    if (refRes.success === false || refRes.error) return refRes;
    const ref = refRes.branch;
    const qs = new URLSearchParams();
    qs.set('per_page', String(Math.min(limit, 100)));
    if (ref) qs.set('sha', ref);
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/commits?${qs.toString()}`, null);
    if (res?.success === false) return { ...res, repo, ref, ...toolMeta(params) };
    const rows = Array.isArray(res.data) ? res.data.slice(0, limit) : [];
    const commits = rows.map((row) => ({
      sha: row?.sha ?? null,
      short_sha: row?.sha ? String(row.sha).slice(0, 7) : null,
      message: String(row?.commit?.message || '')
        .split('\n')[0]
        .trim(),
      author: row?.commit?.author?.name ?? row?.author?.login ?? null,
      date: row?.commit?.author?.date ?? null,
      html_url: row?.html_url ?? null,
    }));
    return { success: true, repo, ref, commits };
  },

  async github_create_branch(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'base', 'name']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const base = trim(params.base); // base branch name or SHA
    const name = trim(params.name);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;

    // Resolve base to SHA if it looks like a branch name.
    let sha = base;
    if (!/^[a-f0-9]{40}$/i.test(base)) {
      const refRes = await ghJson(t.token, 'GET', `/repos/${repo}/git/refs/heads/${encodeURIComponent(base)}`, null);
      if (refRes?.success === false) return { ...refRes, ...toolMeta(params) };
      sha = refRes.data?.object?.sha || '';
    }
    if (!trim(sha)) return structuredError(params, 'github_branch_create_failed', 'Unable to resolve base ref SHA');

    const res = await ghJson(t.token, 'POST', `/repos/${repo}/git/refs`, {
      ref: `refs/heads/${name}`,
      sha,
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, ref: res.data };
  },

  async github_delete_branch(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'branch']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const branch = trim(params.branch);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'DELETE', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true };
  },

  async github_get_commit(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'sha']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const sha = trim(params.sha);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/commits/${encodeURIComponent(sha)}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, commit: res.data };
  },

  async github_compare_commits(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'base', 'head']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const base = trim(params.base);
    const head = trim(params.head);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(
      t.token,
      'GET',
      `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      null,
    );
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, compare: res.data };
  },

  async github_list_workflow_runs(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const branch = trim(params.branch);
    const workflowId = trim(params.workflow_id);
    const status = trim(params.status);
    const event = trim(params.event);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const qs = new URLSearchParams();
    if (branch) qs.set('branch', branch);
    if (status) qs.set('status', status);
    if (event) qs.set('event', event);
    const path = workflowId
      ? `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${qs.toString()}`
      : `/repos/${repo}/actions/runs?${qs.toString()}`;
    const res = await ghJson(t.token, 'GET', path, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, runs: res.data?.workflow_runs || res.data?.runs || [] };
  },

  async github_get_workflow_run(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'run_id']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const runId = asInt(params.run_id, null);
    if (!runId || runId <= 0) return structuredError(params, 'invalid_input', 'run_id must be a positive integer');
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/actions/runs/${runId}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, run: res.data };
  },

  async github_list_workflow_jobs(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'run_id']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const runId = asInt(params.run_id, null);
    if (!runId || runId <= 0) return structuredError(params, 'invalid_input', 'run_id must be a positive integer');
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/actions/runs/${runId}/jobs`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, jobs: res.data?.jobs || [] };
  },

  async github_get_job_logs(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'job_id']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const jobId = asInt(params.job_id, null);
    if (!jobId || jobId <= 0) return structuredError(params, 'invalid_input', 'job_id must be a positive integer');
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${jobId}/logs`, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Authorization: `Bearer ${t.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'InnerAnimalMedia-AgentSam',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return structuredError(params, 'github_api_error', `GitHub GET job logs → ${res.status}: ${detail.slice(0, 200)}`);
    }
    const text = await res.text().catch(() => '');
    return { success: true, log: text };
  },

  async github_get_commit_status(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'sha']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const sha = trim(params.sha);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}/commits/${encodeURIComponent(sha)}/status`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, status: res.data };
  },

  async github_set_commit_status(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo', 'sha', 'state']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const sha = trim(params.sha);
    const state = trim(params.state);
    const context = trim(params.context) || 'agentsam';
    const description = params.description != null ? String(params.description) : undefined;
    const target_url = params.target_url != null ? String(params.target_url) : undefined;
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'POST', `/repos/${repo}/statuses/${encodeURIComponent(sha)}`, {
      state,
      context,
      ...(description != null ? { description } : {}),
      ...(target_url != null ? { target_url } : {}),
    });
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    return { success: true, status: res.data };
  },

  async github_check_permission(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const perms = res.data?.permissions || {};
    let permission = 'none';
    if (perms.admin) permission = 'admin';
    else if (perms.push) permission = 'write';
    else if (perms.pull) permission = 'read';
    return { success: true, permission, permissions: perms };
  },

  /**
   * Repository snapshot: full_name, default_branch, archived, private, permissions.
   * The missing "resolve scope before writes" primitive — call this before
   * create_branch / compare / create_pr when default_branch or archived state is unknown.
   */
  async github_get_repo(params, env) {
    const missing = missingNonEmptyStrings(params, ['user_id', 'repo']);
    if (missing.length) return missingRequiredInput(params, missing);
    const repo = trim(params.repo);
    const t = await ghGetToken(env, params);
    if (t.success === false || t.error) return t;
    const res = await ghJson(t.token, 'GET', `/repos/${repo}`, null);
    if (res?.success === false) return { ...res, ...toolMeta(params) };
    const data = res.data || {};
    const perms = data.permissions || {};
    let permission = 'none';
    if (perms.admin) permission = 'admin';
    else if (perms.push) permission = 'write';
    else if (perms.pull) permission = 'read';
    return {
      success: true,
      full_name: data.full_name || repo,
      default_branch: data.default_branch || null,
      private: data.private === true,
      archived: data.archived === true,
      disabled: data.disabled === true,
      permission,
      permissions: perms,
      html_url: data.html_url || null,
      description: data.description || null,
      pushed_at: data.pushed_at || null,
    };
  },
};
