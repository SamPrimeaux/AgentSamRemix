/**
 * Platform-owned workspace checkout inside MY_CONTAINER.
 * Canonical cwd for fs_* when Mac PTY is optional / unavailable (phone, Connor, Mac asleep).
 *
 * Disk law (spiked 2026-07-26): CF Container disk is ephemeral across sleep/restart;
 * warm consecutive /exec calls share the same disk. Sync TTL + cold re-clone required.
 */
import { tryContainerExec, CONTAINER_EXEC_COMMAND_TIMEOUT_MS } from '../../backend/agentsam/sandbox/my-container.js';
import { shellSingleQuote } from '../../backend/http/agentsam/routes/github-clone-parse.js';
import { getWorkspaceGithubRepo } from '../../backend/identity/workspace/agentsam-workspace.js';
import { getUserGithubToken } from '../integrations/github.js';

/** Default: pull at most once per 5 minutes per checkout (warm container). */
export const CONTAINER_FS_SYNC_TTL_SEC = 300;
/** Bump when sync semantics change so warm containers re-sync once (not silent stale HEAD). */
export const CONTAINER_FS_CHECKOUT_CONTRACT = 2;
const ENSURE_TIMEOUT_MS = Math.max(CONTAINER_EXEC_COMMAND_TIMEOUT_MS, 120_000);

/**
 * @param {string} workspaceId
 */
export function safeWorkspacePathSegment(workspaceId) {
  return String(workspaceId || 'ws')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 96) || 'ws';
}

/**
 * @param {string} repoSlug owner/name
 */
export function repoNameFromSlug(repoSlug) {
  const name = String(repoSlug || '')
    .split('/')
    .pop()
    ?.replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  return name || 'repo';
}

/**
 * Absolute checkout path inside MY_CONTAINER.
 * @param {string} workspaceId
 * @param {string} repoSlug
 */
export function containerWorkspaceCheckoutPath(workspaceId, repoSlug) {
  return `/tmp/ws/${safeWorkspacePathSegment(workspaceId)}/${repoNameFromSlug(repoSlug)}`;
}

/**
 * Coerce owner/name from string or { full_name|repo|github_repo } shapes.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function coerceGithubRepoSlug(raw) {
  if (raw == null) return null;
  let s = '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = /** @type {Record<string, unknown>} */ (raw);
    s = String(o.full_name || o.repo || o.github_repo || o.githubRepo || '').trim();
  } else {
    s = String(raw).trim();
  }
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
  return s.includes('/') ? s : null;
}

/**
 * Prefer project metadata / execution bindings over shared org workspace github_repo.
 * @param {any} env
 * @param {string|null|undefined} projectRef
 */
