/** True only for canonical auth_users ids. */
export function isAuthUserId(userId) {
  return typeof userId === 'string' && userId.trim().startsWith('au_');
}

/**
 * Resolve a session identity to the canonical auth_users.id plane.
 *
 * Never throws. Prefix-valid session ids remain usable during a transient D1
 * failure, but non-canonical identifiers are never translated or invented.
 *
 * @param {string | null | undefined} userId
 * @param {any} env
 * @returns {Promise<string | null>}
 */
export async function resolveCanonicalUserId(userId, env) {
  if (userId == null || userId === '') return null;
  const canonicalId = String(userId).trim();
  if (!canonicalId.startsWith('au_')) return null;
  if (!env?.DB) return canonicalId;

  try {
    const row = await env.DB.prepare(`SELECT id FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(canonicalId)
      .first();
    const resolvedId = row?.id != null ? String(row.id).trim() : '';
    return resolvedId.startsWith('au_') ? resolvedId : null;
  } catch {
    return canonicalId;
  }
}
