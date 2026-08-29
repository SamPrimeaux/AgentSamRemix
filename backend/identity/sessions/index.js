/**
 * Session lane — human identity at the edge.
 *
 * SESSION_CACHE binding (production-KV_SESSIONS):
 *   iam:sess:{session_id}  — session mirror (dual-write legacy iam_sess_v1:)
 *   iam:ctx:{au}           — active workspace / project pin
 *   iam:prefs:{au}:{ws}    — UI preferences
 *   iam:ff:{au}:{ws}       — UI feature flags (never agent authority)
 */

export { getSession } from './read.js';
export {
  establishIamSession,
  createLoginSession,
  pruneExpiredAuthSessions,
  revokeAuthSession,
  resolveSessionIdFromCookieValue,
} from './write.js';