async function resolveProjectGithubRepoSlug(env, projectRef) {
  const ref = String(projectRef || '').trim();
  if (!env?.DB || !ref) return null;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const { readProjectGithubRepoFromRow } = await import(
      '../../backend/agentsam/codebase/project-github-repo.js'
    );
    const projectId = (await resolveChatProjectId(env, ref)) || ref;
    const row = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ? LIMIT 1`)
      .bind(projectId)
      .first()
      .catch(() => null);
    const fromMeta = coerceGithubRepoSlug(readProjectGithubRepoFromRow(row));
    if (fromMeta) return fromMeta;
    const { resolveWorkspaceBindings } = await import('../../backend/identity/workspace/agentsam-workspace.js');
    const bindings = await resolveWorkspaceBindings(env, projectId);
    return coerceGithubRepoSlug(bindings?.githubRepo);
  } catch {
    return null;
  }
}

/**
 * Resolve GitHub owner/name for fs_* container checkout / search.
 * Priority (LOCKED):
 * 1. explicit repo arg
 * 2. open editor file (activeFileEnvelope.github_repo) — UI "Looking at X" / open buffer
 * 3. project execution bindings
 * 4. explorer / chat selectedGithubRepoContext
 * 5. project metadata / exec workspace
 * 6. legacy activeRepo / github_repo on runContext (explicit session signals only)
 *
 * Never returns org workspace github_repo as a silent default (deleted former step 7).
 * No explicit signal → null → callers fail closed (github_repo_unresolved / context_ambiguous).
 *
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   userId: string,
 *   tenantId?: string,
 *   repo?: string|null,
 *   runContext?: Record<string, unknown>,
 * }} opts
 */
export async function resolveGithubRepoSlugForFs(env, opts) {
  const fromArg = coerceGithubRepoSlug(opts.repo);
  if (fromArg) return fromArg;

  const rc = opts.runContext && typeof opts.runContext === 'object' ? opts.runContext : {};
  const bindings =
    rc.projectExecutionBindings && typeof rc.projectExecutionBindings === 'object'
      ? /** @type {Record<string, unknown>} */ (rc.projectExecutionBindings)
      : null;

  // Open Monaco/GitHub buffer always wins — tools must follow the file on screen, not ws_*.
  const fromActiveFile = coerceGithubRepoSlug(
    rc.activeFileEnvelope && typeof rc.activeFileEnvelope === 'object'
      ? /** @type {Record<string, unknown>} */ (rc.activeFileEnvelope).github_repo
      : null,
  );
  if (fromActiveFile) return fromActiveFile;

  // Project-scoped chats: project / execution bindings beat stale session IAM locks.
  const fromBindings = coerceGithubRepoSlug(bindings?.githubRepo || bindings?.github_repo);
  if (fromBindings) return fromBindings;

  // Explorer / chat "Looking at owner/repo" — before project fail-closed.
  const fromExplorer = coerceGithubRepoSlug(
    rc.selectedGithubRepoContext || rc.githubRepoContext || rc.github_repo_context,
  );
  if (fromExplorer) return fromExplorer;

  const projectRef = String(
    rc.session_project_id ||
      rc.sessionProjectId ||
      rc.project_id ||
      rc.projectId ||
      bindings?.projectId ||
      bindings?.project_id ||
      '',
  ).trim();

  const execWs = String(
    bindings?.workspaceId ||
      rc.project_execution_workspace_id ||
      rc.execution_workspace_id ||
      '',
  ).trim();

  if (projectRef) {
    const fromProject = await resolveProjectGithubRepoSlug(env, projectRef);
    if (fromProject) return fromProject;
    if (execWs) {
      const fromExecWs = await getWorkspaceGithubRepo(env, execWs);
      const execSlug = coerceGithubRepoSlug(fromExecWs);
      if (execSlug) return execSlug;
    }
    // Project-scoped turn: never fall back to session IAM lock or org workspace github.
    return null;
  }

  if (execWs && execWs !== String(opts.workspaceId || '').trim()) {
    const fromExecWs = await getWorkspaceGithubRepo(env, execWs);
    const execSlug = coerceGithubRepoSlug(fromExecWs);
    if (execSlug) return execSlug;
  }

  const fromCtx = coerceGithubRepoSlug(
    rc.github_repo || rc.githubRepo || rc.active_repo || rc.activeRepo,
  );
  if (fromCtx) return fromCtx;

  // Fail closed: org workspace github_repo is not an explicit signal for tool resolution.
  // Callers may surface it in candidates[] for a clarifying question — never as the answer.
  return null;
}

/**
 * Stamp + return runContext.connected_github_repo (single SSOT field for fs_* ignore / scope).
 * Resolves once via resolveGithubRepoSlugForFs; subsequent calls reuse the stamp.
 *
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} runContext
 * @param {{ workspaceId?: string, userId?: string, tenantId?: string }} [identity]
 * @returns {Promise<string>} owner/repo or ''
 */
export async function ensureConnectedGithubRepoOnRunContext(env, runContext, identity = {}) {
  const rc = runContext && typeof runContext === 'object' ? runContext : {};
  const existing =
    rc.connected_github_repo != null ? String(rc.connected_github_repo).trim() : '';
  if (existing && existing.includes('/')) return existing;

  const slug = await resolveGithubRepoSlugForFs(env, {
    workspaceId: identity.workspaceId != null ? String(identity.workspaceId).trim() : '',
    userId: identity.userId != null ? String(identity.userId).trim() : '',
    tenantId: identity.tenantId != null ? String(identity.tenantId).trim() : '',
    runContext: rc,
  });
  if (slug) rc.connected_github_repo = slug;
  return slug || '';
}

/**
 * Build fail-closed unresolved payload. org_default may appear in candidates for the model
 * to name options — never as a resolved repoSlug.
 *
 * @param {any} env
 * @param {{ workspaceId?: string, projectRef?: string|null }} opts
 */
export async function githubRepoUnresolvedFailure(env, opts = {}) {
  const workspaceId = String(opts.workspaceId || '').trim();
  let orgDefaultSlug = null;
  if (workspaceId) {
    try {
      orgDefaultSlug = coerceGithubRepoSlug(await getWorkspaceGithubRepo(env, workspaceId));
    } catch {
      orgDefaultSlug = null;
    }
  }
  return {
    ok: false,
    error: 'github_repo_unresolved',
    detail:
      'No explicit github repo (arg, active file, project binding, or explorer selection). Ask the user which repo — do not guess.',
    candidates: [
      { source: 'project_binding', value: null },
      { source: 'explorer_selection', value: null },
      { source: 'org_default', value: orgDefaultSlug },
    ],
  };
}

/**
 * Install musl ripgrep into /tmp/bin if missing (image has git, not rg).
 */
function buildEnsureRipgrepShell() {
  return `
set -euo pipefail
export PATH="/tmp/bin:$PATH"
if command -v rg >/dev/null 2>&1; then
  echo "RG_OK:$(command -v rg)"
  exit 0
fi
mkdir -p /tmp/bin /tmp/rg-extract
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) RG_ARCH=x86_64 ;;
  aarch64|arm64) RG_ARCH=aarch64 ;;
  *) echo "RG_ERR:unsupported_arch:$ARCH" >&2; exit 3 ;;
