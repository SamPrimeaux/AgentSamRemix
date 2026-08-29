/** Canonical terminal execution result shared by runtime, handlers, and fallback. */
export function normalizeTerminalExecutionResult(result = {}, meta = {}) {
  const output = typeof result.output === 'string'
    ? result.output
    : typeof result.text === 'string'
      ? result.text
      : typeof result.stdout === 'string'
        ? result.stdout
        : '';
  const stdout = typeof result.stdout === 'string' ? result.stdout : output;
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.exit_code ?? result.exitCode ?? meta.exit_code ?? null;
  const error = result.error != null ? String(result.error) : null;
  return {
    ok: result.ok != null ? result.ok === true : !error,
    protocol: result.protocol ?? result.execution_mode ?? meta.protocol ?? 'pty',
    command: result.command ?? meta.command ?? null,
    output,
    stdout,
    stderr,
    exit_code: exitCode,
    target_id: result.target_id ?? result.targetId ?? meta.target_id ?? null,
    target_type: result.target_type ?? meta.target_type ?? null,
    target_lane: result.target_lane ?? result.lane ?? meta.target_lane ?? null,
    transport: result.transport ?? meta.transport ?? null,
    cwd: result.cwd ?? meta.cwd ?? null,
    error,
    lane_attempts: result.lane_attempts ?? meta.lane_attempts ?? [],
    recovery_hints: result.recovery_hints ?? meta.recovery_hints ?? [],
    lifecycle: result.lifecycle ?? meta.lifecycle ?? null,
    cleanup: result.cleanup ?? meta.cleanup ?? null,
    instance_name: result.instance_name ?? meta.instance_name ?? null,
  };
}

export function terminalFailureText(result) {
  return [
    result?.error,
    result?.stderr,
    result?.output,
    result?.body?.user_message,
    result?.body?.stderr,
    result?.body?.output,
    result?.body?.error,
  ].filter(Boolean).join('\n').toLowerCase();
}

export function isTerminalTransportFailure(result) {
  if (!result || result.ok === true) return false;
  const exitCode = result.exit_code ?? result.exitCode ?? result?.body?.exit_code ?? result?.body?.exitCode;
  if (exitCode != null && exitCode !== '') {
    const code = String(exitCode).trim().toUpperCase();
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES' && Number.isFinite(Number(exitCode))) {
      return false;
    }
  }
  const err = terminalFailureText(result);
  if (!err) return true;
  if (err === 'command_nonzero_exit' || /^exit[_ ]?code/i.test(err)) return false;
  if (/x-iam-exec-identity|identity_mismatch|identity required|exec.?identity/i.test(err)) return false;
  return /403|401|forbidden|auth|pty command failed|enoent|tunnel|unavailable|timeout|econnrefused|ehostunreach|connection|health_probe|not_provisioned|mobile_local|routing forbidden|terminal error|exec_spawn_failed|asleep|sleeping|offline|unreachable|fetch failed|failed to fetch|network|websocket|socket|reset|localpty|mac.*(down|asleep|offline)|502|503|504|cloudflare.?error|do\.internal|do reset|pty vpc|control-plane [45]|container_start_timeout/i.test(err);
}
