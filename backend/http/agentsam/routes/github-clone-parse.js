const GITHUB_REF_RE =
  /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;

/**
 * @param {string} input
 * @returns {string|null} owner/repo
 */
export function parseGithubCloneRef(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/^clone\s+/i, '').trim();
  const candidate = stripped || raw;
  const m = candidate.match(GITHUB_REF_RE);
  if (!m) return null;
  const owner = String(m[1] || '').trim();
  const repo = String(m[2] || '').trim().replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

/**
 * @param {string} s
 */
export function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * @param {boolean} isGcp
 * @param {string|null|undefined} workspacesRoot
 * @param {string|null|undefined} existingWorkspaceRoot
 * @param {string|null|undefined} [gcpReposRoot] D1 tunnel_repos_root when isGcp
 */
export function resolveGithubCloneParentDir(isGcp, workspacesRoot, existingWorkspaceRoot, gcpReposRoot = null) {
  if (isGcp) {
    const fromD1 = gcpReposRoot != null ? String(gcpReposRoot).trim() : '';
    if (fromD1) return fromD1.replace(/\/+$/, '');
    return null;
  }
  const probeRoot = workspacesRoot != null ? String(workspacesRoot).trim() : '';
  if (probeRoot) return probeRoot.replace(/\/+$/, '');
  const existing = existingWorkspaceRoot != null ? String(existingWorkspaceRoot).trim().replace(/\/+$/, '') : '';
  if (existing) {
    const isWin = existing.includes('\\');
    const parts = existing.split(isWin ? /[/\\]/ : '/').filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const joined = parts.join(isWin ? '\\' : '/');
      return existing.startsWith('/') && !isWin ? `/${joined}` : joined;
    }
  }
  return '$HOME/Projects';
}

/**
 * @param {{ repoSlug: string, parentDir: string, token: string|null }}
 */
export function buildGithubCloneShell({ repoSlug, parentDir, token }) {
  const repoName = repoSlug.split('/').pop() || 'repo';
  const parentQ = shellSingleQuote(parentDir);
  const destNameQ = shellSingleQuote(repoName);
  const tokenQ = token ? shellSingleQuote(token) : "''";
  const httpsUrl = `https://github.com/${repoSlug}.git`;

  return `
set -euo pipefail
PARENT=${parentQ}
DEST_NAME=${destNameQ}
DEST="$PARENT/$DEST_NAME"
mkdir -p "$PARENT"
if [ -d "$DEST/.git" ]; then
  cd "$DEST"
  git fetch --depth 1 origin 2>/dev/null || git fetch origin
  DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' | head -1)"
  if [ -z "$DEFAULT_BRANCH" ] || [ "$DEFAULT_BRANCH" = "(unknown)" ]; then
    DEFAULT_BRANCH="$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
  fi
  if [ -z "$DEFAULT_BRANCH" ]; then DEFAULT_BRANCH=main; fi
  git checkout -q "$DEFAULT_BRANCH" 2>/dev/null || git checkout -q main 2>/dev/null || git checkout -q master 2>/dev/null || true
  git pull --ff-only 2>/dev/null || true
  echo "CLONE_OK:$DEST"
  exit 0
fi
if [ -e "$DEST" ]; then
  echo "CLONE_ERR:path_exists:$DEST" >&2
  exit 2
fi
export GITHUB_TOKEN=${tokenQ}
export GIT_TERMINAL_PROMPT=0
if [ -n "$GITHUB_TOKEN" ]; then
  AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${repoSlug}.git"
  git -c credential.helper= clone --depth 1 "$AUTH_URL" "$DEST"
else
  git clone --depth 1 ${shellSingleQuote(httpsUrl)} "$DEST"
fi
echo "CLONE_OK:$DEST"
`.trim();
}

/**
 * @param {string} output
 */
export function parseCloneShellResult(output) {
  const text = String(output || '');
  const ok = text.match(/CLONE_OK:([^\s]+)/);
  if (ok?.[1]) return { ok: true, repoPath: ok[1].trim() };
  const exists = text.match(/CLONE_ERR:path_exists:([^\s]+)/);
  if (exists?.[1]) return { ok: false, error: 'path_exists', repoPath: exists[1].trim() };
  if (/Authentication failed|invalid credentials|403|401/i.test(text)) {
    return { ok: false, error: 'github_auth_failed' };
  }
  if (/Repository not found/i.test(text)) {
    return { ok: false, error: 'repo_not_found' };
  }
  return { ok: false, error: 'clone_failed', detail: text.slice(0, 800) };
}