esac
TGZ="ripgrep-14.1.1-\${RG_ARCH}-unknown-linux-musl.tar.gz"
URL="https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/\$TGZ"
curl -fsSL "$URL" -o "/tmp/\$TGZ"
tar -xzf "/tmp/\$TGZ" -C /tmp/rg-extract
cp /tmp/rg-extract/ripgrep-14.1.1-\${RG_ARCH}-unknown-linux-musl/rg /tmp/bin/rg
chmod +x /tmp/bin/rg
echo "RG_OK:/tmp/bin/rg"
`.trim();
}

/**
 * Clone / TTL-sync with flock. Emits CHECKOUT_OK:path|head|synced_at|action
 * @param {{ repoSlug: string, parentDir: string, destPath: string, token: string|null, ttlSec: number, forceSync: boolean }}
 */
function buildCheckoutShell({ repoSlug, parentDir, destPath, token, ttlSec, forceSync }) {
  const parentQ = shellSingleQuote(parentDir);
  const destQ = shellSingleQuote(destPath);
  const lockQ = shellSingleQuote(`${destPath}.lock`);
  const tokenQ = token ? shellSingleQuote(token) : "''";
  const httpsUrl = `https://github.com/${repoSlug}.git`;
  const force = forceSync ? '1' : '0';
  const ttl = Math.max(30, Math.min(3600, Number(ttlSec) || CONTAINER_FS_SYNC_TTL_SEC));
  const contract = CONTAINER_FS_CHECKOUT_CONTRACT;

  return `
set -euo pipefail
PARENT=${parentQ}
DEST=${destQ}
LOCK=${lockQ}
TTL=${ttl}
FORCE=${force}
CONTRACT=${contract}
export GITHUB_TOKEN=${tokenQ}
export GIT_TERMINAL_PROMPT=0
mkdir -p "$PARENT"
exec 9>"$LOCK"
flock 9
NOW=$(date +%s)
ACTION=reuse
if [ -d "$DEST/.git" ]; then
  SYNC_AT=0
  if [ -f "$DEST/.iam_fs_sync_at" ]; then
    SYNC_AT=$(cat "$DEST/.iam_fs_sync_at" 2>/dev/null || echo 0)
  fi
  AGE=$((NOW - SYNC_AT))
  HAVE_CONTRACT=0
  if [ -f "$DEST/.iam_fs_contract" ]; then
    HAVE_CONTRACT=$(cat "$DEST/.iam_fs_contract" 2>/dev/null || echo 0)
  fi
  if [ "$FORCE" = "1" ] || [ "$SYNC_AT" = "0" ] || [ "$AGE" -ge "$TTL" ] || [ "$HAVE_CONTRACT" != "$CONTRACT" ]; then
    cd "$DEST"
    if [ -n "$GITHUB_TOKEN" ]; then
      git remote set-url origin "https://x-access-token:\${GITHUB_TOKEN}@github.com/${repoSlug}.git"
    fi
    # Shallow + silent pull was tonight's bug: ACTION=pulled while HEAD stayed stale.
    # Fetch one tip ref and hard-reset — fail loud (no || true on critical steps).
    DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' | head -1 || true)"
    if [ -z "$DEFAULT_BRANCH" ] || [ "$DEFAULT_BRANCH" = "(unknown)" ]; then
      DEFAULT_BRANCH="$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
    fi
    if [ -z "$DEFAULT_BRANCH" ]; then DEFAULT_BRANCH=main; fi
    git fetch --depth 1 origin "+refs/heads/\${DEFAULT_BRANCH}:refs/remotes/origin/\${DEFAULT_BRANCH}"
    git checkout -q -B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"
    git reset --hard "origin/$DEFAULT_BRANCH"
    if [ -n "$GITHUB_TOKEN" ]; then
      git remote set-url origin "https://github.com/${repoSlug}.git"
    fi
    echo "$NOW" > "$DEST/.iam_fs_sync_at"
    echo "$CONTRACT" > "$DEST/.iam_fs_contract"
    ACTION=pulled
  fi
else
  rm -rf "$DEST"
  if [ -n "$GITHUB_TOKEN" ]; then
    AUTH_URL="https://x-access-token:\${GITHUB_TOKEN}@github.com/${repoSlug}.git"
    git -c credential.helper= clone --depth 1 "$AUTH_URL" "$DEST"
  else
    git clone --depth 1 ${shellSingleQuote(httpsUrl)} "$DEST"
  fi
  echo "$NOW" > "$DEST/.iam_fs_sync_at"
  echo "$CONTRACT" > "$DEST/.iam_fs_contract"
  ACTION=cloned
fi
cd "$DEST"
HEAD=$(git rev-parse HEAD)
if [ -z "$HEAD" ] || [ "$HEAD" = "unknown" ]; then
  echo "CHECKOUT_ERR:missing_head" >&2
  exit 4
fi
SYNCED=$(cat "$DEST/.iam_fs_sync_at" 2>/dev/null || echo "$NOW")
echo "CHECKOUT_OK:\${DEST}|\${HEAD}|\${SYNCED}|\${ACTION}"
`.trim();
}

