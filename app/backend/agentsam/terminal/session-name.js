/**
 * Durable Object name for a terminal session.
 *
 * Interactive dock WS must not share a DO across devices or lanes. Agent one-shot
 * /exec uses plane=agent so prompt-repair / attach cannot multiplex into a live xterm.
 *
 * Pattern:
 *   interactive: terminal:{userId}:{workspaceId}:{mode}:{lane}:{ptyClient}[:ptySlot]
 *   agent:       terminal:{userId}:{workspaceId}:{mode}:{lane}:agent
 */

const TOKEN_RE = /^[a-zA-Z0-9_-]{1,16}$/;

const TARGET_TYPE_TO_LANE = Object.freeze({
  user_hosted_tunnel: 'local',
  platform_vm: 'remote',
  sandbox: 'sandbox',
  local: 'local',
  remote: 'remote',
});

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeTerminalNameToken(raw) {
  const s = String(raw || '').trim();
  return TOKEN_RE.test(s) ? s : '';
}

/**
 * @param {unknown} targetType
 * @returns {'local'|'remote'|'sandbox'|''}
 */
export function terminalLaneKeyFromTargetType(targetType) {
  const tt = String(targetType || '').trim();
  return TARGET_TYPE_TO_LANE[tt] || '';
}

/**
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   executionMode?: string,
 *   targetType: string,
 *   ptyClient?: string,
 *   ptySlot?: string,
 *   plane?: 'interactive'|'agent',
 * }} opts
 * @returns {string}
 */
export function buildTerminalSessionDoName(opts = {}) {
  const uid = String(opts.userId || '').trim();
  const wid = String(opts.workspaceId || '').trim();
  const mode = String(opts.executionMode || 'pty').trim() || 'pty';
  const lane = terminalLaneKeyFromTargetType(opts.targetType);
  if (!uid || !wid || !lane) {
    const err = new Error('terminal_session_name_incomplete');
    err.code = 'terminal_session_name_incomplete';
    throw err;
  }
  const parts = ['terminal', uid, wid, mode, lane];
  const plane = opts.plane === 'agent' ? 'agent' : 'interactive';
  if (plane === 'agent') {
    parts.push('agent');
    return parts.join(':');
  }
  const client = sanitizeTerminalNameToken(opts.ptyClient);
  if (!client) {
    const err = new Error('pty_client_required');
    err.code = 'pty_client_required';
    throw err;
  }
  parts.push(client);
  const slot = sanitizeTerminalNameToken(opts.ptySlot);
  if (slot) parts.push(slot);
  return parts.join(':');
}
