/**
 * ExecOS fabric — host execution abstraction for GCP (CAD / privileged ops).
 * Pick ONE transport and execute once. No hop casino on failure.
 *
 * Selection (first configured wins; not a retry chain):
 *   1) EXECOS service binding + AGENTSAM_BRIDGE_KEY (X-ExecOS-Key)
 *   2) else public ExecOS URL + AGENTSAM_BRIDGE_KEY
 *   3) else PTY_SERVICE /exec (VPC)
 * Missing selection → fail loud.
 *
 * Not used for interactive dashboard PTY (see pty-connection.js lane binding).
 */

import { execOnPtyHost, loadWorkspaceRootFromSettings, loadWorkspaceSettingsJson } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { userMayUsePrivilegedTerminal } from '../../backend/identity/workspace/grants.js';
import {
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
  gcpRemoteExecCwd,
} from '../../backend/agentsam/terminal/host-workspace-paths.js';
import { resolveIdentityScopedGcpCwd } from './identity-scoped-gcp-cwd.js';
import { canonicalizeExecHopTarget } from '../../backend/agentsam/terminal/terminal-binding.js';
import { resolveOutboundBridgeKey } from '../../backend/auth/bridge-key-auth.js';

export {
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
  gcpRemoteExecCwd as translateHostRootForGcp,
} from '../../backend/agentsam/terminal/host-workspace-paths.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Resolve CAD/exec repo cwd from caller identity (never ambient platform repo).
 * @param {any} env
 * @param {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null, target?: string }} ctx
 */
export async function resolveCadExecRepoRoot(env, ctx = {}) {
  const target = canonicalizeExecHopTarget(ctx.target) || 'remote';
  const userId = trim(ctx.userId);
  const workspaceId = trim(ctx.workspaceId);
  if (!workspaceId) {
    throw new Error('workspace_id_required');
  }
  const tenantId = trim(ctx.tenantId);

  if (target === 'remote') {
    const settings = workspaceId ? await loadWorkspaceSettingsJson(env, workspaceId) : null;
    const scoped = await resolveIdentityScopedGcpCwd({
      userId,
      tenantId,
      workspaceId,
      settings,
      env,
    });
    if (!scoped.ok) {
      return { repoRoot: '', source: scoped.error, strategy: 'identity_scoped_gcp' };
    }
    return { repoRoot: scoped.cwd, source: scoped.source, strategy: 'identity_scoped_gcp' };
  }

  const isOperator = userId
    ? await userMayUsePrivilegedTerminal(env, { id: userId }, workspaceId)
    : false;

  if (isOperator) {
    const { loadAgentsamWorkspaceRootPath } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
    const registryRoot = workspaceId ? await loadAgentsamWorkspaceRootPath(env, workspaceId) : null;
    if (registryRoot) {
      return { repoRoot: registryRoot, source: 'agentsam_workspace.root_path', strategy: 'workspace_root' };
    }
    const hostRoot = await loadWorkspaceRootFromSettings(env, workspaceId);
    if (hostRoot) {
      return { repoRoot: hostRoot, source: 'workspace_settings', strategy: 'host_default' };
    }
    return { repoRoot: '', source: 'workspace_root_missing', strategy: 'host_default' };
  }

  const { loadAgentsamWorkspaceRootPath } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
  const registryRoot = workspaceId ? await loadAgentsamWorkspaceRootPath(env, workspaceId) : null;
  if (registryRoot) {
    return { repoRoot: registryRoot, source: 'agentsam_workspace.root_path', strategy: 'workspace_root' };
  }
  const hostRoot = workspaceId ? await loadWorkspaceRootFromSettings(env, workspaceId) : null;
  if (hostRoot) {
    return { repoRoot: hostRoot, source: 'workspace_settings', strategy: 'host_default' };
  }

  return { repoRoot: '', source: 'unresolved', strategy: 'none' };
}

/** @deprecated use resolveCadExecRepoRoot — sync stub cannot invent identity-safe cwd */
export function resolveCadExecCwd(env, hints = {}) {
  const fromHint = trim(hints.repoRoot);
  if (fromHint) return fromHint;
  const explicit = trim(env?.EXECOS_CAD_CWD) || trim(env?.OPERATOR_TERMINAL_CWD);
  if (explicit) return explicit;
  return '';
}

/** Default Worker-side hop budget (ms). Must be ≤ overall timeout_ms. */
export const EXECOS_DEFAULT_HOP_TIMEOUT_MS = 12_000;

