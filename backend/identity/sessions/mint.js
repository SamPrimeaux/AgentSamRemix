import {
  AUTH_SESSION_TTL_SECONDS,
  MAX_AGENT_SESSION_TTL_SECONDS,
  MIN_AGENT_SESSION_TTL_SECONDS,
  DEFAULT_AGENT_SESSION_TTL_SECONDS,
} from '../../auth/constants.js';
import { mintEdgeSessionToken } from '../../auth/session-tokens.js';
import { loadFeatureFlagsCached } from '../permissions/feature-flags.js';
import { trimSessionField } from './fields.js';

/** D1 check: session exists, not revoked, not expired. */
export async function authSessionIsActive(env, sessionId) {
  const id = trimSessionField(sessionId);
  if (!env?.DB || !id) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM auth_sessions
       WHERE id = ?
         AND datetime(expires_at) > datetime('now')
         AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
       LIMIT 1`,
    )
      .bind(id)
      .first();
    return !!row?.id;
  } catch {
    return false;
  }
}

/**
 * Mint HS256 edge session JWT after login / workspace switch.
 * @param {*} env
 * @param {object} input
 */
export async function mintBrowserSessionToken(env, input) {
  const ttlSec =
    input.ttlSec != null
      ? Math.min(
          MAX_AGENT_SESSION_TTL_SECONDS,
          Math.max(
            MIN_AGENT_SESSION_TTL_SECONDS,
            Number(input.ttlSec) || DEFAULT_AGENT_SESSION_TTL_SECONDS,
          ),
        )
      : AUTH_SESSION_TTL_SECONDS;
  const featureFlags =
    input.featureFlags ??
    (await loadFeatureFlagsCached(env, input.userId, input.tenantId).catch(() => ({})));
  const token = await mintEdgeSessionToken(env, {
    sessionId: input.sessionId,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    email: input.email,
    personUuid: input.personUuid,
    displayName: input.displayName,
    authRev: input.authRev,
    capabilities: input.capabilities,
    featureFlags,
    ttlSec,
  });
  if (!token) throw new Error('edge_session_token_unavailable');
  return token;
}
