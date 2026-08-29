import { AUTH_SESSION_TTL_SECONDS } from '../../auth/constants.js';
import { buildSessionKvPayload } from './fields.js';

/**
 * @param {*} env
 * @param {string} sessionId
 * @param {string} userId auth_users.id
 * @param {string|null} tenantId
 * @param {string|null} expiresAtIso
 * @param {object} [extra] Optional session context (workspace_id, person_uuid, email, …)
 */
export async function writeIamSessionToKv(env, sessionId, userId, tenantId, expiresAtIso, extra = {}) {
  if (!env.SESSION_CACHE || !sessionId || !userId) return;
  const payload = buildSessionKvPayload(sessionId, {
    userId,
    tenantId,
    expiresAtIso,
    ...(extra && typeof extra === 'object' ? extra : {}),
  });
  try {
    const ms = expiresAtIso ? new Date(expiresAtIso).getTime() - Date.now() : 0;
    const ttl =
      ms > 0
        ? Math.max(300, Math.min(AUTH_SESSION_TTL_SECONDS, Math.floor(ms / 1000)))
        : AUTH_SESSION_TTL_SECONDS;
    const { putSessionKvPayload } = await import(
      '../../services/session-context/kv-cache.js'
    );
    await putSessionKvPayload(env, sessionId, payload, ttl);
  } catch {}
}
