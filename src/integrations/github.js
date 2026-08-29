import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { resolveCanonicalUserId } from '../../backend/identity/users/index.js';
import { decryptWithVault } from '../../backend/identity/oauth/token-store.js';
import { getIntegrationToken } from './tokens.js';
import {
  getIntegrationOAuthRow,
  resolveOAuthAccessToken,
} from '../../backend/identity/oauth/user-token.js';
import { resolveIntegrationUserId, githubPrivateResponse } from '../../backend/identity/oauth/integration-user-id.js';
import {
  filterGithubReposListForUserAsync,
  GITHUB_USER_REPOS_AFFILIATION,
} from '../core/github-repos-list-filter.js';

/**
 * GitHub Service Integration.
 * Handles repository discovery, file operations, and API proxying.
 */

/**
 * Main dispatcher for GitHub-related API requests.
 */
export async function handleGitHubApi(request, env) {
    const url = new URL(request.url);
    const pathLower = url.pathname.toLowerCase();
    const method = request.method.toUpperCase();

    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const integrationUserId = await resolveIntegrationUserId(env, authUser);
    if (!integrationUserId) return jsonResponse({ error: 'Unauthorized' }, 401);

    const tokenRow = await getIntegrationToken(env, integrationUserId, 'github', '');
    const ghAccess = await resolveOAuthAccessToken(env, tokenRow);
    if (!ghAccess) return jsonResponse({ error: 'GitHub account not linked' }, 403);

    // ── GET /api/agent/github/repos ──────────────────────────────────────────
    if (pathLower === '/api/agent/github/repos' && method === 'GET') {
        try {
            const accountLogin = tokenRow?.account_identifier != null
              ? String(tokenRow.account_identifier).trim()
              : '';
            const response = await fetch(
              `https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=${GITHUB_USER_REPOS_AFFILIATION}`,
              {
                headers: {
                    'Authorization': `Bearer ${ghAccess}`,
                    'User-Agent': 'AgentSam-Dashboard',
                    'Accept': 'application/vnd.github.v3+json'
                }
              },
            );
            const repos = await response.json();
            const raw = Array.isArray(repos) ? repos : [];
            const scoped = await filterGithubReposListForUserAsync(env, raw, accountLogin, {
              allowPlatformRepos: false,
            });
            return jsonResponse({ repos: scoped });
        } catch (e) {
            return jsonResponse({ error: 'GitHub fetch failed', detail: e.message }, 500);
        }
    }

    // ── GET /api/agent/github/file ───────────────────────────────────────────
    if (pathLower === '/api/agent/github/file' && method === 'GET') {
        const repo = url.searchParams.get('repo');
        const path = url.searchParams.get('path');
        if (!repo || !path) return jsonResponse({ error: 'repo and path required' }, 400);

        try {
            const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                headers: {
                    'Authorization': `Bearer ${ghAccess}`,
                    'User-Agent': 'AgentSam-Dashboard',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });
            const content = await response.text();
            return new Response(content, { headers: { 'Content-Type': 'text/plain' } });
        } catch (e) {
            return jsonResponse({ error: 'Failed to fetch GitHub file', detail: e.message }, 500);
        }
    }

    return jsonResponse({ error: 'GitHub route not found' }, 404);
}

// ─── WebCrypto JWT (RS256) for GitHub App auth ───────────────────────────────

