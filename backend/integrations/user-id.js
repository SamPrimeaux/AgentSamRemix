/**
 * Canonical auth_users.id for integration OAuth / API key lookups.
 * user_oauth_tokens.user_id is always au_* — never email, never usr_*.
 */
import { resolveCanonicalUserId } from '../identity/users/index.js';

/**
 * @param {any} env
 * @param {{ id?: string | null, email?: string | null } | null | undefined} authUser
 * @returns {Promise<string | null>}
 */
export async function resolveIntegrationUserId(env, authUser) {
  const raw = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!raw || !env) return null;
  return resolveCanonicalUserId(raw, env);
}
