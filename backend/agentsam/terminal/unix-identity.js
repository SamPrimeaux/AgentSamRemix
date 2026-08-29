/**
 * Platform VM Unix identity on iam-tunnel.
 *
 * Authorizing human (session user_id = terminal_connections.user_id on conn_gcp_iam_tunnel):
 *   logical body Unix = tunnel_owner_unix_user (D1)
 * Everyone else (other humans / tenant agents on the shared VM):
 *   logical body Unix = tunnel_daemon_unix_user (D1) — same as ExecOS process user
 *
 * Transport header always matches the ExecOS process user (daemon).
 * Values come from D1 only — never hardcode owner/daemon logins here.
 */

import {
  loadIamTunnelOwnerConfig,
  resolveIamTunnelDaemonUnixUser,
  resolveIamTunnelOwnerUnixUser,
} from '../../../backend/identity/workspace/tunnel-owner.js';
import { userIdIsIamTunnelOwner } from '../../identity/workspace/grants.js';

/**
 * Interactive shell wrapper installed by scripts/install-execos-owner-identity.sh
 * (compat symlink kept for older Worker builds).
 */
export const EXECOS_OWNER_SHELL = '/usr/local/sbin/execos-as-owner';

/** @deprecated use EXECOS_OWNER_SHELL */
export const IAM_PTY_OWNER_SHELL = EXECOS_OWNER_SHELL;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Unix user for a platform_vm session body (whoami), not the daemon header.
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} [_workspaceId]
 * @returns {Promise<string|null>} null when D1 owner config is missing (fail closed)
 */
export async function resolvePlatformVmUnixUser(env, userId, _workspaceId) {
  const uid = trim(userId);
  const cfg = await loadIamTunnelOwnerConfig(env);
  if (!cfg?.daemonUnixUser) return null;
  if (uid && (await userIdIsIamTunnelOwner(env, uid))) {
    return cfg.unixUser || null;
  }
  return cfg.daemonUnixUser;
}

/**
 * Interactive shell path for remote ExecOS sessions.
 * Tunnel owner on remote → owner wrapper; else requested shell.
 * @param {object} opts
 * @param {boolean} opts.isTunnelOwner
 * @param {boolean} [opts.isOperator] deprecated alias for isTunnelOwner
 * @param {string} opts.targetLane
 * @param {string} opts.targetType
 * @param {string} opts.requestedShell
 */
export function resolveInteractivePtyShell({
  isTunnelOwner,
  isOperator,
  targetLane,
  targetType,
  requestedShell,
}) {
  const fallback = trim(requestedShell) || '/bin/bash';
  const remote =
    trim(targetLane) === 'remote' || trim(targetType) === 'platform_vm';
  const owner = isTunnelOwner === true || (isTunnelOwner == null && isOperator === true);
  if (owner && remote) return EXECOS_OWNER_SHELL;
  return fallback;
}

/**
 * Wrap a remote /exec command so it runs as unixUser while the ExecOS daemon
 * stays the transport identity (header unchanged).
 *
 * Must NOT emit bare `sudo -nu …` on the /exec command string — ExecOS
 * `checkSudoPolicy` blocks privilege-escalation sudo forms (403). Interactive
 * dock already uses EXECOS_OWNER_SHELL; one-shot agent exec must match.
 * The wrapper binary performs the NOPASSWD sudo internally.
 *
 * @param {string} command
 * @param {string} unixUser
 * @param {string|null|undefined} [daemonUnixUser] when set, skip wrap if unixUser === daemon
 */
export function wrapRemoteExecCommandAsUnixUser(command, unixUser, daemonUnixUser = null) {
  const user = trim(unixUser);
  const daemon = trim(daemonUnixUser);
  let cmd = command == null ? '' : String(command);
  if (!user || (daemon && user === daemon)) return cmd;
  if (!cmd) return cmd;
  if (
    cmd.startsWith(`${EXECOS_OWNER_SHELL} `) ||
    cmd.startsWith(`${EXECOS_OWNER_SHELL}\t`) ||
    cmd.startsWith('/usr/local/sbin/iam-pty-as-owner ')
  ) {
    return cmd;
  }
  // Unwrap legacy Worker `sudo -nu <owner> -H -- /bin/bash -lc '…'` forms.
  const escUser = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const legacy = cmd.match(
    new RegExp(
      `^sudo\\s+-nu\\s+${escUser}\\s+(?:-H\\s+--\\s+)?/bin/bash\\s+-lc\\s+'((?:\\\\'|[^'])*)'\\s*$`,
    ),
  );
  if (legacy) cmd = legacy[1].replace(/\\'/g, "'");
  const escaped = cmd.replace(/'/g, `'\\''`);
  return `${EXECOS_OWNER_SHELL} -lc '${escaped}'`;
}

/**
 * Agent VPC /exec: wrap only when logical Unix ≠ daemon Unix.
 * Same-user Mac tunnels must not wrap (execos-as-owner is a VM binary).
 */
export function maybeWrapRemoteHttpExecCommand(command, execUser, transportExecUser) {
  const user = trim(execUser);
  const daemon = trim(transportExecUser);
  if (!user || !daemon || user === daemon) return command == null ? '' : String(command);
  return wrapRemoteExecCommandAsUnixUser(command, user, daemon);
}

/** @param {any} env */
export async function resolveTunnelOwnerUnixUserOrNull(env) {
  return resolveIamTunnelOwnerUnixUser(env);
}

/** @param {any} env */
export async function resolveTunnelDaemonUnixUserOrNull(env) {
  return resolveIamTunnelDaemonUnixUser(env);
}
