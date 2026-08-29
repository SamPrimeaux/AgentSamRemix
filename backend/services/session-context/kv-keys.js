/**
 * SESSION_CACHE key families — human session + settings + working context.
 * SSOT: docs/platform/kv-lane-ssot-2026-08.md
 */

export const SESSION_KV_PREFIX = 'iam:sess:';
/** @deprecated Dual-write/read fallback */
export const LEGACY_SESSION_KV_PREFIX = 'iam_sess_v1:';

export const SESSION_CTX_PREFIX = 'iam:ctx:';
export const SESSION_PREFS_PREFIX = 'iam:prefs:';
export const SESSION_UI_FF_PREFIX = 'iam:ff:';

/** @deprecated Dual-write fallback — fold into iam:ctx */
export const LEGACY_ACTIVE_PROJECT_PREFIX = 'iam:active_project:';

/**
 * @param {string} sessionId
 */
export function sessionKvKey(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return '';
  return `${SESSION_KV_PREFIX}${id}`;
}

/** @param {string} sessionId */
export function legacySessionKvKey(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return '';
  return `${LEGACY_SESSION_KV_PREFIX}${id}`;
}

/** @param {string} userId canonical au_* */
export function sessionContextKey(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  return `${SESSION_CTX_PREFIX}${uid}`;
}

/** @param {string} userId @param {string} workspaceId */
export function sessionPrefsKey(userId, workspaceId) {
  const uid = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  if (!uid || !ws) return '';
  return `${SESSION_PREFS_PREFIX}${uid}:${ws}`;
}

/** @param {string} userId @param {string} workspaceId */
export function sessionUiFlagsKey(userId, workspaceId) {
  const uid = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  if (!uid || !ws) return '';
  return `${SESSION_UI_FF_PREFIX}${uid}:${ws}`;
}
