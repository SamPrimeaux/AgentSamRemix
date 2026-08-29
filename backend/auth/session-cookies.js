import { AUTH_COOKIE_NAME, AUTH_SESSION_TTL_SECONDS } from './constants.js';
import { buildSessionSetCookieHeader } from './session-tokens.js';

export function normalizeLoginSessionResult(result) {
  if (result && typeof result === 'object' && result.sessionId) return result;
  const sid = result == null ? '' : String(result).trim();
  return { sessionId: sid, sessionToken: sid };
}

/** @param {string} sessionToken @param {number} [maxAgeSec] */
export function formatSessionCookieHeader(sessionToken, maxAgeSec = AUTH_SESSION_TTL_SECONDS) {
  return buildSessionSetCookieHeader(sessionToken, maxAgeSec);
}

/**
 * Clear stale domain-scoped session cookies, then set canonical host-only session (set last).
 * IAM-specific domain clears — customer adapter supplies domain list in SDK phase.
 */
export function appendBrowserLoginSessionCookies(headers, sessionToken, maxAgeSec = AUTH_SESSION_TTL_SECONDS) {
  headers.append(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Domain=.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
  );
  headers.append(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Domain=.sandbox.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
  );
  headers.append('Set-Cookie', formatSessionCookieHeader(sessionToken, maxAgeSec));
}
