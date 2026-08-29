/**
 * Canonical identity resolver for OAuth/integration credential storage.
 *
 * user_oauth_tokens.user_id is always the canonical auth_users.id.
 * This leaf deliberately has no dependency on an integrations domain.
 *
 * Does not query auth_users directly — delegates to
 * resolveAuthUserId() in identity-context.js, the sole reader.
 */

import { resolveAuthUserId } from '../contracts/identity-context.js';

/**
 * @param {any} env
 * @param {{id?: string|null, email?: string|null}|null|undefined} authUser
 * @returns {Promise<string|null>}
 */
export async function resolveIntegrationUserId(env, authUser) {
  return resolveAuthUserId(env, { id: authUser?.id, email: authUser?.email });
}

/**
 * GitHub repository cache invalidation is optional.
 * AgentSamRemix can run without SESSION_CACHE.
 */
export async function invalidateGithubReposSessionCache(
  env,
  userId,
  accountIdentifier = '',
  workspaceId = '',
) {
  if (!env?.SESSION_CACHE?.delete || !userId) return;

  const uid = String(userId).trim();
  const acct = String(accountIdentifier || '').trim() || '_';
  const ws = String(workspaceId || '').trim() || '_';

  const keys = new Set([
    `github:repos:v2:${uid}:${acct}:${ws}`,
    `github:repos:v2:${uid}:_:_`,
    `github:repos:v2:${uid}:${acct}:_`,
    `github:repos:v2:${uid}:_:${ws}`,
    `github:repos:${uid}:${acct}:${ws}`,
    `github:repos:${uid}:_:_`,
    `github:repos:${uid}:${acct}:_`,
    `github:repos:${uid}:_:${ws}`,
  ]);

  for (const key of keys) {
    try {
      await env.SESSION_CACHE.delete(key);
    } catch {
      // Cache invalidation is non-authoritative.
    }
  }
}

export function githubPrivateResponse(body, status = 200, extra = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    ...extra,
  });

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}