async function importAppPrivateKey(pem) {
  const stripped = pem
    .replace(/-----BEGIN[^-]+-----/, '')
    .replace(/-----END[^-]+-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function b64url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function signAppJwt(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 540, iss: String(appId) };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const key = await importAppPrivateKey(pem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${sigB64}`;
}

async function getAppInstallationToken(env, owner) {
  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);

  // Find installation ID for this owner/org
  const instRes = await fetch('https://api.github.com/app/installations', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'InnerAnimalMedia-AgentSam',
    },
  });
  if (!instRes.ok) throw new Error(`App installations lookup failed: ${instRes.status}`);
  const installations = await instRes.json();

  const match = owner
    ? installations.find((i) => i.account?.login?.toLowerCase() === owner.toLowerCase())
    : installations[0];
  if (!match) throw new Error(`No GitHub App installation found for owner: ${owner}`);

  // Exchange for installation access token
  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${match.id}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'InnerAnimalMedia-AgentSam',
      },
    }
  );
  if (!tokenRes.ok) throw new Error(`Installation token exchange failed: ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  return token;
}

// ─── Token resolution (user OAuth → App; admin PAT is separate) ─────────────

/** Admin / internal tooling only — never use for user-facing repo listing. */
export function getAdminGithubToken(env) {
  const token = typeof env?.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
  if (!token) return null;
  return { token, mode: 'pat' };
}

async function decryptUserApiKeyValue(env, row, userId) {
  if (!row || !env?.DB) return null;
  const uid = String(userId || '').trim();
  if (!uid) return null;
  if (row.vault_secret_id) {
    const secretRow = await env.DB.prepare(
      `SELECT secret_value_encrypted FROM user_secrets
       WHERE id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(String(row.vault_secret_id), uid)
      .first();
    if (secretRow?.secret_value_encrypted) {
      const decrypted = await decryptWithVault(env, secretRow.secret_value_encrypted);
      if (decrypted) return String(decrypted).trim() || null;
    }
  }
  if (row.encrypted_value) {
    const { getAESKey, aesGcmDecryptFromB64 } = await import('../../backend/credentials/crypto-vault.js');
    const aesKey = await getAESKey(env, ['decrypt']);
    const decrypted = await aesGcmDecryptFromB64(row.encrypted_value, aesKey);
    if (decrypted) return String(decrypted).trim() || null;
  }
  if (row.key_hash) {
    const { getAESKey, aesGcmDecryptFromB64 } = await import('../../backend/credentials/crypto-vault.js');
    const aesKey = await getAESKey(env, ['decrypt']);
    const decrypted = await aesGcmDecryptFromB64(row.key_hash, aesKey);
    if (decrypted) return String(decrypted).trim() || null;
  }
  return null;
}

/**
 * BYOK GitHub PAT from Keys & Secrets (user_secrets).
 * @param {string} providerAccountId — optional GitHub login filter
 */
async function resolveGithubByokToken(env, userId, providerAccountId = '') {
  if (!env?.DB || !userId) return null;
  const uid = String(userId).trim();
  if (!uid) return null;
  const accountFilter = providerAccountId != null ? String(providerAccountId).trim() : '';

  const row = await env.DB.prepare(
    `SELECT id, secret_value_encrypted, metadata_json
       FROM user_secrets
      WHERE user_id = ?
        AND COALESCE(is_active, 1) = 1
        AND (
          LOWER(COALESCE(service_name, '')) = 'github'
          OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = 'github'
        )
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(uid)
    .first()
    .catch(() => null);
  if (!row?.secret_value_encrypted) return null;

  const token = await decryptWithVault(env, row.secret_value_encrypted);
  if (!token) return null;
  const tokenStr = String(token).trim();
  if (!tokenStr) return null;

  let login = '';
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenStr}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'InnerAnimalMedia-GitHubBYOK/1.0',
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.login) login = String(data.login).trim();
  } catch {
    /* token may still work for repo calls */
  }

  if (accountFilter && login && login.toLowerCase() !== accountFilter.toLowerCase()) {
    return null;
  }

  return {
    token: tokenStr,
    mode: 'byok',
    account_identifier: login || accountFilter,
    provider_account_id: login || accountFilter,
    api_key_id: row.id != null ? String(row.id) : null,
  };
}

/**
 * Per-user GitHub token: OAuth/PAT in `user_oauth_tokens`, then BYOK in Keys & Secrets.
 * @param {string} providerAccountId — `account_identifier` / `?account=` login for multi-account rows
 */
export async function getUserGithubToken(env, userId, providerAccountId = '') {
  if (!env?.DB || !userId) return null;
  const raw = String(userId).trim();
  if (!raw) return null;
  let uid = null;
  try {
    uid = await resolveCanonicalUserId(raw, env);
  } catch {
    uid = null;
  }
  // OAuth rows are keyed by auth_users.id only — refuse usr_*/email/other planes.
  if (!uid || !String(uid).startsWith('au_')) return null;
  uid = String(uid).trim();
  const account = providerAccountId != null ? String(providerAccountId) : '';
  const row = await getIntegrationOAuthRow(env, uid, 'github', account);
  if (row) {
    const token = row.access_token || (await resolveOAuthAccessToken(env, row));
    if (token) {
      const accountId = row.account_identifier != null ? String(row.account_identifier) : '';
      const authMethod =
        row.metadata_json && String(row.metadata_json).includes('pat') ? 'pat' : 'oauth';
      return {
        token,
        mode: authMethod === 'pat' ? 'pat' : 'oauth',
        account_identifier: accountId,
        provider_account_id: accountId,
      };
    }
  }
  return resolveGithubByokToken(env, uid, account);
}

export function githubReposCacheKey(userId, providerAccountId, workspaceId) {
  const uid = String(userId || '').trim() || '_';
  const acct = String(providerAccountId || '').trim() || '_';
  const ws = String(workspaceId || '').trim() || '_';
  return `github:repos:v2:${uid}:${acct}:${ws}`;
}

async function scopeGithubReposListForAuthUser(env, list, userLogin, authUser) {
  return filterGithubReposListForUserAsync(env, list, userLogin, { allowPlatformRepos: false });
}

function githubReposDebugEnabled(env) {
  const envName = String(env?.ENVIRONMENT || env?.ENV || '').toLowerCase();
  return envName === 'development' || envName === 'dev' || env?.GITHUB_REPOS_DEBUG === '1';
}

/**
 * Platform GitHub App installation token — internal automation only.
 * Never use for authenticated user-facing repo/file routes.
 */
export async function resolveGitHubAppInstallationToken(env, owner) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error('GitHub App credentials not configured');
  }
  const token = await getAppInstallationToken(env, owner);
  return { token, mode: 'app' };
}