/**
 * @param {string} output
 */
export function parseCheckoutShellResult(output) {
  const text = String(output || '');
  const m = text.match(/CHECKOUT_OK:([^\n]+)/);
  if (!m?.[1]) {
    if (/Authentication failed|invalid credentials|403|401/i.test(text)) {
      return { ok: false, error: 'github_auth_failed', detail: text.slice(0, 600) };
    }
    if (/Repository not found/i.test(text)) {
      return { ok: false, error: 'repo_not_found', detail: text.slice(0, 600) };
    }
    return { ok: false, error: 'checkout_failed', detail: text.slice(0, 800) };
  }
  const [repoPath, gitHead, syncedAt, action] = m[1].split('|');
  return {
    ok: true,
    repoPath: String(repoPath || '').trim(),
    gitHead: String(gitHead || '').trim() || null,
    syncedAt: Number(syncedAt) || null,
    action: String(action || 'reuse').trim(),
  };
}

/**
 * Clone or TTL-sync the workspace repo inside MY_CONTAINER.
 * Auth: same GitHub OAuth token as agentsam_github_read (getUserGithubToken).
 *
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   userId: string,
 *   tenantId?: string,
 *   repo?: string|null,
 *   runContext?: Record<string, unknown>,
 *   authUser?: unknown,
 *   forceSync?: boolean,
 *   ttlSec?: number,
 * }} opts
 */
