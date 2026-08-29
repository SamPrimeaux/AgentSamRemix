/**
 * Reliable GitHub git in MY_CONTAINER / agentsam_terminal_sandbox.
 *
 * Containers have no SSH keys and no host gitconfig. This helper injects:
 * - Author identity from the signed-in user (never hardcoded)
 * - HTTPS token auth via url.insteadOf (OAuth/PAT from getUserGithubToken)
 * - Fail-loud when push/fetch needs auth but no token is available
 *
 * Prefer agentsam_terminal_remote (GCP SSH) for heavy ship lanes; this makes
 * ChatGPT/MCP sandbox git commit+push workable for small branch pushes.
 */
import { shellSingleQuote } from '../../backend/http/agentsam/routes/github-clone-parse.js';
import { getUserGithubToken } from '../integrations/github.js';
import { resolveOAuthAccessToken } from '../api/oauth.js';

const GIT_CMD_RE =
  /(^|[\s;&|])(git(\s|$)|gh(\s|$)|hub(\s|$))/i;
const GIT_AUTH_NEEDED_RE =
  /\bgit\s+(push|fetch|pull|clone|ls-remote|remote\s+update|submodule\s+update)\b/i;
const GIT_COMMIT_RE = /\bgit\s+commit\b/i;

/**
 * @param {string} command
 */
export function commandLooksLikeGit(command) {
  return GIT_CMD_RE.test(String(command || ''));
}

/**
 * @param {string} command
 */
export function commandNeedsGithubAuth(command) {
  return GIT_AUTH_NEEDED_RE.test(String(command || ''));
}

/**
 * @param {string} command
 */
export function commandNeedsGitAuthor(command) {
  return GIT_COMMIT_RE.test(String(command || '')) || commandNeedsGithubAuth(command);
}

/**
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {{ email?: string|null, display_name?: string|null, displayName?: string|null, name?: string|null }|null} [authUser]
 * @returns {Promise<{ name: string, email: string, source: string }|null>}
 */
export async function resolveGitAuthorIdentity(env, userId, authUser = null) {
  const fromAuth = {
    name: String(authUser?.display_name || authUser?.displayName || authUser?.name || '').trim(),
    email: String(authUser?.email || '').trim().toLowerCase(),
  };
  if (fromAuth.name && fromAuth.email && fromAuth.email.includes('@')) {
    return { name: fromAuth.name, email: fromAuth.email, source: 'auth_user' };
  }

  const uid = userId != null ? String(userId).trim() : '';
  if (uid && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT display_name, name, email FROM auth_users WHERE id = ? LIMIT 1`,
      )
        .bind(uid)
        .first();
      const name = String(row?.display_name || row?.name || '').trim() || 'Agent Sam';
      const email = String(row?.email || '').trim().toLowerCase();
      if (email && email.includes('@')) {
        return { name, email, source: 'auth_users' };
      }
    } catch (e) {
      console.warn('[sandbox-github-git] author lookup', e?.message ?? e);
    }
  }

  if (fromAuth.email && fromAuth.email.includes('@')) {
    return {
      name: fromAuth.name || 'Agent Sam',
      email: fromAuth.email,
      source: 'auth_user_email_only',
    };
  }
  return null;
}

/**
 * @param {any} env
 * @param {string|null|undefined} userId
 * @returns {Promise<{ token: string, mode: string, account_identifier: string }|null>}
 */
export async function resolveSandboxGithubToken(env, userId) {
  const uid = userId != null ? String(userId).trim() : '';
  if (!uid) return null;
  try {
    const row = await getUserGithubToken(env, uid, '');
    if (!row) return null;
    let token = row.token != null ? String(row.token).trim() : '';
    if (!token && row.access_token) {
      token = String(await resolveOAuthAccessToken(env, row) || '').trim();
    }
    if (!token) return null;
    return {
      token,
      mode: String(row.mode || 'oauth'),
      account_identifier: String(row.account_identifier || row.provider_account_id || ''),
    };
  } catch (e) {
    console.warn('[sandbox-github-git] token resolve', e?.message ?? e);
    return null;
  }
}

/**
 * Shell preamble: identity + HTTPS token rewrite for github.com.
 * Safe to prepend once per sandbox exec. Token never echoed to stdout.
 *
 * @param {{
 *   name?: string|null,
 *   email?: string|null,
 *   token?: string|null,
 *   requireToken?: boolean,
 *   requireAuthor?: boolean,
 * }} opts
 */
export function buildSandboxGithubGitPreamble(opts = {}) {
  const name = String(opts.name || '').trim();
  const email = String(opts.email || '').trim();
  const token = String(opts.token || '').trim();
  const requireToken = opts.requireToken === true;
  const requireAuthor = opts.requireAuthor === true;

  const nameQ = shellSingleQuote(name || 'Agent Sam');
  const emailQ = shellSingleQuote(email || '');
  const tokenQ = token ? shellSingleQuote(token) : "''";

  return `
# iam sandbox-github-git-helper — identity + HTTPS token for github.com
export GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=${nameQ}
export GIT_COMMITTER_NAME=${nameQ}
${email ? `export GIT_AUTHOR_EMAIL=${emailQ}
export GIT_COMMITTER_EMAIL=${emailQ}
git config --global user.name ${nameQ} 2>/dev/null || true
git config --global user.email ${emailQ} 2>/dev/null || true` : `# no author email resolved`}
export GITHUB_TOKEN=${tokenQ}
if [ -n "$GITHUB_TOKEN" ]; then
  # Prefer HTTPS+token over missing container SSH keys
  git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "git@github.com:"
  git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "ssh://git@github.com/"
  git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  git config --global credential.helper "" 2>/dev/null || true
fi
${requireAuthor && !email ? `echo "IAM_GIT_ERR:author_identity_missing — no auth_users.email for this session" >&2; exit 42` : 'true'}
${requireToken && !token ? `echo "IAM_GIT_ERR:github_token_missing — reconnect GitHub OAuth (Keys) or use agentsam_terminal_remote on GCP" >&2; exit 43` : 'true'}
`.trim();
}

/**
 * Resolve identity + token and build preamble for a sandbox command.
 * Returns null when command is not git-related (caller should skip).
 *
 * @param {any} env
 * @param {{
 *   command: string,
 *   userId?: string|null,
 *   authUser?: object|null,
 * }} opts
 */
export async function resolveSandboxGithubGitPreamble(env, opts) {
  const command = String(opts.command || '');
  if (!commandLooksLikeGit(command)) {
    return { applied: false, preamble: '', reason: 'not_git' };
  }

  const needsAuth = commandNeedsGithubAuth(command);
  const needsAuthor = commandNeedsGitAuthor(command);
  const author = await resolveGitAuthorIdentity(env, opts.userId, opts.authUser || null);
  const tok = needsAuth || needsAuthor ? await resolveSandboxGithubToken(env, opts.userId) : null;

  const preamble = buildSandboxGithubGitPreamble({
    name: author?.name || null,
    email: author?.email || null,
    token: tok?.token || null,
    requireToken: needsAuth,
    requireAuthor: needsAuthor && GIT_COMMIT_RE.test(command),
  });

  return {
    applied: true,
    preamble,
    reason: 'git',
    has_token: !!tok?.token,
    has_author: !!(author?.email),
    author_source: author?.source || null,
    token_mode: tok?.mode || null,
    needs_auth: needsAuth,
    needs_author: needsAuthor,
  };
}