const GH_USER_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'IAM-Platform',
};

/** Verify OAuth token belongs to the stored account_identifier (fail closed on mismatch). */
async function assertGitHubTokenOwner(token, accountIdentifier) {
  const res = await fetch('https://api.github.com/user', {
    headers: { ...GH_USER_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = await res.json().catch(() => ({}));
  const login = body?.login != null ? String(body.login).trim() : '';
  const expected = accountIdentifier != null ? String(accountIdentifier).trim() : '';
  if (expected && login && login.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, mismatch: true, login, expected };
  }
  return { ok: true, login };
}

/**
 * GET /api/integrations/github/repos — session user token only; 401 when not connected.
 */
export async function handleGithubReposList(request, env, authUser, urlIn) {
  const url = urlIn || new URL(request.url);
  if (!authUser) return githubPrivateResponse({ error: 'unauthorized' }, 401);

  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return githubPrivateResponse({ error: 'unauthorized' }, 401);

  const accountParam = url.searchParams.get('account') || '';
  const workspaceId =
    authUser.workspace_id != null && String(authUser.workspace_id).trim() !== ''
      ? String(authUser.workspace_id).trim()
      : (url.searchParams.get('workspace_id') || '');

  const tokenResult = await getUserGithubToken(env, userId, accountParam);
  if (!tokenResult?.token) {
    return githubPrivateResponse({ error: 'github_not_connected' }, 401);
  }

  const providerAccountId = tokenResult.provider_account_id || accountParam || tokenResult.account_identifier || '';
  const cacheKey = githubReposCacheKey(userId, providerAccountId, workspaceId);

  if (env?.SESSION_CACHE?.get) {
    try {
      const cached = await env.SESSION_CACHE.get(cacheKey, 'json');
      if (Array.isArray(cached)) {
        const scopedCached = await scopeGithubReposListForAuthUser(
          env,
          cached,
          tokenResult.account_identifier || accountParam || '',
          authUser,
        );
        if (githubReposDebugEnabled(env)) {
          console.log('[github/repos] cache_hit', {
            user_id: userId,
            provider_account_id: providerAccountId,
            account_login: tokenResult.account_identifier || null,
            repo_count: scopedCached.length,
          });
        }
        return githubPrivateResponse(scopedCached);
      }
    } catch (_) { /* non-fatal */ }
  }

  const identity = await assertGitHubTokenOwner(tokenResult.token, tokenResult.account_identifier);
  if (!identity.ok) {
    if (identity.mismatch) {
      console.warn('[github/repos] token_account_mismatch', {
        user_id: userId,
        expected: identity.expected,
        actual: identity.login,
      });
      return githubPrivateResponse({ error: 'github_token_mismatch' }, 401);
    }
    return githubPrivateResponse(
      { error: 'github_api_error', status: identity.status || 502 },
      identity.status >= 400 && identity.status < 500 ? identity.status : 502,
    );
  }

  const res = await fetch(
    `https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=${GITHUB_USER_REPOS_AFFILIATION}`,
    {
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        ...GH_USER_HEADERS,
      },
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    return githubPrivateResponse(
      { error: 'github_api_error', status: res.status, detail: detail.slice(0, 500) },
      status,
    );
  }

  const repos = await res.json();
  const rawList = Array.isArray(repos) ? repos : [];
  const list = await scopeGithubReposListForAuthUser(
    env,
    rawList,
    identity.login || tokenResult.account_identifier || '',
    authUser,
  );

  if (env?.SESSION_CACHE?.put) {
    try {
      await env.SESSION_CACHE.put(cacheKey, JSON.stringify(list), { expirationTtl: 120 });
    } catch (_) { /* non-fatal */ }
  }

  if (githubReposDebugEnabled(env)) {
    console.log('[github/repos]', {
      user_id: userId,
      provider_account_id: providerAccountId,
      account_login: identity.login || tokenResult.account_identifier || null,
      repo_count: list.length,
      raw_repo_count: rawList.length,
    });
  }

  return githubPrivateResponse(list);
}

// ─── Git Data API Helpers ─────────────────────────────────────────────────────

async function ghFetch(token, method, path, body) {
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
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${json.message ?? JSON.stringify(json)}`);
  }
  return json;
}

// ─── SHA Handshake Commit ─────────────────────────────────────────────────────

/**
 * Performs a full 6-step Git Data API commit:
 *   1. Get Ref        → current branch SHA
 *   2. Get Commit     → parent tree SHA
 *   3. Create Blob    → upload file content
 *   4. Create Tree    → new tree with blob
 *   5. Create Commit  → new commit pointing to new tree
 *   6. Patch Ref      → advance branch pointer
 *
 * @param {object} env         - Worker env bindings
 * @param {object} authUser    - Authenticated user (for OAuth lookup)
 * @param {string} repo        - "owner/repo"
 * @param {object} opts
 * @param {string} opts.branch        - Target branch (default: repo default)
 * @param {string} opts.path          - File path in repo
 * @param {string} opts.content       - UTF-8 file content
 * @param {string} opts.message       - Commit message
 * @param {string} [opts.committer]   - Optional committer name
 * @returns {{ sha, url, mode }} - New commit SHA, HTML URL, and auth mode used
 */
export async function githubCommitHandshake(env, authUser, repo, opts) {
  const { path: filePath, content, message } = opts;
  if (!repo || !filePath || !content || !message) {
    throw new Error('repo, path, content, and message are all required');
  }

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error(`Invalid repo format — expected "owner/repo", got "${repo}"`);

  const { token, account_identifier: accountId } = (await getUserGithubToken(env, await resolveIntegrationUserId(env, authUser), '')) || {};
  if (!token) {
    throw new Error('No GitHub auth resolved — connect GitHub OAuth');
  }
  const identity = await assertGitHubTokenOwner(token, accountId);
  if (!identity.ok) {
    throw new Error(identity.mismatch ? 'GitHub token does not match connected account' : 'GitHub token invalid');
  }
  const mode = 'oauth';

  // Resolve branch — use specified or fall back to repo default
  let branch = opts.branch;
  if (!branch) {
    const repoMeta = await ghFetch(token, 'GET', `/repos/${repo}`);
    branch = repoMeta.default_branch;
  }

  // Step 1: Get current ref → branch tip SHA
  const refData = await ghFetch(token, 'GET', `/repos/${repo}/git/refs/heads/${branch}`);
  const latestSha = refData.object.sha;

  // Step 2: Get commit → parent tree SHA
  const commitData = await ghFetch(token, 'GET', `/repos/${repo}/git/commits/${latestSha}`);
  const baseTreeSha = commitData.tree.sha;

  // Step 3: Create blob (base64-encoded content)
  const blobData = await ghFetch(token, 'POST', `/repos/${repo}/git/blobs`, {
    content: btoa(unescape(encodeURIComponent(content))),
    encoding: 'base64',
  });

  // Step 4: Create new tree with blob at target path
  const treeData = await ghFetch(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: [
      {
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      },
    ],
  });

  // Step 5: Create new commit
  const newCommitData = await ghFetch(token, 'POST', `/repos/${repo}/git/commits`, {
    message,
    tree: treeData.sha,
    parents: [latestSha],
    ...(opts.committer && {
      committer: {
        name: opts.committer,
        email:
          (typeof opts.committerEmail === 'string' && opts.committerEmail.trim()) ||
          (typeof env?.GITHUB_COMMITTER_EMAIL === 'string' && env.GITHUB_COMMITTER_EMAIL.trim()) ||
          (typeof env?.EMAIL_FROM === 'string' && env.EMAIL_FROM.includes('<') ? env.EMAIL_FROM.split('<')[1].split('>')[0].trim() : '') ||
          (typeof env?.RESEND_FROM === 'string' && env.RESEND_FROM.includes('<') ? env.RESEND_FROM.split('<')[1].split('>')[0].trim() : '') ||
          undefined,
      },
    }),
  });

  // Step 6: Advance branch ref to new commit
  await ghFetch(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, {
    sha: newCommitData.sha,
    force: false,
  });

  return {
    sha: newCommitData.sha,
    url: newCommitData.html_url,
    branch,
    mode,
  };
}

/**
 * Atomic multi-file commit via Git Data API (blobs → tree → commit → ref).
 * @param {string} token
 * @param {string} repo owner/repo
 * @param {{ branch?: string, message: string, files: Array<{ path: string, content: string }>, committer?: string, committerEmail?: string }} opts
 * @param {object} [env]
 */
export async function githubCommitTreeWithToken(token, repo, opts, env = null) {
  const message = String(opts?.message || '').trim();
  const files = Array.isArray(opts?.files) ? opts.files : [];
  if (!repo || !message || !files.length) {
    throw new Error('repo, message, and files[] are required');
  }
  if (files.length > 50) {
    throw new Error('files array max is 50 paths per commit');
  }

  let branch = opts.branch ? String(opts.branch).trim() : '';
  if (!branch) {
    const repoMeta = await ghFetch(token, 'GET', `/repos/${repo}`);
    branch = repoMeta.default_branch;
  }

  const refData = await ghFetch(token, 'GET', `/repos/${repo}/git/refs/heads/${branch}`);
  const latestSha = refData.object.sha;
  const commitData = await ghFetch(token, 'GET', `/repos/${repo}/git/commits/${latestSha}`);
  const baseTreeSha = commitData.tree.sha;

  const treeEntries = [];
  for (const f of files) {
    const filePath = String(f?.path || '').trim().replace(/^\/+/, '');
    if (!filePath || f?.content == null) {
      throw new Error('each file requires path and content');
    }
    const blobData = await ghFetch(token, 'POST', `/repos/${repo}/git/blobs`, {
      content: btoa(unescape(encodeURIComponent(String(f.content)))),
      encoding: 'base64',
    });
    treeEntries.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha,
    });
  }

  const treeData = await ghFetch(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const committerName = opts.committer ? String(opts.committer).trim() : '';
  const newCommitData = await ghFetch(token, 'POST', `/repos/${repo}/git/commits`, {
    message,
    tree: treeData.sha,
    parents: [latestSha],
    ...(committerName
      ? {
          committer: {
            name: committerName,
            email:
              (typeof opts.committerEmail === 'string' && opts.committerEmail.trim()) ||
              (typeof env?.GITHUB_COMMITTER_EMAIL === 'string' && env.GITHUB_COMMITTER_EMAIL.trim()) ||
              undefined,
          },
        }
      : {}),
  });

  await ghFetch(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, {
    sha: newCommitData.sha,
    force: false,
  });

  return {
    sha: newCommitData.sha,
    url: newCommitData.html_url,
    branch,
    file_count: treeEntries.length,
    paths: treeEntries.map((e) => e.path),
  };
}

// ─── /api/integrations/* dispatcher ──────────────────────────────────────────

/** OAuth rows in `user_oauth_tokens` are keyed by `auth_users.id` only. */
function oauthTokenUserKey(authUser) {
  const sid = authUser?.id != null && String(authUser.id).trim() !== '' ? String(authUser.id).trim() : '';
  return sid.startsWith('au_') ? sid : '';
}

export async function handleGithubApi(request, env, authUser) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/integrations/status') {
    if (!authUser) return jsonResponse({ google: false, github: false, github_accounts: [] });
    const integrationUid = (await resolveIntegrationUserId(env, authUser)) || oauthTokenUserKey(authUser);
    if (!integrationUid) {
      return jsonResponse({ google: false, github: false, github_accounts: [], error: 'auth_user_id_required' });
    }
    let google = false;
    let github = false;
    const githubAccounts = [];
    try {
      const result = await env.DB.prepare(
        `SELECT provider, account_identifier FROM user_oauth_tokens WHERE user_id = ?`
      ).bind(integrationUid).all();
      for (const r of result.results || []) {
        if (r.provider === 'google_drive') google = true;
        if (r.provider === 'github') {
          github = true;
          if (r.account_identifier) githubAccounts.push({ account_identifier: r.account_identifier });
        }
      }
    } catch (_) { }
    return jsonResponse({ google, github, github_accounts: githubAccounts });
  }

  if (!authUser) return jsonResponse({ error: 'unauthorized' }, 401);
  const integrationUid = (await resolveIntegrationUserId(env, authUser)) || oauthTokenUserKey(authUser);
  if (!integrationUid) return jsonResponse({ error: 'auth_user_id_required' }, 401);
  const githubAccount = url.searchParams.get('account') || '';

  if (method === 'GET' && path === '/api/integrations/gdrive/files') {
    const folderId = url.searchParams.get('folderId') || 'root';
    const tokenRow = await getIntegrationToken(env, integrationUid, 'google_drive', '');
    const gdBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!gdBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
    driveUrl.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    driveUrl.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
    driveUrl.searchParams.set('orderBy', 'name');
    const res = await fetch(driveUrl.toString(), {
      headers: { Authorization: `Bearer ${gdBearer}` }
    });
    return jsonResponse(await res.json());
  }

  if (method === 'GET' && path === '/api/integrations/gdrive/file') {
    const fileId = url.searchParams.get('fileId');
    const tokenRow = await getIntegrationToken(env, integrationUid, 'google_drive', '');
    const gdBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!gdBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${gdBearer}` } });
    return jsonResponse({ content: await res.text() });
  }

  // DEAD for production — /api/integrations/* is served by handleIntegrationsRequest (src/api/integrations.js).
  if (method === 'GET' && path === '/api/integrations/github/repos') {
    return handleGithubReposList(request, env, authUser, url);
  }

  if (method === 'GET' && path === '/api/integrations/github/files') {
    const repo = url.searchParams.get('repo');
    const filePath = url.searchParams.get('path') || '';
    const tokenRow = await getIntegrationToken(env, integrationUid, 'github', githubAccount);
    const ghBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!ghBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers: { Authorization: `Bearer ${ghBearer}`, 'User-Agent': 'IAM-Platform' } });
    return jsonResponse(await res.json());
  }

  if (method === 'GET' && path === '/api/integrations/github/file') {
    const repo = url.searchParams.get('repo');
    const filePath = url.searchParams.get('path');
    const tokenRow = await getIntegrationToken(env, integrationUid, 'github', githubAccount);
    const ghBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!ghBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers: { Authorization: `Bearer ${ghBearer}`, 'User-Agent': 'IAM-Platform' } });
    const data = await res.json();
    const content = atob((data.content || '').replace(/\n/g, ''));
    return jsonResponse({ content, sha: data.sha, name: data.name });
  }

  if (method === 'GET' && path === '/api/integrations/github/raw') {
    const repo = url.searchParams.get('repo');
    const filePath = url.searchParams.get('path');
    if (!repo || !filePath) return jsonResponse({ error: 'missing repo or path' }, 400);
    const tokenRow = await getIntegrationToken(env, integrationUid, 'github', githubAccount);
    const ghBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!ghBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const res = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(repo)}/HEAD/${filePath.split('/').map(p => encodeURIComponent(p)).join('/')}`, { headers: { Authorization: `Bearer ${ghBearer}`, 'User-Agent': 'IAM-Platform' } });
    if (!res.ok) return jsonResponse({ error: res.statusText || 'Not found' }, res.status);
    const ext = (filePath || '').split('.').pop().toLowerCase();
    const ctMap = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json', md: 'text/markdown', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
    const contentType = ctMap[ext] || 'application/octet-stream';
    const headers = new Headers({ 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    return new Response(res.body, { status: 200, headers });
  }

  if (method === 'GET' && path === '/api/integrations/gdrive/raw') {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) return jsonResponse({ error: 'missing fileId' }, 400);
    const tokenRow = await getIntegrationToken(env, integrationUid, 'google_drive', '');
    const gdBearer = await resolveOAuthAccessToken(env, tokenRow);
    if (!gdBearer) return jsonResponse({ error: 'not_connected' }, 400);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${gdBearer}` } });
    if (!res.ok) return jsonResponse({ error: res.statusText || 'Not found' }, res.status);
    const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
    const headers = new Headers({ 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    return new Response(res.body, { status: 200, headers });
  }

  return jsonResponse({ error: 'Integration route not found' }, 404);
}
