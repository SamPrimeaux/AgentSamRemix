/**
 * Integration OAuth read — Google Drive export for browser captures (no src/core).
 */
import { decryptOAuthTokenCiphertext } from './vault-crypto.js';

function normalizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'gdrive' || p === 'google_drive' || p === 'google_gmail' || p === 'google_calendar') {
    return 'google_drive';
  }
  return p;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} row
 */
export async function resolveOAuthAccessToken(env, row) {
  if (!row) return null;
  if (row.access_token_encrypted) {
    try {
      const dec = await decryptOAuthTokenCiphertext(env, String(row.access_token_encrypted));
      if (dec) return dec;
    } catch (e) {
      console.warn('[browser/capture/integration-oauth] decrypt access_token failed:', e?.message);
    }
  }
  return row.access_token ? String(row.access_token) : null;
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} provider
 */
export async function fetchIntegrationOAuthRow(env, userId, provider) {
  if (!env?.DB || !userId || !provider) return null;
  const prov = normalizeProvider(provider);
  try {
    const row = await env.DB.prepare(
      `SELECT access_token, access_token_encrypted, refresh_token, refresh_token_encrypted,
              expires_at, account_identifier, provider, is_active
         FROM user_oauth_tokens
        WHERE user_id = ?
          AND LOWER(COALESCE(provider, '')) = LOWER(?)
          AND COALESCE(is_active, 1) = 1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`,
    )
      .bind(String(userId).trim(), prov)
      .first();
    return row && typeof row === 'object' ? row : null;
  } catch (e) {
    console.warn('[browser/capture/integration-oauth] fetch row failed:', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function resolveGoogleDriveAccessToken(env, userId) {
  const row = await fetchIntegrationOAuthRow(env, userId, 'google_drive');
  return resolveOAuthAccessToken(env, row);
}
