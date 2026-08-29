import { AUTH_COOKIE_NAME } from '../../auth/constants.js';
import {
  edgeClaimsToSessionPayload,
  isEdgeSessionToken,
  isLegacySessionId,
  isSessionRevokedInKv,
  resolveSessionFromCookieValue,
  readAuthRevFromCache,
} from '../../auth/session-tokens.js';
import { loadFeatureFlagsCached } from '../permissions/feature-flags.js';
import { authSessionRowToKvPayload, trimSessionField } from './fields.js';
import { authSessionIsActive } from './mint.js';

/**
 * Session feature flags: JWT snapshot on edge sessions; KV cache for legacy cookies.
 * Never hits D1 when flags are already embedded or KV is warm.
 */
async function attachFeatureFlagsToSession(env, session) {
  if (!session?.user_id) return session;
  if (session.feature_flags && typeof session.feature_flags === 'object') return session;
  try {
    const feature_flags = await loadFeatureFlagsCached(env, session.user_id, session.tenant_id);
    return { ...session, feature_flags };
  } catch {
    return { ...session, feature_flags: {} };
  }
}

/** Global Session Retrieval — edge JWT first, legacy D1/KV fallback. */
export async function getSession(env, request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const regex = new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`, 'g');
  let match;
  const sessionCandidates = [];
  while ((match = regex.exec(cookieHeader)) !== null) sessionCandidates.push(match[1]);
  if (sessionCandidates.length === 0) return null;

  let bestEdgePayload = null;
  let bestEdgeExp = -1;
  for (const sessionId of sessionCandidates) {
    const raw = trimSessionField(decodeURIComponent(String(sessionId || '')));
    if (!raw) continue;
    const resolved = await resolveSessionFromCookieValue(env, raw);
    if (resolved.claims) {
      const sid = trimSessionField(resolved.sessionId);
      if (!sid || (await isSessionRevokedInKv(env, sid))) continue;
      const userId = trimSessionField(resolved.claims.sub);
      const tokenRev = Number(resolved.claims.rev) || 0;
      const cachedRev = userId ? await readAuthRevFromCache(env, userId) : null;
      if (cachedRev != null && cachedRev > tokenRev) continue;
      const exp = Number(resolved.claims.exp) || 0;
      if (exp >= bestEdgeExp) {
        bestEdgeExp = exp;
        bestEdgePayload = edgeClaimsToSessionPayload(resolved.claims);
      }
      continue;
    }
    if (!resolved.legacy || !isLegacySessionId(resolved.sessionId || raw)) continue;
  }

  if (bestEdgePayload) return attachFeatureFlagsToSession(env, bestEdgePayload);

  let bestRow = null;
  let bestCreatedMs = -1;
  if (env.DB) {
    for (const sessionId of sessionCandidates) {
      const raw = trimSessionField(decodeURIComponent(String(sessionId || '')));
      if (!raw || isEdgeSessionToken(raw)) continue;
      const sid = isLegacySessionId(raw) ? raw : trimSessionField(raw);
      if (!sid) continue;
      try {
        const row = await env.DB.prepare(
          `SELECT
             id, user_id, tenant_id, workspace_id, person_uuid, supabase_user_id,
             email, provider, display_name, avatar_url, provider_subject,
             work_session_id, last_active_at, expires_at, created_at
           FROM auth_sessions
           WHERE id = ?
             AND datetime(expires_at) > datetime('now')
             AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
           LIMIT 1`,
        )
          .bind(sid)
          .first();
        if (!row?.id) continue;
        const createdMs = row.created_at
          ? Date.parse(String(row.created_at).replace(' ', 'T') + 'Z')
          : 0;
        if (!Number.isFinite(createdMs)) {
          if (!bestRow) bestRow = row;
          continue;
        }
        if (createdMs >= bestCreatedMs) {
          bestCreatedMs = createdMs;
          bestRow = row;
        }
      } catch {}
    }
  }

  if (bestRow) {
    const payload = authSessionRowToKvPayload(bestRow);
    if (env.SESSION_CACHE) {
      try {
        const { putSessionKvPayload } = await import(
          '../../services/session-context/kv-cache.js'
        );
        await putSessionKvPayload(env, bestRow.id, payload, 3600);
      } catch {}
    }
    return attachFeatureFlagsToSession(env, payload);
  }

  for (const sessionId of sessionCandidates) {
    const raw = trimSessionField(decodeURIComponent(String(sessionId || '')));
    if (!raw || isEdgeSessionToken(raw)) continue;
    const sid = isLegacySessionId(raw) ? raw : trimSessionField(raw);
    if (!sid || !env.SESSION_CACHE) continue;
    try {
      const { getSessionKvPayload, deleteSessionKvPayload } = await import(
        '../../services/session-context/kv-cache.js'
      );
      const parsed = await getSessionKvPayload(env, sid);
      if (!parsed) continue;
      const stillActive = await authSessionIsActive(env, sid);
      if (!stillActive) {
        try {
          await deleteSessionKvPayload(env, sid);
        } catch {}
        continue;
      }
      return attachFeatureFlagsToSession(env, { ...parsed, session_id: sid });
    } catch {}
  }
  return null;
}
