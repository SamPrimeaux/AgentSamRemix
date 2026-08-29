import { chatSessionR2Prefix, readR2Text } from '../../runtime/exec-context-tier.js';

/**
 * @param {any} env
 * @param {string} conversationId
 * @returns {Promise<string|null>}
 */
export async function getChatDigestText(env, conversationId) {
  const convId = String(conversationId || '').trim();
  if (!convId || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT latest_digest_r2_key FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
    )
      .bind(convId)
      .first();
    const key = row?.latest_digest_r2_key != null ? String(row.latest_digest_r2_key).trim() : '';
    if (!key) return null;
    return readR2Text(env, key);
  } catch (e) {
    console.warn('[getChatDigestText]', e?.message ?? e);
    return null;
  }
}

/**
 * Write meta.json to R2 and backfill r2_messages_key + r2_meta_key on the D1 row.
 * Called once after a new agentsam_chat_sessions row is inserted.
 *
 * @param {any} env
 * @param {{
 *   conversationId: string,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   title?: string,
 * }} session
 * @returns {Promise<{ ok: boolean, metaKey: string, messagesKey: string }>}
 */
export async function initChatSessionR2(env, session) {
  const conversationId = String(session.conversationId || '').trim();
  const userId = String(session.userId || '').trim();
  const workspaceId = String(session.workspaceId || '').trim();
  const tenantId = String(session.tenantId || '').trim();

  if (!conversationId || !userId || !workspaceId) {
    return { ok: false, metaKey: '', messagesKey: '' };
  }

  const prefix = chatSessionR2Prefix({ userId, workspaceId, conversationId });
  const metaKey = `${prefix}/meta.json`;
  const messagesKey = `${prefix}/messages.jsonl`;

  const meta = {
    conversation_id: conversationId,
    user_id: userId,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    title: String(session.title || 'New Chat').trim(),
    created_at: new Date().toISOString(),
    r2_messages_key: messagesKey,
  };

  try {
    if (env.AUTORAG_BUCKET) {
      await env.AUTORAG_BUCKET.put(metaKey, JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
      });
    } else if (env.R2) {
      await env.R2.put(metaKey, JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  } catch (e) {
    console.warn('[initChatSessionR2] R2 meta write failed', e?.message ?? e);
  }

  if (env.DB && conversationId && tenantId) {
    try {
      await env.DB.prepare(
        `UPDATE agentsam_chat_sessions
         SET r2_meta_key = ?, r2_messages_key = ?, updated_at = unixepoch()
         WHERE conversation_id = ? AND tenant_id = ?`,
      )
        .bind(metaKey, messagesKey, conversationId, tenantId)
        .run();
    } catch (e) {
      console.warn('[initChatSessionR2] D1 key backfill failed', e?.message ?? e);
    }
  }

  return { ok: true, metaKey, messagesKey };
}

export async function getChatMessagesFromR2(env, conversationId) {
  const convId = String(conversationId || '').trim();
  let messagesKey = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT r2_messages_key, user_id, workspace_id FROM agentsam_chat_sessions
         WHERE conversation_id = ? LIMIT 1`,
      )
        .bind(convId)
        .first();
      messagesKey = row?.r2_messages_key ?? null;
      if (!messagesKey && row?.user_id && row?.workspace_id) {
        const prefix = chatSessionR2Prefix({
          userId: row.user_id,
          workspaceId: row.workspace_id,
          conversationId: convId,
        });
        messagesKey = `${prefix}/messages.jsonl`;
      }
    } catch (e) {
      console.warn('[getChatMessages] D1 key lookup failed', e?.message ?? e);
    }
  }

  if (!messagesKey) return [];

  const bucket = env.AUTORAG_BUCKET ?? env.R2 ?? null;
  if (!bucket) return [];

  try {
    const obj = await bucket.get(messagesKey);
    if (!obj) return [];
    const raw = await obj.text();
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    console.warn('[getChatMessages] R2 fetch failed', e?.message ?? e);
    return [];
  }
}
