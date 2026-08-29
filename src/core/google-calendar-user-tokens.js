/**
 * Canonical Google Calendar OAuth token resolution — au_* user_id, multi-account.
 */

import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';

export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';

async function queryCalendarTokenRows(env, canonicalUserId, legacyEmail = '') {
  if (!env?.DB || !canonicalUserId) return [];
  const keys = new Set([canonicalUserId]);
  const email = String(legacyEmail || '').trim().toLowerCase();
  if (email && email !== canonicalUserId.toLowerCase()) keys.add(email);

  const all = [];
  for (const userKey of keys) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, provider, account_identifier, tenant_id, workspace_id,
              expires_at, scope, updated_at, account_email, account_display, metadata_json
       FROM user_oauth_tokens
       WHERE user_id = ? AND lower(provider) = 'google_calendar'
       ORDER BY updated_at DESC`,
    )
      .bind(userKey)
      .all()
      .catch(() => ({ results: [] }));
    for (const row of results || []) {
      const acct = String(row.account_identifier || '').trim().toLowerCase();
      if (all.some((x) => String(x.account_identifier || '').trim().toLowerCase() === acct)) continue;
      all.push({ ...row, user_id: canonicalUserId, provider: GOOGLE_CALENDAR_PROVIDER });
    }
  }
  return all;
}

/** @param {*} env @param {{ id?: string, email?: string } | null | undefined} authUser */
export async function listGoogleCalendarTokenRowsForUser(env, authUser) {
  const canonicalUserId = await resolveIntegrationUserId(env, authUser);
  if (!canonicalUserId) return [];
  const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
  return queryCalendarTokenRows(env, canonicalUserId, email);
}

/** All connected calendar tokens (cron sync). */
export async function listAllGoogleCalendarTokenRows(env) {
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT user_id, provider, account_identifier, tenant_id, workspace_id,
            expires_at, scope, updated_at, account_email, account_display, metadata_json
     FROM user_oauth_tokens
     WHERE lower(provider) = 'google_calendar'
     ORDER BY updated_at DESC`,
  )
    .all()
    .catch(() => ({ results: [] }));
  return results || [];
}
