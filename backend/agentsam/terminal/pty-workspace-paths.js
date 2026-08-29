/**
 * Terminal cwd resolution — workspace_settings.workspace_root (local) or operator repo (GCP remote).
 * GCP iam-tunnel paths resolve from terminal_connections (iam-tunnel-owner-config).
 */
import { assertWorkspaceTokenForPty } from '../../../src/core/workspace-tokens.js';
import { requireTerminalTargetType } from './execution-lane.js';
import { runTerminalCommandViaHttpExec } from './vm-http-exec.js';
import { executeHttpTerminalTransport } from './transports/http-exec.js';
import {
  connectionUsesGcpRepoLayout,
  gcpRemoteExecCwd,
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
  normalizeExecCwdForConnection,
  resolveRepoRootForHost,
  vmWorkspaceRootFromSettings,
} from './host-workspace-paths.js';
import { resolveIdentityScopedGcpCwd } from '../../../src/core/identity-scoped-gcp-cwd.js';
import { safePtyRepoDirName } from '../../../src/core/safe-pty-repo-dir-name.js';

export { safePtyRepoDirName, resolveIamGcpExecosHome, resolveIamGcpPlatformRepo };

/**
 * @deprecated Never use a fixed platform repo basename. Derive from workspace_root
 * via safePtyRepoDirName / normalizePtyRepoDirForWorkspace (worker-identity.js).
 */
export const PTY_REPO_DIRNAME = null;

const REMOTION_INSTALL_CMD =
  'npm install --save-dev remotion @remotion/renderer @remotion/bundler @remotion/player';

/**
 * @deprecated Removed — no tenant filesystem roots on infrastructure.
 */
export function ptyWorkspacesRootFromEnv(_env) {
  return null;
}

/**
 * @deprecated Removed — no /workspace/{tenant}/{user}/ layout.
 */
export function buildPtyUserWorkspaceRoot(_env, _ctx) {
  return null;
}

/**
 * @deprecated Use resolveTerminalCwd with workspaceId — sync stub returns null.
 */
export function buildPtySessionWorkingDir(_env, _ctx) {
  return null;
}

/**
 * @param {any} env
 * @param {{ id?: string, active_tenant_id?: string|null, tenant_id?: string|null } | null | undefined} authUser
 * @param {string} [userId]
 */
export async function resolvePtyTenantIdForUser(env, authUser, userId) {
  const fromUser =
    String(authUser?.active_tenant_id || '').trim() || String(authUser?.tenant_id || '').trim();
  if (fromUser) return fromUser;

  const uid = String(authUser?.id || userId || '').trim();
  if (!env?.DB || !uid) return null;

  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(active_tenant_id), ''), NULLIF(TRIM(tenant_id), '')) AS tid
       FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    const tid = row?.tid != null ? String(row.tid).trim() : '';
    return tid || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @returns {Promise<string|null>}
 */
