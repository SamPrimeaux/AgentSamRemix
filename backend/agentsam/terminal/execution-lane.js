/**
 * Parse dock exec_lane from workspaceContext. No silent defaults.
 * @param {unknown} wsCtx
 * @returns {{ ok: true, lane: 'local'|'remote'|'sandbox' } | { ok: false, code: 'exec_lane_required'|'exec_lane_invalid', raw?: string }}
 */
export function parseExecLaneFromWorkspaceContext(wsCtx) {
  if (!wsCtx || typeof wsCtx !== 'object') {
    return { ok: false, code: 'exec_lane_required' };
  }
  const raw = String(/** @type {Record<string, unknown>} */ (wsCtx).exec_lane || '')
    .trim()
    .toLowerCase();
  if (raw === 'local' || raw === 'remote' || raw === 'sandbox') {
    return { ok: true, lane: raw };
  }
  if (raw) return { ok: false, code: 'exec_lane_invalid', raw };
  return { ok: false, code: 'exec_lane_required' };
}

/** @typedef {'local'|'remote'|'sandbox'} ExecLane */

export const TERMINAL_TOOL_BY_EXEC_LANE = Object.freeze({
  local: 'agentsam_terminal_local',
  remote: 'agentsam_terminal_remote',
  sandbox: 'agentsam_terminal_sandbox',
});

export const ALL_TERMINAL_LANE_TOOL_KEYS = Object.freeze([
  'agentsam_terminal_local',
  'agentsam_terminal_remote',
  'agentsam_terminal_sandbox',
]);

/**
 * @param {unknown} lane
 * @returns {string|null}
 */
export function terminalToolKeyForExecLane(lane) {
  const key = String(lane || '')
    .trim()
    .toLowerCase();
  return TERMINAL_TOOL_BY_EXEC_LANE[key] || null;
}

/**
 * Keep only the dock-matched terminal tool. Model must not shop lanes after failure.
 * Non-terminal tools unchanged. Missing/invalid lane → leave tools as-is (caller fail-loud elsewhere).
 * @param {unknown[]} tools
 * @param {unknown} execLane
 * @returns {unknown[]}
 */
export function filterToolsForDockExecLane(tools, execLane) {
  const list = Array.isArray(tools) ? tools : [];
  const keep = terminalToolKeyForExecLane(execLane);
  if (!keep) return list;
  const drop = new Set(ALL_TERMINAL_LANE_TOOL_KEYS.filter((k) => k !== keep));
  return list.filter((t) => {
    const name = String(t?.name || t?.tool_name || t?.tool_key || '').trim();
    return !drop.has(name);
  });
}

/**
 * Strip every terminal-lane tool when the dock has no exec_lane at all (missing/invalid).
 * Model chat continues normally — only shell tools require a lane. If the model tries a
 * shell call anyway, the tool layer (pty-exec.js / backend terminal connections) still
 * fails loud with exec_lane_required. Never used to invent a lane — only to remove the option.
 * @param {unknown[]} tools
 * @returns {unknown[]}
 */
export function stripAllTerminalLaneTools(tools) {
  const list = Array.isArray(tools) ? tools : [];
  return list.filter((t) => {
    const name = String(t?.name || t?.tool_name || t?.tool_key || '').trim();
    return !ALL_TERMINAL_LANE_TOOL_KEYS.includes(name);
  });
}

/**
 * Hard-bind check: called terminal tool must match dock lane.
 * @param {unknown} toolKey
 * @param {unknown} execLane
 * @returns {{ ok: true } | { ok: false, code: 'terminal_lane_mismatch', expected: string, got: string }}
 */
export function assertTerminalToolMatchesDockLane(toolKey, execLane) {
  const got = String(toolKey || '').trim();
  if (!ALL_TERMINAL_LANE_TOOL_KEYS.includes(got)) return { ok: true };
  const expected = terminalToolKeyForExecLane(execLane);
  if (!expected) return { ok: true };
  if (got === expected) return { ok: true };
  return { ok: false, code: 'terminal_lane_mismatch', expected, got };
}

/**
 * Require an explicit terminal_connections.target_type. No invent-on-missing.
 * @param {unknown} raw
 * @returns {string}
 */
export function requireTerminalTargetType(raw) {
  const tt = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!tt || tt === 'auto') {
    const err = new Error(tt === 'auto' ? 'target_type_invalid' : 'target_type_required');
    err.code = err.message;
    throw err;
  }
  // Chat/dock lane alias used in some envelopes
  if (tt === 'remote') return 'platform_vm';
  if (tt === 'local') return 'user_hosted_tunnel';
  // Lifecycle alias — not a fourth lane. Durable vs throwaway is sandboxLifecycleFromInput.
  if (tt === 'ephemeral_container' || tt === 'container') return 'sandbox';
  return String(raw).trim();
}

/**
 * Sandbox lane lifecycle. Never a separate target_type / dock tab.
 * Legacy `target_type=ephemeral_container` means ephemeral lifecycle on sandbox.
 * @param {Record<string, unknown>|null|undefined} input
 * @returns {'durable'|'ephemeral'}
 */
export function sandboxLifecycleFromInput(input = {}) {
  const obj = input && typeof input === 'object' ? input : {};
  const tt = String(obj.target_type ?? obj.targetType ?? '')
    .trim()
    .toLowerCase();
  if (tt === 'ephemeral_container') return 'ephemeral';
  const life = String(obj.lifecycle ?? '').trim().toLowerCase();
  if (life === 'ephemeral') return 'ephemeral';
  if (obj.ephemeral === true || obj.ephemeral === 1 || obj.ephemeral === '1') return 'ephemeral';
  return 'durable';
}
