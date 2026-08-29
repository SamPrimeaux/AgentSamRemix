/**
 * Coordinated chat-session purge — D1 metadata + R2 archive + DO wipe + run cleanup.
 *
 * @module backend/agentsam/sessions/purge
 */
import {
  getChatSessionArchiveKeys,
  deleteChatSessionRow,
} from './metadata-repository.js';
import { wipeChatSessionDo } from './chat-do-client.js';
import { cancelAgentRunsForConversation } from '../../telemetry/agent-run.js';

export const PURGE_ARCHIVED_CHAT_CONFIRM = 'PURGE_ARCHIVED_CHAT_SESSIONS';

/**
 * Hard-delete a chat session: D1 row + best-effort R2 + DO wipe + cancel runs.
 * @param {any} env
 * @param {{ conversationId: string, userId: string, tenantId: string }} input
 */
export async function deleteUserChatSession(env, input) {
  const conversationId = String(input.conversationId || '').trim();
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  if (!conversationId || !userId || !tenantId) return { ok: false, error: 'missing_context' };

  const looked = await getChatSessionArchiveKeys(env, { conversationId, userId, tenantId });
  if (!looked.ok) return { ok: false, error: looked.error || 'lookup_failed' };
  const row = looked.row;

  const bucket = env.AUTORAG_BUCKET ?? env.R2 ?? null;
  if (bucket && row) {
    const keys = [row.r2_messages_key, row.r2_meta_key, row.latest_digest_r2_key]
      .map((k) => (k != null ? String(k).trim() : ''))
      .filter(Boolean);
    for (const key of keys) {
      try {
        await bucket.delete(key);
      } catch {
        /* best-effort */
      }
    }
  }

  void wipeChatSessionDo(env, conversationId).catch((e) =>
    console.warn('[deleteUserChatSession] do_wipe', e?.message ?? e),
  );

  const deleted = await deleteChatSessionRow(env, { conversationId, userId, tenantId });
  if (!deleted.ok) return deleted;

  if (env?.DB) {
    await cancelAgentRunsForConversation(env, {
      conversationId,
      userId,
      tenantId,
      reason: 'chat_session_purged',
      limit: 50,
    }).catch(() => {});
  }

  return { ok: true };
}

/**
 * @param {any} env
 * @param {{ dryRun?: boolean, limit?: number }} [opts]
 */
export async function purgeArchivedChatSessions(env, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'DB not configured' };

  const dryRun = opts.dryRun !== false;
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);

  const { results } = await env.DB.prepare(
    `SELECT conversation_id, user_id, tenant_id, title, updated_at
     FROM agentsam_chat_sessions
     WHERE COALESCE(is_archived, 0) = 1
     ORDER BY updated_at ASC
     LIMIT ?`,
  ).bind(limit).all().catch(() => ({ results: [] }));

  const rows = results || [];
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      count: rows.length,
      sessions: rows.map((r) => ({
        conversation_id: r.conversation_id,
        user_id: r.user_id,
        tenant_id: r.tenant_id,
        title: r.title,
        updated_at: r.updated_at,
      })),
    };
  }

  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    const out = await deleteUserChatSession(env, {
      conversationId: String(row.conversation_id || '').trim(),
      userId: String(row.user_id || '').trim(),
      tenantId: String(row.tenant_id || '').trim(),
    });
    if (out.ok) {
      deleted += 1;
    } else {
      failed += 1;
      errors.push({
        conversation_id: row.conversation_id,
        error: out.error || 'delete_failed',
      });
    }
  }

  return {
    ok: true,
    dry_run: false,
    total: rows.length,
    deleted,
    failed,
    errors,
  };
}