export async function ensureContainerWorkspaceCheckout(env, opts) {
  const workspaceId = String(opts.workspaceId || '').trim();
  const userId = String(opts.userId || '').trim();
  if (!workspaceId || !userId) {
    return { ok: false, error: 'workspace_id_and_user_id_required' };
  }

  const repoSlug = await resolveGithubRepoSlugForFs(env, opts);
  if (!repoSlug) {
    return githubRepoUnresolvedFailure(env, { workspaceId });
  }

  // Checkout path follows project execution workspace when present; session workspaceId
  // stays the tenancy/ops key on the caller (tool_call_log), not the disk layout key.
  const rc = opts.runContext && typeof opts.runContext === 'object' ? opts.runContext : {};
  const bindings =
    rc.projectExecutionBindings && typeof rc.projectExecutionBindings === 'object'
      ? /** @type {Record<string, unknown>} */ (rc.projectExecutionBindings)
      : null;
  const checkoutWorkspaceId =
    String(
      bindings?.workspaceId ||
        rc.project_execution_workspace_id ||
        rc.execution_workspace_id ||
        workspaceId,
    ).trim() || workspaceId;

  const parentDir = `/tmp/ws/${safeWorkspacePathSegment(checkoutWorkspaceId)}`;
  const destPath = containerWorkspaceCheckoutPath(checkoutWorkspaceId, repoSlug);

  let token = null;
  try {
    const row = await getUserGithubToken(env, userId, '');
    token = row?.token ? String(row.token) : null;
  } catch {
    token = null;
  }

  const agentRunId = String(
    opts.runContext?.agentRunId || opts.runContext?.agent_run_id || '',
  ).trim();
  // First fs_* in an agent run forces sync once (stale-commit risk).
  const forceSync =
    opts.forceSync === true ||
    (agentRunId && opts.runContext?.__container_fs_synced_run !== agentRunId);

  const checkoutOut = await tryContainerExec(env, {
    command: buildCheckoutShell({
      repoSlug,
      parentDir,
      destPath,
      token,
      ttlSec: opts.ttlSec ?? CONTAINER_FS_SYNC_TTL_SEC,
      forceSync: !!forceSync,
    }),
    cwd: '/tmp',
    timeout_ms: ENSURE_TIMEOUT_MS,
    skip_wrangler_normalize: true,
    authUser: opts.authUser ?? null,
  });

  const checkoutText = `${checkoutOut.stdout || ''}\n${checkoutOut.stderr || ''}\n${checkoutOut.error || ''}`;
  const parsed = parseCheckoutShellResult(checkoutText);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error || 'checkout_failed',
      detail: String(parsed.detail || checkoutText).slice(0, 800),
      lane: 'my_container',
      http_status: checkoutOut.http_status,
      auth: token ? 'github_oauth' : 'anonymous_public',
    };
  }

  if (opts.runContext && agentRunId) {
    opts.runContext.__container_fs_synced_run = agentRunId;
  }

  // Author + HTTPS rewrite so follow-up sandbox git commit/push can work in this checkout.
  try {
    const { resolveGitAuthorIdentity, buildSandboxGithubGitPreamble } = await import(
      './sandbox-github-git-helper.js'
    );
    const author = await resolveGitAuthorIdentity(env, userId, opts.authUser || null);
    const gitPrep = buildSandboxGithubGitPreamble({
      name: author?.name || null,
      email: author?.email || null,
      token,
      requireToken: false,
      requireAuthor: false,
    });
    await tryContainerExec(env, {
      command: `${gitPrep}\ncd ${shellSingleQuote(parsed.repoPath)}\ngit config --local user.name ${shellSingleQuote(author?.name || 'Agent Sam')} 2>/dev/null || true\n${author?.email ? `git config --local user.email ${shellSingleQuote(author.email)} 2>/dev/null || true` : 'true'}\necho IAM_GIT_READY`,
      cwd: '/tmp',
      timeout_ms: 30_000,
      skip_wrangler_normalize: true,
      authUser: opts.authUser ?? null,
    });
  } catch (e) {
    console.warn('[fs-container-workspace] git identity prep', e?.message ?? e);
  }

  const rgOut = await tryContainerExec(env, {
    command: buildEnsureRipgrepShell(),
    cwd: '/tmp',
    timeout_ms: 90_000,
    skip_wrangler_normalize: true,
    authUser: opts.authUser ?? null,
  });
  const rgText = `${rgOut.stdout || ''}\n${rgOut.stderr || ''}`;
  if (!/RG_OK:/.test(rgText)) {
    return {
      ok: false,
      error: 'ripgrep_unavailable_in_container',
      detail: rgText.slice(0, 500),
      lane: 'my_container',
      repoPath: parsed.repoPath,
    };
  }

  return {
    ok: true,
    repoPath: parsed.repoPath || destPath,
    repoSlug,
    gitHead: parsed.gitHead,
    syncedAt: parsed.syncedAt,
    syncAction: parsed.action,
    lane: 'my_container',
    fs_source: 'container_synced_commit',
    auth: token ? 'github_oauth' : 'anonymous_public',
  };
}