export async function loadAgentsamWorkspaceRootPath(env, workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT root_path FROM agentsam_workspace
        WHERE id = ? AND COALESCE(status, 'active') != 'archived'
        LIMIT 1`,
    )
      .bind(wid)
      .first();
    const root = row?.root_path != null ? String(row.root_path).trim() : '';
    return root || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function loadWorkspaceRootFromSettings(env, workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1',
    )
      .bind(wid)
      .first();
    if (!row?.settings_json) return null;
    const parsed = JSON.parse(String(row.settings_json));
    const root = typeof parsed?.workspace_root === 'string' ? parsed.workspace_root.trim() : '';
    return root || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function loadWorkspaceSettingsJson(env, workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1',
    )
      .bind(wid)
      .first();
    if (!row?.settings_json) return null;
    return JSON.parse(String(row.settings_json));
  } catch {
    return null;
  }
}

/**
 * Cwd resolution:
 * - user_hosted_tunnel / Mac local: workspace_settings.workspace_root
 * - platform_vm / GCP remote: identity-scoped (owner registry or /workspace/{tenant_id}/)
 *
 * @param {any} env
 * @param {{ connection?: Record<string, unknown> | null, tenantId: string, userId: string, workspaceId?: string | null }} ctx
 */
export async function resolveTerminalCwd(env, { connection = null, tenantId, userId, workspaceId = null }) {
  const strategy = String(connection?.cwd_strategy || 'host_default').trim() || 'host_default';
  const forceGcp = connectionUsesGcpRepoLayout(connection);
  const wid = String(workspaceId || connection?.workspace_id || '').trim();
  const settings = wid ? await loadWorkspaceSettingsJson(env, wid) : null;

  if (strategy === 'custom') {
    return { cwd: null, strategy, unsupported: true };
  }

  if (forceGcp) {
    const scoped = await resolveIdentityScopedGcpCwd({
      userId,
      tenantId,
      workspaceId: wid,
      settings,
      env,
    });
    if (!scoped.ok) {
      return {
        cwd: null,
        strategy: 'identity_scoped_gcp',
        error: scoped.error,
        user_message: scoped.user_message,
      };
    }
    return { cwd: scoped.cwd, strategy: scoped.source };
  }

  if (wid) {
    const registryRoot = await loadAgentsamWorkspaceRootPath(env, wid);
    if (registryRoot) {
      return { cwd: registryRoot, strategy: 'workspace_root' };
    }
    const localRoot =
      settings && typeof settings.workspace_root === 'string'
        ? settings.workspace_root.trim()
        : '';
    if (localRoot) {
      return { cwd: localRoot, strategy: 'workspace_settings' };
    }
    const fallback = await loadWorkspaceRootFromSettings(env, wid);
    if (fallback) {
      return { cwd: fallback, strategy: 'workspace_settings' };
    }
  }

  if (strategy === 'user_home') {
    return { cwd: null, strategy };
  }

  // Legacy platform_workspace → no tenant path; null cwd (shell default)
  return { cwd: null, strategy: strategy === 'platform_workspace' ? 'host_default' : strategy };
}

/**
 * Normalize a candidate path against workspace_root (generic — not MovieMode-specific).
 * @param {string|null|undefined} candidate
 * @param {string|null|undefined} workspaceRoot
 */
export function deriveWorkspaceRepoRootFromCandidate(candidate, workspaceRoot) {
  const c = String(candidate || '').trim().replace(/[/\\]+$/, '');
  const ws = String(workspaceRoot || '').trim().replace(/[/\\]+$/, '');
  if (!c) return ws || null;
  if (ws && c === ws) return ws;
  return c;
}

/** @deprecated Use {@link deriveWorkspaceRepoRootFromCandidate} */
export const deriveMoviemodeRepoRootFromCandidate = deriveWorkspaceRepoRootFromCandidate;

async function loadActiveTerminalSessionCwd(env, userId, workspaceId) {
  if (!env?.DB || !userId || !workspaceId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT cwd FROM terminal_sessions
       WHERE user_id = ? AND workspace_id = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
      .bind(String(userId).trim(), String(workspaceId).trim())
      .first();
    const cwd = row?.cwd != null ? String(row.cwd).trim() : '';
    return cwd || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the workspace's local (or VM) checkout root for PTY tools.
 * Reads D1 workspace_settings (workspace_root / vm_workspace_root), then token/session fallbacks.
 * Shared by fs_* search/read/write, apply_patch, and MovieMode export — not MovieMode-only.
 * MovieMode-specific Remotion checks stay in {@link validateMoviemodeRepoOnPty}.
 *
 * @param {any} env
 * @param {{ tenantId: string, userId: string, workspaceId: string }} ctx
 */
export async function resolveWorkspaceRepoRootForSession(env, { tenantId, userId, workspaceId }) {
  const wid = String(workspaceId || '').trim();
  const uid = String(userId || '').trim();
  if (!uid || !wid) return null;

  const settings = await loadWorkspaceSettingsJson(env, wid);
  const registryRoot = await loadAgentsamWorkspaceRootPath(env, wid);
  const workspaceRoot =
    registryRoot ||
    ((settings && typeof settings.workspace_root === 'string'
      ? settings.workspace_root.trim()
      : '') ||
      (await loadWorkspaceRootFromSettings(env, wid)));

  const candidates = [];

  if (registryRoot) {
    candidates.push({ path: registryRoot, source: 'agentsam_workspace.root_path' });
  }
  // Prefer registry/settings roots — terminal_sessions.cwd is often the GCP twin
  // (/home/…/repo) while workspace_root is the Mac path (/Users/…/repo). Putting
  // session cwd first made safePtyRepoDirName emit `cd <basename>` against a cwd
  // that was already the repo.
  if (workspaceRoot) candidates.push({ path: workspaceRoot, source: 'workspace_settings.workspace_root' });
  const vmRoot =
    settings && typeof settings.vm_workspace_root === 'string'
      ? settings.vm_workspace_root.trim()
      : '';
  if (vmRoot) candidates.push({ path: vmRoot, source: 'workspace_settings.vm_workspace_root' });

  const tok = await assertWorkspaceTokenForPty(env, wid, tenantId);
  if (tok.ok && tok.repo_path) candidates.push({ path: tok.repo_path, source: 'mcp_workspace_tokens.repo_path' });

  const sessionCwd = await loadActiveTerminalSessionCwd(env, uid, wid);
  if (sessionCwd) candidates.push({ path: sessionCwd, source: 'terminal_sessions.cwd' });

  for (const c of candidates) {
    const repoRoot = deriveWorkspaceRepoRootFromCandidate(c.path, workspaceRoot);
    if (repoRoot) return { repoRoot, workspaceRoot: workspaceRoot || repoRoot, source: c.source };
  }

  return null;
}

/** @deprecated Use {@link resolveWorkspaceRepoRootForSession} */
export async function resolveMoviemodeRepoRootForSession(env, ctx) {
  return resolveWorkspaceRepoRootForSession(env, ctx);
}

/**
 * Pick host exec transport from an explicit connection. Never invent platform_vm.
 * Phone and Mac share this split: Local → Mac localpty, VM → GCP VPC.
 *
 * @param {Record<string, unknown>|null|undefined} connection
 * @returns {{ ok: true, targetType: string, transport: 'vm_http_exec'|'local_http_exec' } | { ok: false, error: string }}
 */
export function ptyHostExecPlan(connection) {
  try {
    const targetType = requireTerminalTargetType(connection?.target_type || connection?.targetType);
    if (targetType === 'platform_vm') {
      return { ok: true, targetType, transport: 'vm_http_exec' };
    }
    if (targetType === 'user_hosted_tunnel') {
      return { ok: true, targetType, transport: 'local_http_exec' };
    }
    return { ok: false, error: 'unsupported_target_type' };
  } catch (e) {
    return { ok: false, error: e?.code || e?.message || 'target_type_required' };
  }
}

/**
 * One-shot host exec. Lane comes from `connection.target_type` — same plane as dock.
 * Local never uses PTY_SERVICE (that binding is GCP VPC).
 *
 * @param {any} env
 * @param {{
 *   command: string,
 *   cwd?: string|null,
 *   timeout_ms?: number,
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   connection?: Record<string, unknown>|null,
 * }} opts
 */
export async function execOnPtyHost(env, {
  command,
  cwd = null,
  timeout_ms = 120_000,
  userId = null,
  workspaceId = null,
  connection = null,
}) {
  let wd = cwd != null ? String(cwd).trim() : '';
  if (!wd) {
    return {
      ok: false,
      stdout: '',
      stderr: 'cwd_required',
      exit_code: 1,
      error: 'cwd_required',
    };
  }

  const plan = ptyHostExecPlan(connection);
  if (!plan.ok) {
    return {
      ok: false,
      stdout: '',
      stderr: plan.error,
      exit_code: 1,
      error: plan.error,
    };
  }

  const conn = { ...connection, target_type: plan.targetType };
  wd = normalizeExecCwdForConnection(wd, conn) || wd;
  if (!wd) {
    return {
      ok: false,
      stdout: '',
      stderr: 'cwd_unresolved',
      exit_code: 1,
      error: 'cwd_unresolved',
    };
  }

  if (plan.transport === 'vm_http_exec') {
    const http = await runTerminalCommandViaHttpExec(env, command, {
      cwd: wd,
      userId,
      workspaceId,
      connection: conn,
    });
    return {
      ok: !!http.ok,
      stdout: http.ok ? http.text || '' : '',
      stderr: http.ok ? '' : http.text || http.error || 'exec failed',
      exit_code: http.exitCode ?? (http.ok ? 0 : 1),
      error: http.ok ? undefined : http.error,
    };
  }

  if (!String(conn.ws_url || '').trim()) {
    return {
      ok: false,
      stdout: '',
      stderr: 'user_hosted_tunnel_unreachable',
      exit_code: 1,
      error: 'user_hosted_tunnel_unreachable',
    };
  }

  let headers = { 'Content-Type': 'application/json' };
  if (env?.DB) {
    const { resolveTerminalExecIdentity, buildExecTransportHeaders } = await import(
      './privileged-targets.js'
    );
    const execIdentity = await resolveTerminalExecIdentity(env.DB, conn, null, {
      env,
      userId,
      workspaceId,
    });
    headers = {
      ...headers,
      ...buildExecTransportHeaders({ ...execIdentity, userId }),
    };
  }

  try {
    const transported = await executeHttpTerminalTransport(
      { env },
      {
        connection: conn,
        user_id: userId,
        workspace_id: workspaceId,
        target_lane: 'local',
      },
      {
        payload: { command, cwd: wd, stream: false, timeout_ms },
        headers,
      },
    );
    if (transported?.error) {
      return {
        ok: false,
        stdout: '',
        stderr: String(transported.error),
        exit_code: 1,
        error: 'local_exec_failed',
      };
    }
    return {
      ok: (transported?.exit_code ?? 0) === 0,
      stdout: String(transported?.output || ''),
      stderr: '',
      exit_code: transported?.exit_code ?? 0,
    };
  } catch (e) {
    return {
      ok: false,
      stdout: '',
      stderr: String(e?.message || e),
      exit_code: 1,
      error: 'local_exec_failed',
    };
  }
}

/**
 * @param {any} env
 * @param {string} repoRoot
 */
export async function validateMoviemodeRepoOnPty(env, repoRoot, ctx = {}) {
  const root = String(repoRoot || '').trim();
  const uid = String(ctx?.userId || '').trim();
  if (!root || !uid) {
    return {
      ok: false,
      errorCode: 'workspace_context_missing',
      message: 'Could not resolve local workspace for export',
    };
  }

  const repoProbe = await execOnPtyHost(env, {
    cwd: root,
    command: 'test -f scripts/moviemode-remotion-render.mjs && test -f package.json && echo REPO_OK || echo REPO_MISSING',
    timeout_ms: 30_000,
    userId: uid,
    workspaceId: ctx?.workspaceId || null,
    connection: ctx?.connection || null,
  });
  const repoOut = `${repoProbe.stdout}\n${repoProbe.stderr}`;
  if (!repoOut.includes('REPO_OK')) {
    return {
      ok: false,
      errorCode: 'repo_not_found_in_workspace',
      expectedPath: root,
      message:
        'Repo not found at workspace_settings.workspace_root on your machine. Clone locally, then retry export.',
      uiHint: 'clone_repo_on_local_machine',
    };
  }

  const depProbe = await execOnPtyHost(env, {
    cwd: root,
    command:
      'test -f node_modules/@remotion/renderer/package.json && echo REMOTION_OK || echo REMOTION_MISSING',
    timeout_ms: 30_000,
    userId: uid,
    workspaceId: ctx?.workspaceId || null,
    connection: ctx?.connection || null,
  });
  const depOut = `${depProbe.stdout}\n${depProbe.stderr}`;
  if (!depOut.includes('REMOTION_OK')) {
    return {
      ok: false,
      errorCode: 'remotion_deps_missing',
      expectedPath: root,
      installCommand: REMOTION_INSTALL_CMD,
      message: `Remotion packages are not installed in ${root}. Run: ${REMOTION_INSTALL_CMD}`,
      uiHint: 'install_remotion_deps',
    };
  }

  return { ok: true, repoRoot: root };
}

export {
  REMOTION_INSTALL_CMD,
  vmWorkspaceRootFromSettings,
  resolveRepoRootForHost,
  normalizeExecCwdForConnection,
};
