/**
 * CMS hot-path KV helpers — binding: env.SESSION_CACHE (production-KV_SESSIONS).
 *
 * Key patterns:
 *   cms:bootstrap:{workspaceId}:{projectSlug}
 *   cms:live-session:{pageId}:{userId}
 *   cms:draft:{pageId}:{userId}
 *   cms:publish-lock:{workspaceId}:{projectSlug}
 */

import { CMS_BOOTSTRAP_TTL_SEC, cmsBootstrapKey } from './agentsam/cms/bootstrap/cache-key.js';

export { CMS_BOOTSTRAP_TTL_SEC, cmsBootstrapKey };
export const CMS_LIVE_SESSION_TTL_SEC = 3600;
export const CMS_DRAFT_TTL_SEC = 1800;
export const CMS_PUBLISH_LOCK_TTL_SEC = 120;

/** @param {string} pageId @param {string} userId */
export function cmsLiveSessionKey(pageId, userId) {
  return `cms:live-session:${String(pageId || '').trim()}:${String(userId || '').trim()}`;
}

/** @param {string} pageId @param {string} userId */
export function cmsDraftKey(pageId, userId) {
  return `cms:draft:${String(pageId || '').trim()}:${String(userId || '').trim()}`;
}

/** @param {string} workspaceId @param {string} projectSlug */
export function cmsPublishLockKey(workspaceId, projectSlug) {
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  if (ws && slug) return `cms:publish-lock:${ws}:${slug}`;
  return `cms:publish-lock:${slug}`;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} projectSlug
 */
export async function invalidateCmsBootstrapCache(env, workspaceId, projectSlug) {
  const kv = env?.SESSION_CACHE;
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  if (!kv || !ws || !slug) return;
  await kv.delete(cmsBootstrapKey(ws, slug)).catch(() => {});
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} projectSlug
 * @param {string} userId
 * @returns {Promise<{ acquired: boolean, holder?: string }>}
 */
export async function acquireCmsPublishLock(env, workspaceId, projectSlug, userId) {
  const kv = env?.SESSION_CACHE;
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !slug) return { acquired: true };
  const key = cmsPublishLockKey(ws, slug);
  const existing = await kv.get(key).catch(() => null);
  if (existing && existing !== uid) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed?.user_id && parsed.user_id !== uid) {
        return { acquired: false, holder: String(parsed.user_id) };
      }
    } catch {
      if (existing !== uid) return { acquired: false, holder: existing };
    }
  }
  await kv
    .put(key, JSON.stringify({ user_id: uid, at: Math.floor(Date.now() / 1000) }), {
      expirationTtl: CMS_PUBLISH_LOCK_TTL_SEC,
    })
    .catch(() => {});
  return { acquired: true };
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} projectSlug
 * @param {string} userId
 */
export async function releaseCmsPublishLock(env, workspaceId, projectSlug, userId) {
  const kv = env?.SESSION_CACHE;
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !slug) return;
  const key = cmsPublishLockKey(ws, slug);
  const existing = await kv.get(key).catch(() => null);
  if (!existing) return;
  try {
    const parsed = JSON.parse(existing);
    if (parsed?.user_id === uid) await kv.delete(key).catch(() => {});
  } catch {
    if (existing === uid) await kv.delete(key).catch(() => {});
  }
}

/**
 * @param {any} env
 * @param {{ pageId: string, userId: string, payload: Record<string, unknown> }} opts
 */
export async function putCmsDraftCache(env, { pageId, userId, payload }) {
  const kv = env?.SESSION_CACHE;
  const pid = String(pageId || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !pid || !uid) return;
  await kv
    .put(cmsDraftKey(pid, uid), JSON.stringify({ ...payload, cached_at: Math.floor(Date.now() / 1000) }), {
      expirationTtl: CMS_DRAFT_TTL_SEC,
    })
    .catch(() => {});
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {string} userId
 */
export async function getCmsDraftCache(env, pageId, userId) {
  const kv = env?.SESSION_CACHE;
  const pid = String(pageId || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !pid || !uid) return null;
  const raw = await kv.get(cmsDraftKey(pid, uid)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{ pageId: string, userId: string, sessionId: string, sessionToken: string, collabRoom: string, workspaceId: string, bootstrapCacheKey: string }} row
 */
export async function putCmsLiveSessionKv(env, row) {
  const kv = env?.SESSION_CACHE;
  const pid = String(row?.pageId || '').trim();
  const uid = String(row?.userId || '').trim();
  if (!kv || !pid || !uid) return;
  await kv
    .put(
      cmsLiveSessionKey(pid, uid),
      JSON.stringify({
        session_id: row.sessionId,
        session_token: row.sessionToken,
        collab_room: row.collabRoom,
        workspace_id: row.workspaceId,
        bootstrap_cache_key: row.bootstrapCacheKey,
        page_id: pid,
        user_id: uid,
        updated_at: Math.floor(Date.now() / 1000),
      }),
      { expirationTtl: CMS_LIVE_SESSION_TTL_SEC },
    )
    .catch(() => {});
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {string} userId
 */
export async function deleteCmsLiveSessionKv(env, pageId, userId) {
  const kv = env?.SESSION_CACHE;
  const pid = String(pageId || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !pid || !uid) return;
  await kv.delete(cmsLiveSessionKey(pid, uid)).catch(() => {});
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {string} userId
 */
export async function deleteCmsDraftCache(env, pageId, userId) {
  const kv = env?.SESSION_CACHE;
  const pid = String(pageId || '').trim();
  const uid = String(userId || '').trim();
  if (!kv || !pid || !uid) return;
  await kv.delete(cmsDraftKey(pid, uid)).catch(() => {});
}
