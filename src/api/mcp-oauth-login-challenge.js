/**
 * Short-lived MCP OAuth login challenges — avoids embedding full authorize URLs in /auth/login?next=.
 * KV binding: env.SESSION_CACHE (wrangler.production.toml)
 */
import { getAuthUser } from '../core/auth.js';
import { mcpOAuthJsonError } from './mcp-oauth-shared.js';
import { isMcpOAuthLoginChallengeResumePath } from '../../backend/identity/oauth-login-path.js';

export { isMcpOAuthLoginChallengeResumePath };

export const MCP_OAUTH_LOGIN_CHALLENGE_TTL_SECONDS = 600;
export const MCP_OAUTH_LOGIN_CHALLENGE_PREFIX = 'oauth_login_challenge:';

export function generateMcpOAuthLoginChallengeId() {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `olc_${hex}`;
}

export function mcpOAuthLoginChallengeResumePath(challengeId) {
  const id = String(challengeId || '').trim();
  return `/api/oauth/login-challenge/resume?challenge=${encodeURIComponent(id)}`;
}

export function buildMcpOAuthAuthorizeUrl(origin, payload) {
  const base = String(origin || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const u = new URL('/api/oauth/authorize', base);
  if (payload?.response_type) u.searchParams.set('response_type', payload.response_type);
  if (payload?.client_id) u.searchParams.set('client_id', payload.client_id);
  if (payload?.redirect_uri) u.searchParams.set('redirect_uri', payload.redirect_uri);
  if (payload?.scope) u.searchParams.set('scope', payload.scope);
  if (payload?.resource) u.searchParams.set('resource', payload.resource);
  if (payload?.state) u.searchParams.set('state', payload.state);
  if (payload?.code_challenge) u.searchParams.set('code_challenge', payload.code_challenge);
  if (payload?.code_challenge_method) {
    u.searchParams.set('code_challenge_method', payload.code_challenge_method);
  }
  if (payload?.ui_locales) u.searchParams.set('ui_locales', payload.ui_locales);
  return u.href;
}

export async function createMcpOAuthLoginChallengeFromAuthorizeUrl(env, authorizeUrl) {
  if (!env?.SESSION_CACHE?.put) {
    throw new Error('SESSION_CACHE binding missing');
  }
  const url = authorizeUrl instanceof URL ? authorizeUrl : new URL(String(authorizeUrl));
  const challengeId = generateMcpOAuthLoginChallengeId();
  const payload = {
    response_type: String(url.searchParams.get('response_type') || 'code'),
    client_id: String(url.searchParams.get('client_id') || '').trim(),
    redirect_uri: String(url.searchParams.get('redirect_uri') || '').trim(),
    scope: String(url.searchParams.get('scope') || '').trim(),
    resource: String(url.searchParams.get('resource') || '').trim() || null,
    state: String(url.searchParams.get('state') || '').trim(),
    code_challenge: String(url.searchParams.get('code_challenge') || '').trim(),
    code_challenge_method: String(url.searchParams.get('code_challenge_method') || 'S256').trim(),
    ui_locales: String(url.searchParams.get('ui_locales') || '').trim() || null,
    created_at: Date.now(),
  };
  await env.SESSION_CACHE.put(
    `${MCP_OAUTH_LOGIN_CHALLENGE_PREFIX}${challengeId}`,
    JSON.stringify(payload),
    { expirationTtl: MCP_OAUTH_LOGIN_CHALLENGE_TTL_SECONDS },
  );
  return challengeId;
}

export async function consumeMcpOAuthLoginChallenge(env, challengeId) {
  if (!env?.SESSION_CACHE?.get) return null;
  const id = String(challengeId || '').trim();
  if (!id.startsWith('olc_')) return null;
  const key = `${MCP_OAUTH_LOGIN_CHALLENGE_PREFIX}${id}`;
  const raw = await env.SESSION_CACHE.get(key);
  if (!raw) return null;
  await env.SESSION_CACHE.delete(key).catch(() => {});
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** GET /api/oauth/login-challenge/resume?challenge=olc_* — requires session; continues MCP authorize. */
export async function handleMcpOAuthLoginChallengeResume(request, env) {
  const url = new URL(request.url);
  const challengeId = String(url.searchParams.get('challenge') || '').trim();
  const authUser = await getAuthUser(request, env);

  if (!authUser) {
    const login = new URL('/auth/login', url.origin);
    if (challengeId.startsWith('olc_')) {
      login.searchParams.set('flow', 'oauth');
      login.searchParams.set('challenge', challengeId);
    } else {
      login.searchParams.set('error', 'oauth_challenge_invalid');
    }
    return Response.redirect(login.href, 302);
  }

  if (!challengeId.startsWith('olc_')) {
    return mcpOAuthJsonError('invalid_challenge', 400);
  }

  const payload = await consumeMcpOAuthLoginChallenge(env, challengeId);
  if (!payload?.client_id || !payload?.state || !payload?.code_challenge) {
    const login = new URL('/auth/login', url.origin);
    login.searchParams.set('error', 'oauth_challenge_expired');
    return Response.redirect(login.href, 302);
  }

  return Response.redirect(buildMcpOAuthAuthorizeUrl(url.origin, payload), 302);
}
