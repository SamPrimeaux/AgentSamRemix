/**
 * Browser session proof.
 *
 * This validates only the session cookie and returns user/session possession.
 * Workspace, tenant, and capability authority belong to backend/identity.
 */
import {
  isEdgeSessionToken,
  isSessionRevokedInKv,
  readAuthRevFromCache,
  resolveSessionFromCookieValue,
  edgeClaimsToSessionPayload,
} from './session-tokens.js';

const AUTH_COOKIE_NAME = 'session';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<{ userId: string, sessionId: string }|null>}
 */
export async function proveBrowserSession(request, env) {
  const cookieHeader = request?.headers?.get?.('Cookie') || '';
  const candidates = [];
  const regex = new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`, 'g');
  let match;
  while ((match = regex.exec(cookieHeader)) !== null) candidates.push(match[1]);
  if (!candidates.length) return null;

  let bestEdge = null;
  let bestExpiration = -1;
  for (const candidate of candidates) {
    let raw;
    try {
      raw = trim(decodeURIComponent(String(candidate || '')));
    } catch {
      raw = trim(candidate);
    }
    if (!raw || !isEdgeSessionToken(raw)) continue;
    const resolved = await resolveSessionFromCookieValue(env, raw);
    if (!resolved.claims || !resolved.sessionId) continue;
    if (await isSessionRevokedInKv(env, resolved.sessionId)) continue;
    const userId = trim(resolved.claims.sub);
    const tokenRevision = Number(resolved.claims.rev) || 0;
    const cachedRevision = userId ? await readAuthRevFromCache(env, userId) : null;
    if (cachedRevision != null && cachedRevision > tokenRevision) continue;
    const expiration = Number(resolved.claims.exp) || 0;
    if (expiration >= bestExpiration) {
      bestExpiration = expiration;
      bestEdge = edgeClaimsToSessionPayload(resolved.claims);
    }
  }
  if (bestEdge?.user_id && bestEdge?.session_id) {
    return { userId: trim(bestEdge.user_id), sessionId: trim(bestEdge.session_id) };
  }

  if (!env?.DB) return null;
  let bestLegacy = null;
  for (const candidate of candidates) {
    let sessionId;
    try {
      sessionId = trim(decodeURIComponent(String(candidate || '')));
    } catch {
      sessionId = trim(candidate);
    }
    if (!sessionId || isEdgeSessionToken(sessionId)) continue;
    try {
      const row = await env.DB.prepare(
        `SELECT id, user_id, created_at
           FROM auth_sessions
          WHERE id = ?
            AND datetime(expires_at) > datetime('now')
            AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
          LIMIT 1`,
      )
        .bind(sessionId)
        .first();
      if (!row?.id || !row?.user_id) continue;
      const createdAt = Date.parse(String(row.created_at || '').replace(' ', 'T') + 'Z') || 0;
      if (!bestLegacy || createdAt >= bestLegacy.createdAt) {
        bestLegacy = {
          userId: trim(row.user_id),
          sessionId: trim(row.id),
          createdAt,
        };
      }
    } catch {
      // Try the next cookie candidate.
    }
  }
  return bestLegacy?.userId && bestLegacy?.sessionId
    ? { userId: bestLegacy.userId, sessionId: bestLegacy.sessionId }
    : null;
}
