/**
 * Worker bridge: src/ ↔ backend/services/session-context
 */
export {
  SESSION_CTX_TTL_SECONDS,
  SESSION_PREFS_TTL_SECONDS,
  SESSION_UI_FF_TTL_SECONDS,
  deleteSessionKvPayload,
  getSessionKvPayload,
  patchSessionContextCache,
  putSessionKvPayload,
  putSessionPrefsCache,
  putSessionUiFlagsCache,
} from '../../backend/services/session-context/kv-cache.js';

export {
  SESSION_CTX_PREFIX,
  SESSION_KV_PREFIX,
  SESSION_PREFS_PREFIX,
  SESSION_UI_FF_PREFIX,
  legacySessionKvKey,
  sessionContextKey,
  sessionKvKey,
  sessionPrefsKey,
  sessionUiFlagsKey,
} from '../../backend/services/session-context/kv-keys.js';

/**
 * Write active project into iam:ctx + legacy iam:active_project.
 * @param {unknown} env
 * @param {string} userId
 * @param {Record<string, unknown>} projectPatch
 */
export async function writeActiveProjectSessionContext(env, userId, projectPatch) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  await patchSessionContextCache(env, {
    userId: uid,
    patch: {
      active_project: projectPatch,
      active_project_id: projectPatch.project_id ?? null,
      active_workspace_id: projectPatch.execution_workspace_id ?? null,
    },
  });
  if (env?.SESSION_CACHE?.put) {
    await env.SESSION_CACHE.put(
      `iam:active_project:${uid}`,
      JSON.stringify({ ...projectPatch, activated_at: projectPatch.activated_at ?? Date.now() }),
      { expirationTtl: 14 * 24 * 60 * 60 },
    ).catch(() => null);
  }
  return true;
}
