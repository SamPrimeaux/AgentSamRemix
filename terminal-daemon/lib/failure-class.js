/**
 * Typed ExecOS failure classes. Command exit ≠ transport failure.
 */
import { EXEC_TARGET, resolveExecTarget } from "./exec-vocabulary.js";

function blob(parts) {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

/**
 * @param {{ stderr?: string, stdout?: string, error?: string, exit_code?: unknown }} result
 */
export function classifyCommandFailure(result = {}) {
  const text = blob([result.stderr, result.stdout, result.error]);
  const code = result.exit_code;
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
    return "command_failed";
  }
  if (
    /\.git\/fetch_head|permission denied|\.git.*not writable|insufficient permission|cannot lock ref/i.test(
      text,
    )
  ) {
    return "repo_permission_denied";
  }
  if (
    /could not read username|authentication failed|fatal: could not read|permission to .+ denied|invalid username or token|error: failed to push/i.test(
      text,
    )
  ) {
    return "git_auth_failed";
  }
  return "command_failed";
}

/**
 * Dispatcher hop classification. HTTP status may stay 502; body must be typed.
 * @param {{
 *   target?: string,
 *   error?: string,
 *   hop_status?: number,
 *   timed_out?: boolean,
 * }} opts
 */
export function classifyHopFailure(opts = {}) {
  const target = String(opts.target || "").toLowerCase();
  const error = String(opts.error || "");
  const status = Number(opts.hop_status) || 0;
  if (opts.timed_out === true || /_hop_timeout$/.test(error) || status === 504 || status === 408) {
    return "hop_timeout";
  }
  if (error === "exec_timeout") return "execution_timeout";
  if (
    /_key_missing$|_not_configured$|_unverified$|_not_implemented$|dispatch_failed|invalid_execos_key/.test(
      error,
    )
  ) {
    return "execos_unreachable";
  }
  const transportish =
    /_transport_error$/.test(error) ||
    /_exec_502$|_exec_503$/.test(error) ||
    status === 502 ||
    status === 503 ||
    status === 0;
  if (transportish) {
    const resolvedTarget = resolveExecTarget(target) || target;
    if (resolvedTarget === EXEC_TARGET.LOCAL) return "local_tunnel_offline";
    if (resolvedTarget === EXEC_TARGET.REMOTE) return "remote_tunnel_offline";
    return "execos_unreachable";
  }
  return error || "execos_unreachable";
}
