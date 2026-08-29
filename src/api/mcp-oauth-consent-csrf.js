/**
 * MCP OAuth consent CSRF (double-submit cookie).
 * Cloudflare-style: __Host- HttpOnly cookie + matching body field on POST.
 */
import { mcpOAuthNow, mcpOAuthRandomToken } from './mcp-oauth-shared.js';

/** __Host- prefix: Secure, Path=/, no Domain (browser-enforced). */
export const MCP_CONSENT_CSRF_COOKIE_NAME = '__Host-mcp_oauth_consent_csrf';

export const MCP_CONSENT_CSRF_TTL_SECONDS = 600;

const MCP_CONSENT_CSRF_KV_PREFIX = 'mcp_consent_csrf:';

function mcpConsentCsrfKvKey(authorizationId) {
  return `${MCP_CONSENT_CSRF_KV_PREFIX}${String(authorizationId || '').trim()}`;
}

function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

export function buildMcpConsentCsrfSetCookieHeader(token) {
  const value = encodeURIComponent(String(token || ''));
  return `${MCP_CONSENT_CSRF_COOKIE_NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${MCP_CONSENT_CSRF_TTL_SECONDS}`;
}

export function parseMcpConsentCsrfCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  const prefix = `${MCP_CONSENT_CSRF_COOKIE_NAME}=`;
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (!p.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(p.slice(prefix.length));
    } catch {
      return p.slice(prefix.length);
    }
  }
  return '';
}

/**
 * Issue CSRF token when consent data loads (bound to authorization + user).
 */
export async function issueMcpConsentCsrf(env, { authorizationId, userId }) {
  const token = mcpOAuthRandomToken('csrf', 32);
  const exp = mcpOAuthNow() + MCP_CONSENT_CSRF_TTL_SECONDS;
  if (env.SESSION_CACHE) {
    await env.SESSION_CACHE.put(
      mcpConsentCsrfKvKey(authorizationId),
      JSON.stringify({ token, userId: String(userId || ''), exp }),
      { expirationTtl: MCP_CONSENT_CSRF_TTL_SECONDS },
    );
  }
  return { token, setCookie: buildMcpConsentCsrfSetCookieHeader(token) };
}

/**
 * Verify cookie + body token match and match KV binding before consent mutation.
 */
export async function verifyMcpConsentCsrf(request, env, { authorizationId, userId, bodyToken }) {
  const cookieToken = parseMcpConsentCsrfCookie(request);
  const submitted = String(bodyToken || '').trim();
  if (!cookieToken || !submitted) {
    return { ok: false, error: 'csrf_missing' };
  }
  if (!timingSafeEqual(cookieToken, submitted)) {
    return { ok: false, error: 'csrf_mismatch' };
  }
  if (!env.SESSION_CACHE) {
    return { ok: false, error: 'csrf_unavailable' };
  }
  const raw = await env.SESSION_CACHE.get(mcpConsentCsrfKvKey(authorizationId));
  if (!raw) {
    return { ok: false, error: 'csrf_expired' };
  }
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'csrf_invalid' };
  }
  if (!stored?.token || Number(stored.exp || 0) <= mcpOAuthNow()) {
    return { ok: false, error: 'csrf_expired' };
  }
  if (String(stored.userId) !== String(userId || '')) {
    return { ok: false, error: 'csrf_forbidden' };
  }
  if (!timingSafeEqual(stored.token, cookieToken)) {
    return { ok: false, error: 'csrf_invalid' };
  }
  return { ok: true };
}

export async function consumeMcpConsentCsrf(env, authorizationId) {
  if (!env.SESSION_CACHE) return;
  await env.SESSION_CACHE.delete(mcpConsentCsrfKvKey(authorizationId));
}