/**
 * @param {Record<string, unknown>} data
 */
function normalizeExecResult(data, resolution, target) {
  const stdout = typeof data?.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data?.stderr === 'string' ? data.stderr : '';
  const exitCode = Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : 0;
  const ok = data?.ok !== false && exitCode === 0;
  return {
    ok,
    stdout,
    stderr,
    exit_code: exitCode,
    resolution,
    target: data?.target || target,
    latency_ms: data?.latency_ms ?? null,
  };
}

/**
 * HTTP success + parseable exec body (any exit_code) = completed hop.
 * Shell failure ≠ transport failure — do not fall through.
 * @param {Response} res
 * @param {Record<string, unknown>} data
 */
function isCompletedExecBody(res, data) {
  if (!res?.ok) return false;
  if (!data || typeof data !== 'object') return false;
  // Completed when we got an exit_code or explicit ok flag (true or false).
  if (Object.prototype.hasOwnProperty.call(data, 'exit_code')) return true;
  if (Object.prototype.hasOwnProperty.call(data, 'ok')) return true;
  if (typeof data.stdout === 'string' || typeof data.stderr === 'string') return true;
  return false;
}

function isTransportHttpStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || err || '');
  return name === 'TimeoutError' || name === 'AbortError' || /aborted|timed out|timeout/i.test(msg);
}

/**
 * @param {any} env
 * @param {{
 *   command: string,
 *   cwd?: string|null,
 *   target?: string,
 *   timeout_ms?: number,
 *   hop_timeout_ms?: number,
 * }} opts
 */
export async function runExecOsCommand(env, opts) {
  const command = trim(opts.command);
  if (!command) {
    return { ok: false, stdout: '', stderr: 'command_required', exit_code: 1, resolution: 'none' };
  }

  const target = canonicalizeExecHopTarget(opts.target) || 'remote';
  const cwd = opts.cwd != null ? trim(opts.cwd) : '';
  if (!cwd) {
    return {
      ok: false,
      stdout: '',
      stderr: 'cwd_required',
      exit_code: 1,
      resolution: 'none',
      error: 'cwd_required',
    };
  }
  const userId = trim(opts.userId);
  const body = { command, target, cwd };
  const identityHeaders = userId ? { 'X-User-Id': userId } : {};

  const overallBudget = Number.isFinite(Number(opts.timeout_ms))
    ? Math.max(1_000, Number(opts.timeout_ms))
    : 120_000;
  const hopRequested = Number.isFinite(Number(opts.hop_timeout_ms))
    ? Number(opts.hop_timeout_ms)
    : EXECOS_DEFAULT_HOP_TIMEOUT_MS;
  const hopTimeoutMs = Math.max(1_000, Math.min(hopRequested, overallBudget));
  const startedAt = Date.now();

  const remainingMs = () => Math.max(500, overallBudget - (Date.now() - startedAt));

  const execosKey = resolveOutboundBridgeKey(env);
  const hopMs = Math.min(hopTimeoutMs, remainingMs());

  /**
   * @param {string} label
   * @param {() => Promise<Response>} doFetch
   */
  const runOnce = async (label, doFetch) => {
    try {
      const res = await doFetch(AbortSignal.timeout(hopMs));
      const data = await res.json().catch(() => ({}));
      if (isCompletedExecBody(res, data)) {
        return normalizeExecResult(data, label, target);
      }
      const err = trim(data?.error) || `${label}_http_${res.status}`;
      return {
        ok: false,
        stdout: typeof data?.stdout === 'string' ? data.stdout : '',
        stderr: err,
        exit_code: Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : 1,
        resolution: label,
        target,
        error: err,
      };
    } catch (e) {
      const err = isAbortError(e)
        ? `${label}_hop_timeout:${hopMs}`
        : `${label}_throw:${trim(e?.message || e).slice(0, 160)}`;
      return {
        ok: false,
        stdout: '',
        stderr: err,
        exit_code: 1,
        resolution: label,
        target,
        error: err,
      };
    }
  };

  // Single selected pipe — no sequential hop on failure.
  if (env?.EXECOS && execosKey) {
    return runOnce('execos_binding', (signal) =>
      env.EXECOS.fetch('https://internal/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ExecOS-Key': execosKey,
          ...identityHeaders,
        },
        body: JSON.stringify(body),
        signal,
      }),
    );
  }

  if (execosKey) {
    const publicUrl = trim(env?.EXECOS_PUBLIC_URL) || 'https://execos.inneranimalmedia.com/run';
    return runOnce('execos_public', (signal) =>
      fetch(publicUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ExecOS-Key': execosKey,
          ...identityHeaders,
        },
        body: JSON.stringify(body),
        signal,
      }),
    );
  }

  if (env?.PTY_SERVICE) {
    const ptyBudget = remainingMs();
    const ptyResult = await execOnPtyHost(env, {
      command,
      cwd,
      timeout_ms: ptyBudget,
      userId: userId || null,
      connection: { target_type: 'platform_vm', privileged_target_id: 'conn_gcp_iam_tunnel' },
    });
    return {
      ok: ptyResult.ok === true,
      stdout: ptyResult.stdout || '',
      stderr: ptyResult.stderr || '',
      exit_code: ptyResult.exit_code ?? (ptyResult.ok ? 0 : 1),
      resolution: 'pty_service_exec',
      target: 'pty_vpc',
      error: ptyResult.ok ? undefined : ptyResult.stderr || 'pty_service_exec_failed',
    };
  }

  return {
    ok: false,
    stdout: '',
    stderr: 'execos_not_configured',
    exit_code: 1,
    resolution: 'failed',
    target,
    error: 'execos_not_configured',
  };
}

