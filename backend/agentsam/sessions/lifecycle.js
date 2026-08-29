/**
 * Session lifecycle coordination — R2 archive init after D1 row create.
 * Not D1 CRUD (see metadata-repository.js).
 *
 * @module backend/agentsam/sessions/lifecycle
 */
import { initChatSessionR2 } from './compaction/archive.js';

/**
 * Best-effort R2 meta init after a new agentsam_chat_sessions insert.
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   conversationId: string,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   title?: string,
 * }} session
 */
export function scheduleChatSessionR2Init(env, ctx, session) {
  const workspaceId = session.workspaceId != null ? String(session.workspaceId).trim() : '';
  if (!workspaceId) return;
  const task = initChatSessionR2(env, session).catch((e) =>
    console.warn('[lifecycle] initChatSessionR2', e?.message ?? e),
  );
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else void task;
}