/**
 * Run ripgrep in the container checkout (PATH includes /tmp/bin).
 * @param {any} env
 * @param {{ repoPath: string, rgCommand: string, timeout_ms?: number, authUser?: unknown }} opts
 */
export async function execRgInContainerWorkspace(env, opts) {
  const repoPath = String(opts.repoPath || '').trim();
  const rgCommand = String(opts.rgCommand || '').trim();
  if (!repoPath || !rgCommand) {
    return { ok: false, error: 'repo_path_and_rg_command_required', stdout: '', stderr: '', exit_code: 1 };
  }
  if (repoPath.includes('..') || !repoPath.startsWith('/tmp/ws/')) {
    return { ok: false, error: 'unsafe_container_repo_path', stdout: '', stderr: '', exit_code: 1 };
  }

  const wrapped = `export PATH="/tmp/bin:$PATH"; ${rgCommand}`;
  const out = await tryContainerExec(env, {
    command: wrapped,
    cwd: repoPath,
    timeout_ms: opts.timeout_ms ?? CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
    skip_wrangler_normalize: true,
    authUser: opts.authUser ?? null,
  });

  return {
    ok: out.ok !== false && !out.error,
    stdout: String(out.stdout || ''),
    stderr: String(out.stderr || out.error || ''),
    exit_code: Number(out.exit_code ?? (out.ok ? 0 : 1)),
    lane: 'my_container',
    http_status: out.http_status,
    error: out.error || null,
  };
}

/**
 * Prefer MY_CONTAINER checkout; PTY only when FS_PREFER_PTY=1 or preferPty.
 * Not for fs_search_files as a silent default — that tool must not call this for
 * every search (clip 2026-08). my_container remains valid when agentsam_terminal_sandbox
 * (or other explicit sandbox/terminal workflows) need a checkout; warm/reuse, don't
 * aimlessly clone on each agent assumption.
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   userId: string,
 *   tenantId?: string,
 *   preferPty?: boolean,
 *   request?: Request|null,
 *   runContext?: Record<string, unknown>,
 * }} opts
 */
export async function resolveFsWorkspaceTarget(env, opts) {
  const preferPty =
    opts.preferPty === true ||
    String(env?.FS_PREFER_PTY || '').trim() === '1' ||
    String(opts.runContext?.prefer_pty || '').trim() === '1';

  if (preferPty && opts.request) {
    const { resolveWorkspaceRepoRootForSession } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
    const repo = await resolveWorkspaceRepoRootForSession(env, {
      tenantId: opts.tenantId || '',
      userId: opts.userId,
      workspaceId: opts.workspaceId,
    });
    if (repo?.repoRoot) {
      return {
        ok: true,
        lane: 'pty',
        repoPath: repo.repoRoot,
        workspaceRoot: repo.workspaceRoot || repo.repoRoot,
        source: repo.source || 'workspace_settings',
        fs_source: 'local_working_tree',
        gitHead: null,
        syncedAt: null,
      };
    }
  }

  const ensured = await ensureContainerWorkspaceCheckout(env, {
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    tenantId: opts.tenantId,
    repo: opts.repo ?? null,
    runContext: opts.runContext,
    authUser: opts.runContext?.authUser ?? null,
  });
  if (!ensured.ok) {
    if (opts.request) {
      const { resolveWorkspaceRepoRootForSession } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
      const repo = await resolveWorkspaceRepoRootForSession(env, {
        tenantId: opts.tenantId || '',
        userId: opts.userId,
        workspaceId: opts.workspaceId,
      });
      if (repo?.repoRoot) {
        return {
          ok: true,
          lane: 'pty',
          repoPath: repo.repoRoot,
          workspaceRoot: repo.workspaceRoot || repo.repoRoot,
          source: repo.source || 'workspace_settings',
          fs_source: 'local_working_tree',
          container_error: ensured.error,
          gitHead: null,
          syncedAt: null,
        };
      }
    }
    return { ok: false, error: ensured.error, detail: ensured.detail, auth: ensured.auth };
  }

  return {
    ok: true,
    lane: 'my_container',
    repoPath: ensured.repoPath,
    repoSlug: ensured.repoSlug,
    workspaceRoot: ensured.repoPath,
    source: 'my_container_checkout',
    fs_source: 'container_synced_commit',
    gitHead: ensured.gitHead,
    syncedAt: ensured.syncedAt,
    syncAction: ensured.syncAction,
    auth: ensured.auth,
  };
}