/**
 * Probe ExecOS GCP chain + OpenSCAD/Blender toolchain.
 * @param {any} env
 * @param {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null }} [ctx]
 */
export async function probeExecOsCadHealth(env, ctx = {}) {
  const hasPath =
    !!(env?.EXECOS && resolveOutboundBridgeKey(env)) ||
    !!resolveOutboundBridgeKey(env) ||
    !!(env?.PTY_SERVICE || env?.TERMINAL_WS_URL);

  if (!hasPath) {
    return { status: 'unavailable', reason: 'execos_not_configured', dispatch: 'none' };
  }

  const execosHome = await resolveIamGcpExecosHome(env);
  if (!execosHome) {
    return { status: 'unavailable', reason: 'tunnel_execos_path_unresolved', dispatch: 'none' };
  }

  const chainProbe = await runExecOsCommand(env, {
    command: 'echo EXECOS_CHAIN_OK',
    cwd: execosHome,
    target: 'remote',
    userId: trim(ctx.userId) || undefined,
    timeout_ms: 25_000,
  });
  if (!chainProbe.ok) {
    return {
      status: 'unavailable',
      reason: 'execos_unreachable',
      detail: (chainProbe.stderr || chainProbe.error || '').slice(0, 300),
      resolution: chainProbe.resolution,
    };
  }

  const resolved = await resolveCadExecRepoRoot(env, { ...ctx, target: 'remote' });
  const cwd = resolved.repoRoot;
  if (!cwd) {
    return { status: 'unavailable', reason: 'repo_root_unresolved', dispatch: 'execos' };
  }

  const toolProbe = await runExecOsCommand(env, {
    command:
      'command -v openscad >/dev/null && command -v blender >/dev/null && echo CAD_TOOLCHAIN_OK || echo CAD_TOOLCHAIN_MISSING',
    cwd,
    target: 'remote',
    timeout_ms: 30_000,
  });
  const out = `${toolProbe.stdout}\n${toolProbe.stderr}`;
  const freecadProbe = await runExecOsCommand(env, {
    command: 'command -v FreeCADCmd >/dev/null 2>&1 && echo FREECAD_OK || echo FREECAD_MISSING',
    cwd,
    target: 'remote',
    timeout_ms: 15_000,
  });
  const freecadOut = `${freecadProbe.stdout}\n${freecadProbe.stderr}`;
  const freecadStatus = freecadOut.includes('FREECAD_OK') ? 'ready' : 'missing';

  if (out.includes('CAD_TOOLCHAIN_OK')) {
    return {
      status: 'ready',
      dispatch: 'execos',
      target: 'remote',
      resolution: toolProbe.resolution || chainProbe.resolution,
      cwd,
      repo_source: resolved.source,
      repo_strategy: resolved.strategy,
      freecad: freecadStatus,
    };
  }

  return {
    status: 'degraded',
    reason: 'toolchain_missing',
    dispatch: 'execos',
    detail: out.slice(0, 300),
    cwd,
    repo_source: resolved.source,
    repo_strategy: resolved.strategy,
    freecad: freecadStatus,
  };
}
