/**
 * Typed terminal hop failures — HTTP 502 is a middle-layer miss, not "the Mac crashed."
 * Never invent a fallback lane here; the caller still hard-binds the requested lane.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function laneLooksLocal(targetLane, url) {
  const lane = trim(targetLane).toLowerCase();
  const href = trim(url).toLowerCase();
  return (
    /local|mac|user_hosted|user_local/.test(lane) ||
    /localpty/.test(href)
  );
}

function laneLooksRemote(targetLane, url) {
  const lane = trim(targetLane).toLowerCase();
  const href = trim(url).toLowerCase();
  return (
    /remote|gcp|iam_tunnel|platform_vm/.test(lane) ||
    /terminal\.inneranimalmedia/.test(href)
  );
}

/**
 * @param {{
 *   status?: number|null,
 *   targetLane?: string|null,
 *   url?: string|null,
 *   bodyError?: string|null,
 *   fetchThrown?: unknown,
 * }} opts
 * @returns {{ failure_class: string, user_message: string }}
 */
export function classifyTerminalHttpFailure(opts = {}) {
  const status = Number(opts.status);
  const thrown = opts.fetchThrown;
  const thrownText = thrown != null ? trim(thrown?.message || thrown) : '';
  const isLocal = laneLooksLocal(opts.targetLane, opts.url);
  const isRemote = laneLooksRemote(opts.targetLane, opts.url);
  const fromHost = trim(opts.failureClass);

  if (fromHost) {
    return {
      failure_class: fromHost,
      user_message: trim(opts.bodyError) || fromHost,
    };
  }

  if (thrownText) {
    if (/abort|timed?\s*out|timeout/i.test(thrownText)) {
      return {
        failure_class: 'hop_timeout',
        user_message: isLocal
          ? `Local ExecOS hop timed out (${thrownText}). Retry Local; this is not a switch to Remote or Sandbox.`
          : `Terminal hop timed out (${thrownText}). Retry the same lane.`,
      };
    }
    if (isLocal) {
      return {
        failure_class: 'local_tunnel_offline',
        user_message:
          `Local tunnel did not return a valid response (${thrownText}). ` +
          'Often a brief Wi-Fi or cloudflared reconnect — the Mac process may still be running. ' +
          'Retry Local only; this is not a switch to Remote or Sandbox.',
      };
    }
    if (isRemote) {
      return {
        failure_class: 'remote_tunnel_offline',
        user_message:
          `Remote ExecOS hop failed (${thrownText}). Retry Remote only; Local and Sandbox were not used.`,
      };
    }
    return {
      failure_class: 'execos_unreachable',
      user_message: `Terminal transport failed (${thrownText}). The requested lane did not execute.`,
    };
  }

  if (status === 504 || status === 408) {
    const body = trim(opts.bodyError);
    if (/exec_timeout/i.test(body)) {
      return {
        failure_class: 'execution_timeout',
        user_message: `Command exceeded the ExecOS timeout (HTTP ${status}).`,
      };
    }
    return {
      failure_class: 'hop_timeout',
      user_message: isLocal
        ? `Local tunnel/ExecOS hop timed out (HTTP ${status}). Retry Local; this is not a switch to another lane.`
        : `Terminal hop timed out (HTTP ${status}). Retry the same lane.`,
    };
  }

  if (status === 502 || status === 503) {
    if (isLocal) {
      return {
        failure_class: 'local_tunnel_offline',
        user_message:
          `Local tunnel did not return a valid response (HTTP ${status}). ` +
          'This is a middle-layer miss (Worker → tunnel → ExecOS), not proof that the Mac crashed. ' +
          'Often a brief Wi-Fi or cloudflared reconnect. Retry Local only; this is not a switch to Remote or Sandbox.',
      };
    }
    if (isRemote) {
      return {
        failure_class: 'remote_tunnel_offline',
        user_message:
          `Remote ExecOS did not return a valid response (HTTP ${status}). Retry Remote only.`,
      };
    }
    return {
      failure_class: 'execos_unreachable',
      user_message: `Terminal hop returned HTTP ${status}. The requested lane did not execute.`,
    };
  }

  const fromBody = trim(opts.bodyError);
  if (fromBody) {
    return { failure_class: 'command_failed', user_message: fromBody };
  }
  const code = Number.isFinite(status) && status > 0 ? status : 'unknown';
  return {
    failure_class: 'command_failed',
    user_message: `PTY command failed (HTTP ${code})`,
  };
}

/**
 * Prefer a typed hop message over a bare status string when throwing to the tool loop.
 * @param {unknown} out
 * @returns {string}
 */
export function terminalToolFailureMessage(out) {
  if (!out || typeof out !== 'object') return 'terminal execution failed';
  const body = out.body && typeof out.body === 'object' ? out.body : {};
  const um = trim(out.user_message) || trim(body.user_message);
  if (um) return um;
  const cls = trim(body.failure_class || out.failure_class);
  const err = trim(out.error);
  if (cls && err && err !== cls) return `${cls}: ${err}`;
  if (err) return err;
  if (cls) return cls;
  return 'terminal execution failed';
}
