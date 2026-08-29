/**
 * SESSION_CACHE hot-path for resolved dashboard theme payloads (`GET /api/themes/active`).
 *
 * Key pattern (per user + workspace + optional project):
 *   theme:active:{workspaceId}:{userId}:{projectId}
 *
 * Docs historically referenced `theme:{user_id}`; workspace-scoped keys avoid cross-workspace bleed.
 */

export const CMS_THEME_ACTIVE_TTL_SEC = 86400;

/** @param {string | null | undefined} workspaceId @param {string | null | undefined} userId @param {string | null | undefined} projectId */
export function cmsThemeActiveKey(workspaceId, userId, projectId) {
  const ws = String(workspaceId || "_").trim() || "_";
  const uid = String(userId || "_").trim() || "_";
  const proj = String(projectId || "_").trim() || "_";
  return `theme:active:${ws}:${uid}:${proj}`;
}

/**
 * @param {any} env
 * @param {string | null | undefined} workspaceId
 * @param {string | null | undefined} userId
 * @param {string | null | undefined} projectId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getCachedActiveThemePayload(env, workspaceId, userId, projectId) {
  const kv = env?.SESSION_CACHE;
  const uid = userId != null ? String(userId).trim() : "";
  if (!kv || !uid) return null;
  const raw = await kv.get(cmsThemeActiveKey(workspaceId, uid, projectId)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.slug != null) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

/**
 * @param {any} env
 * @param {string | null | undefined} workspaceId
 * @param {string | null | undefined} userId
 * @param {string | null | undefined} projectId
 * @param {Record<string, unknown>} payload
 */
export async function putCachedActiveThemePayload(env, workspaceId, userId, projectId, payload) {
  const kv = env?.SESSION_CACHE;
  const uid = userId != null ? String(userId).trim() : "";
  if (!kv || !uid || !payload || typeof payload !== "object") return;
  const copy = { ...payload };
  delete copy.cache_hit;
  await kv
    .put(cmsThemeActiveKey(workspaceId, uid, projectId), JSON.stringify(copy), {
      expirationTtl: CMS_THEME_ACTIVE_TTL_SEC,
    })
    .catch(() => {});
}

/**
 * Drop cached active payloads for a workspace/user pair (all project variants).
 * @param {any} env
 * @param {string | null | undefined} workspaceId
 * @param {string | null | undefined} userId
 */
export async function invalidateCachedActiveThemePayload(env, workspaceId, userId) {
  const kv = env?.SESSION_CACHE;
  const uid = userId != null ? String(userId).trim() : "";
  if (!kv || !uid) return;
  const keys = [
    cmsThemeActiveKey(workspaceId, uid, null),
    cmsThemeActiveKey(workspaceId, uid, "_"),
    cmsThemeActiveKey(workspaceId, uid, ""),
  ];
  await Promise.all(keys.map((k) => kv.delete(k).catch(() => {})));
}
