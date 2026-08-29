/**
 * CMS live edit sessions — D1 cms_live_edit_sessions + SESSION_CACHE + IAM_COLLAB room.
 */
import {
  cmsBootstrapKey,
  deleteCmsLiveSessionKv,
  putCmsLiveSessionKv,
} from './cms-kv-cache.js';

function newSessionToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `cmses_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function newSessionId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `edit_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** @param {string} pageId */
export function cmsCollabRoomName(pageId) {
  return `cms:${String(pageId || '').trim()}`;
}

/**
 * @param {any} env
 * @param {{
 *   pageId: string,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 * }} opts
 */
export async function joinCmsLiveEditSession(env, opts) {
  const pageId = String(opts?.pageId || '').trim();
  const userId = String(opts?.userId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  if (!env?.DB || !pageId || !userId || !workspaceId) {
    return { ok: false, error: 'missing_context' };
  }

  const page = await env.DB.prepare(
    `SELECT id, project_slug FROM cms_pages WHERE id = ? LIMIT 1`,
  )
    .bind(pageId)
    .first()
    .catch(() => null);
  if (!page?.id) return { ok: false, error: 'page_not_found' };

  const projectSlug = String(page.project_slug || '').trim();
  const sessionId = newSessionId();
  const sessionToken = newSessionToken();
  const collabRoom = cmsCollabRoomName(pageId);
  const bootstrapCacheKey = cmsBootstrapKey(workspaceId, projectSlug);

  await env.DB.prepare(
    `INSERT INTO cms_live_edit_sessions (id, page_id, user_id, session_token, is_active, last_activity, created_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(session_token) DO UPDATE SET
       is_active = 1,
       last_activity = datetime('now')`,
  )
    .bind(sessionId, pageId, userId, sessionToken)
    .run()
    .catch(async () => {
      await env.DB.prepare(
        `UPDATE cms_live_edit_sessions
         SET is_active = 1, last_activity = datetime('now')
         WHERE page_id = ? AND user_id = ?`,
      )
        .bind(pageId, userId)
        .run()
        .catch(() => {});
    });

  await putCmsLiveSessionKv(env, {
    pageId,
    userId,
    sessionId,
    sessionToken,
    collabRoom,
    workspaceId,
    bootstrapCacheKey,
  });

  return {
    ok: true,
    session_id: sessionId,
    session_token: sessionToken,
    collab_room: collabRoom,
    bootstrap_cache_key: bootstrapCacheKey,
    project_slug: projectSlug,
    page_id: pageId,
    do_binding: 'IAM_COLLAB',
    kv_binding: 'SESSION_CACHE',
  };
}

/**
 * @param {any} env
 * @param {{ pageId: string, userId: string, sessionToken?: string|null }} opts
 */
export async function touchCmsLiveEditSession(env, opts) {
  const pageId = String(opts?.pageId || '').trim();
  const userId = String(opts?.userId || '').trim();
  if (!env?.DB || !pageId || !userId) return;
  await env.DB.prepare(
    `UPDATE cms_live_edit_sessions
     SET last_activity = datetime('now'), is_active = 1
     WHERE page_id = ? AND user_id = ?`,
  )
    .bind(pageId, userId)
    .run()
    .catch(() => {});
}

/**
 * @param {any} env
 * @param {{ pageId: string, userId: string }} opts
 */
export async function leaveCmsLiveEditSession(env, opts) {
  const pageId = String(opts?.pageId || '').trim();
  const userId = String(opts?.userId || '').trim();
  if (!env?.DB || !pageId || !userId) return;
  await env.DB.prepare(
    `UPDATE cms_live_edit_sessions
     SET is_active = 0, last_activity = datetime('now')
     WHERE page_id = ? AND user_id = ?`,
  )
    .bind(pageId, userId)
    .run()
    .catch(() => {});
  await deleteCmsLiveSessionKv(env, pageId, userId);
}
