/**
 * user_oauth_tokens liveness — keep is_active honest.
 *
 * Law: is_active is not a permanent insert default. Expire / revoke / refresh
 * failure must flip it to 0. updated_at is INTEGER unixepoch only.
 */

import {
  getIntegrationOAuthRow,
  markOAuthTokenInactive,
  normalizeOAuthUpdatedAtText,
} from '../../backend/identity/oauth/user-token.js';

/**
 * Deactivate expired tokens that cannot refresh, then attempt refresh on the rest.
 * @param {any} env
 * @returns {Promise<{ normalized: number, deactivated: number, refreshed: number, refreshFailed: number }>}
 */
export async function sweepOAuthTokenLiveness(env) {
  const out = { normalized: 0, deactivated: 0, refreshed: 0, refreshFailed: 0 };
  if (!env?.DB) return out;

  try {
    out.normalized = await normalizeOAuthUpdatedAtText(env);
  } catch (e) {
    console.warn('[oauth-liveness] normalize updated_at', e?.message ?? e);
  }

  // Dead without refresh material — decorative is_active=1.
  try {
    const r = await env.DB.prepare(
      `UPDATE user_oauth_tokens
       SET is_active = 0,
           updated_at = unixepoch(),
           last_refresh_at = unixepoch(),
           last_refresh_error_code = COALESCE(last_refresh_error_code, 'ACCESS_EXPIRED_NO_REFRESH')
       WHERE COALESCE(is_active, 1) = 1
         AND revoked_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < unixepoch()
         AND (refresh_token IS NULL OR length(trim(refresh_token)) = 0)
         AND (refresh_token_encrypted IS NULL OR length(trim(refresh_token_encrypted)) = 0)
         AND (vault_refresh_token_id IS NULL OR length(trim(vault_refresh_token_id)) = 0)`,
    ).run();
    out.deactivated += Number(r?.meta?.changes ?? r?.changes ?? 0) || 0;
  } catch (e) {
    console.warn('[oauth-liveness] deactivate no-refresh', e?.message ?? e);
  }

  // Expired with refresh — try live refresh; deactivate on failure.
  let candidates = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT user_id, provider, account_identifier, expires_at
       FROM user_oauth_tokens
       WHERE COALESCE(is_active, 1) = 1
         AND revoked_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < unixepoch()
         AND (
           (refresh_token IS NOT NULL AND length(trim(refresh_token)) > 0)
           OR (refresh_token_encrypted IS NOT NULL AND length(trim(refresh_token_encrypted)) > 0)
           OR (vault_refresh_token_id IS NOT NULL AND length(trim(vault_refresh_token_id)) > 0)
         )
       LIMIT 40`,
    ).all();
    candidates = results || [];
  } catch (e) {
    console.warn('[oauth-liveness] list refreshable', e?.message ?? e);
    return out;
  }

  for (const row of candidates) {
    const userId = String(row.user_id || '');
    const provider = String(row.provider || '');
    const account = row.account_identifier != null ? String(row.account_identifier) : '';
    if (!userId || !provider) continue;
    try {
      const live = await getIntegrationOAuthRow(env, userId, provider, account);
      if (!live?.access_token) {
        await markOAuthTokenInactive(env, userId, provider, account, 'PROVIDER_REFRESH_FAILED');
        out.refreshFailed += 1;
        out.deactivated += 1;
        continue;
      }
      // Re-read expires_at from D1 — getIntegrationOAuthRow may have refreshed;
      // never trust a stale candidate expires_at for ACCESS_STILL_EXPIRED.
      const fresh = await env.DB.prepare(
        `SELECT expires_at, COALESCE(is_active, 1) AS is_active
         FROM user_oauth_tokens
         WHERE user_id = ? AND provider = ? AND account_identifier = ?
         LIMIT 1`,
      )
        .bind(userId, provider, account)
        .first()
        .catch(() => null);
      const exp =
        fresh?.expires_at != null && fresh.expires_at !== ''
          ? Number(fresh.expires_at)
          : live.expires_at != null && live.expires_at !== ''
            ? Number(live.expires_at)
            : null;
      const stillExpired = exp != null && Number.isFinite(exp) && exp < Math.floor(Date.now() / 1000);
      if (stillExpired) {
        await markOAuthTokenInactive(env, userId, provider, account, 'ACCESS_STILL_EXPIRED');
        out.refreshFailed += 1;
        out.deactivated += 1;
      } else {
        out.refreshed += 1;
      }
    } catch (e) {
      console.warn('[oauth-liveness] refresh', provider, e?.message ?? e);
      try {
        await markOAuthTokenInactive(env, userId, provider, account, 'REFRESH_SWEEP_ERROR');
        out.refreshFailed += 1;
        out.deactivated += 1;
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}
