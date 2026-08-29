/**
 * agentsam_chat_sessions — D1 session metadata only (create/get/list/patch/deleteRow).
 *
 * Lifecycle R2 init → lifecycle.js
 * Coordinated delete (D1+DO+R2+runs) → purge.js
 *
 * @module backend/agentsam/sessions/metadata-repository
 */
import { workspaceRowExists } from '../../identity/workspace/agentsam-workspace.js';
import { expandChatProjectRefs } from './project-bind.js';
import { isD1OverloadError, withD1Retry } from '../../../src/core/d1-retry.js';
import { toEpochSeconds } from '../../services/database/d1-time.js';
import { deriveChatSessionTitle } from './title.js';
import {
  resolveExplicitSessionProjectId,
  resolveSessionPatchProjectId,
} from './project-bind.js';
import { scheduleChatSessionR2Init } from './lifecycle.js';

/**
 * Synchronous ensure of agentsam_chat_sessions row (spawn children / handoff).
 * Fail loud — callers must not attach agent_run / timers without a real conversation.
 *
 * @param {any} env
 * @param {{
 *   conversationId: string,
 *   tenantId: string,
 *   userId: string,
 *   workspaceId?: string|null,
 *   title?: string|null,
 *   modelKey?: string|null,
 *   parentConversationId?: string|null,
 * }} p
 * @returns {Promise<{ ok: true, conversationId: string, inserted: boolean }>}
 */
export async function ensureChatSessionRow(env, p) {
  if (!env?.DB) throw new Error('Database not configured');
  const conversationId = String(p.conversationId || '').trim();
  const tenantId = String(p.tenantId || '').trim();
  const userId = String(p.userId || '').trim();
  if (!conversationId) throw new Error('conversation_id_required');
  if (!tenantId) throw new Error('tenant_id_required');
  if (!userId) throw new Error('user_id_required');

  const workspaceId =
    p.workspaceId != null && String(p.workspaceId).trim()
      ? String(p.workspaceId).trim()
      : null;
  if (workspaceId && !(await workspaceRowExists(env, workspaceId))) {
    throw new Error(`invalid_workspace_id:${workspaceId}`);
  }
  const title =
    p.title != null && String(p.title).trim()
      ? String(p.title).trim().slice(0, 200)
      : 'Agent chat';

  const existing = await env.DB.prepare(
    `SELECT conversation_id FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
  )
    .bind(conversationId)
    .first();
  if (existing?.conversation_id) {
    return { ok: true, conversationId, inserted: false };
  }

  const ins = await env.DB.prepare(
    `INSERT INTO agentsam_chat_sessions (
       conversation_id, tenant_id, user_id, workspace_id, title,
       message_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())`,
  )
    .bind(conversationId, tenantId, userId, workspaceId, title)
    .run();

  const inserted = Number(ins?.meta?.changes ?? ins?.changes ?? 0) > 0;
  if (!inserted) {
    const again = await env.DB.prepare(
      `SELECT conversation_id FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
    )
      .bind(conversationId)
      .first();
    if (!again?.conversation_id) throw new Error(`chat_session_insert_failed:${conversationId}`);
  }

  if (inserted && workspaceId) {
    scheduleChatSessionR2Init(env, null, {
      conversationId,
      userId,
      workspaceId,
      tenantId,
      title,
    });
  }

  return { ok: true, conversationId, inserted: true, parentConversationId: p.parentConversationId ?? null };
}

/**
 * Non-blocking INSERT OR IGNORE for first message on a conversation.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   conversationId?: string|null,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   message?: string|null,
 *   modelKey?: string|null,
 *   activeFileEnvelope?: { github_repo?: string|null }|null,
 *   body?: Record<string, unknown>|null,
 *   projectRef?: string|null,
 *   projectExplicit?: boolean,
 * }} input
 */
export function scheduleChatSessionTitleInsert(env, ctx, input) {
  const conversationId =
    input.conversationId != null ? String(input.conversationId).trim() : '';
  const tenantId = input.tenantId != null ? String(input.tenantId).trim() : '';
  const userId = input.userId != null ? String(input.userId).trim() : '';
  const message = input.message != null ? String(input.message).trim() : '';

  if (!env?.DB || !conversationId || !tenantId || !userId || !message) return;

  let workspaceId = input.workspaceId != null ? String(input.workspaceId).trim() : null;
  const title = deriveChatSessionTitle(message);

  const work = (async () => {
    try {
      if (workspaceId && !(await workspaceRowExists(env, workspaceId))) {
        console.warn('[agentsam_chat_sessions] unknown workspace_id — storing session without workspace', {
          workspaceId,
          conversationId,
        });
        workspaceId = null;
      }

      const projectExplicit = input.projectExplicit === true;
      const resolvedProjectId = await resolveExplicitSessionProjectId(env, {
        projectExplicit,
        projectRef: input.projectRef,
        body: input.body ?? null,
        workspaceId,
      });

      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO agentsam_chat_sessions (
           conversation_id, tenant_id, user_id, workspace_id, title,
           project_id, message_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())`,
      )
        .bind(
          conversationId,
          tenantId,
          userId,
          workspaceId,
          title,
          projectExplicit ? resolvedProjectId : null,
        )
        .run();

      const inserted = Number(ins?.meta?.changes ?? ins?.changes ?? 0) > 0;

      if (inserted && workspaceId) {
        scheduleChatSessionR2Init(env, ctx, {
          conversationId,
          userId,
          workspaceId,
          tenantId,
          title,
        });
      }

      if (inserted) return;

      await env.DB.prepare(
        `UPDATE agentsam_chat_sessions
         SET updated_at = unixepoch(),
             message_count = COALESCE(message_count, 0) + 1,
             title = CASE
               WHEN title IS NULL OR TRIM(title) = ''
                 OR LOWER(TRIM(title)) IN ('chat', 'new chat', 'agent chat')
               THEN ?
               ELSE title
             END,
             project_id = CASE
               WHEN ? = 1 THEN ?
               ELSE project_id
             END
         WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?`,
      )
        .bind(
          title,
          projectExplicit ? 1 : 0,
          resolvedProjectId,
          conversationId,
          userId,
          tenantId,
        )
        .run();
    } catch (e) {
      console.warn('[agentsam_chat_sessions] title insert', e?.message ?? e);
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(work);
  else void work;
}

/**
 * Map a chat_sessions SELECT row to the API/nav shape.
 * @param {any} r
 */
function mapChatSessionListRow(r) {
  const startedAt = toEpochSeconds(r.started_at);
  const updatedAt = toEpochSeconds(r.updated_at);
  return {
    ...r,
    message_count: Number(r.message_count) || 1,
    is_starred: Number(r.is_starred) === 1,
    has_artifacts: Number(r.artifact_count) > 0,
    artifact_count: Number(r.artifact_count) || 0,
    session_type: 'chat',
    status: 'active',
    started_at: startedAt,
    updated_at: updatedAt,
  };
}

/**
 * Single-thread fetch for header title hydrate (independent of the top-N list).
 * @param {any} env
 * @param {{ userId: string, tenantId: string, conversationId: string }} input
 */
export async function getUserChatSession(env, input) {
  if (!env?.DB) return null;
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  const conversationId = String(input.conversationId || '').trim();
  if (!userId || !tenantId || !conversationId) return null;
  try {
    const r = await withD1Retry(() =>
      env.DB.prepare(
        `SELECT cs.conversation_id AS id,
                cs.conversation_id,
                cs.title,
                cs.title AS name,
                cs.last_model_key,
                cs.last_model_key AS model_key,
                cs.workspace_id,
                cs.is_starred,
                cs.project_id,
                cs.message_count,
                cs.total_tokens_out,
                cs.last_turn_status,
                cs.last_turn_error,
                cs.created_at AS started_at,
                cs.updated_at,
                p.name AS project_name,
                COALESCE(cs.artifact_count, 0) AS artifact_count
         FROM agentsam_chat_sessions cs
         LEFT JOIN projects p ON p.id = cs.project_id
         WHERE cs.conversation_id = ? AND cs.user_id = ? AND cs.tenant_id = ?
         LIMIT 1`,
      )
        .bind(conversationId, userId, tenantId)
        .first(),
    );
    return r ? mapChatSessionListRow(r) : null;
  } catch (e) {
    console.warn('[getUserChatSession]', e?.message ?? e);
    return null;
  }
}

/**
 * List real chat threads for nav/history (agentsam_chat_sessions SSOT — not raw agent_run rows).
 * @param {any} env
 * @param {{ userId: string, tenantId: string, limit?: number, includeArchived?: boolean, projectId?: string|null, workspaceId?: string|null, pinConversationId?: string|null }} input
 */
export async function listUserChatSessions(env, input) {
  if (!env?.DB) return [];
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  if (!userId || !tenantId) return [];
  const lim = Math.min(Math.max(Number(input.limit) || 40, 1), 200);
  const pinConversationId =
    input.pinConversationId != null ? String(input.pinConversationId).trim() : '';
  const archivedClause = input.includeArchived ? '' : 'AND cs.is_archived = 0';

  let projectClause = '';
  /** @type {string[]} */
  const projectBinds = [];
  const projectRef = input.projectId != null ? String(input.projectId).trim() : '';
  if (projectRef) {
    const { projectsId } = await expandChatProjectRefs(env, projectRef, input.workspaceId || null);
    const id = projectsId || null;
    if (id) {
      projectClause = 'AND cs.project_id = ?';
      projectBinds.push(id);
    }
  }

  try {
    const res = await withD1Retry(() =>
      env.DB.prepare(
        `SELECT cs.conversation_id AS id,
              cs.conversation_id,
              cs.title,
              cs.title AS name,
              cs.last_model_key,
              cs.last_model_key AS model_key,
              cs.workspace_id,
              cs.is_starred,
              cs.project_id,
              cs.message_count,
              cs.total_tokens_out,
              cs.last_turn_status,
              cs.last_turn_error,
              cs.created_at AS started_at,
              cs.updated_at,
              p.name AS project_name,
              COALESCE(cs.artifact_count, 0) AS artifact_count
       FROM agentsam_chat_sessions cs
       LEFT JOIN projects p ON p.id = cs.project_id
       WHERE cs.user_id = ? AND cs.tenant_id = ?
         ${archivedClause}
         ${projectClause}
       ORDER BY cs.is_starred DESC, cs.updated_at DESC
       LIMIT ?`,
      )
        .bind(userId, tenantId, ...projectBinds, lim)
        .all(),
    );
    const rows = (res?.results || []).map(mapChatSessionListRow);
    if (!pinConversationId) return rows;
    if (rows.some((r) => String(r.conversation_id || r.id || '') === pinConversationId)) {
      return rows;
    }
    const pinned = await getUserChatSession(env, { userId, tenantId, conversationId: pinConversationId });
    return pinned ? [pinned, ...rows] : rows;
  } catch (e) {
    console.warn('[listUserChatSessions]', e?.message ?? e);
    if (isD1OverloadError(e)) return [];
    try {
      const res = await env.DB.prepare(
        `SELECT cs.conversation_id AS id,
                cs.conversation_id,
                cs.title,
                cs.title AS name,
                cs.last_model_key,
                cs.last_model_key AS model_key,
                cs.workspace_id,
                cs.created_at AS started_at,
                cs.updated_at,
                0 AS is_starred,
                NULL AS project_id,
                1 AS message_count,
                NULL AS project_name,
                0 AS artifact_count
         FROM agentsam_chat_sessions cs
         WHERE cs.user_id = ? AND cs.tenant_id = ?
         ORDER BY cs.updated_at DESC
         LIMIT ?`,
      )
        .bind(userId, tenantId, lim)
        .all();
      const rows = (res?.results || []).map(mapChatSessionListRow);
      if (!pinConversationId) return rows;
      if (rows.some((r) => String(r.conversation_id || r.id || '') === pinConversationId)) {
        return rows;
      }
      const pinned = await getUserChatSession(env, { userId, tenantId, conversationId: pinConversationId });
      return pinned ? [pinned, ...rows] : rows;
    } catch (e2) {
      console.warn('[listUserChatSessions] fallback', e2?.message ?? e2);
      return [];
    }
  }
}

/**
 * @param {any} env
 * @param {{ conversationId: string, userId: string, tenantId: string, patch: Record<string, unknown> }} input
 */
export async function patchUserChatSession(env, input) {
  if (!env?.DB) return { ok: false, error: 'DB not configured' };
  const conversationId = String(input.conversationId || '').trim();
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  if (!conversationId || !userId || !tenantId) return { ok: false, error: 'missing_context' };

  const sets = [];
  const binds = [];

  if (typeof patch.title === 'string' && patch.title.trim()) {
    sets.push('title = ?');
    binds.push(patch.title.trim().slice(0, 200));
  }
  if (patch.is_starred === true || patch.is_starred === 1 || patch.is_starred === '1') {
    sets.push('is_starred = 1');
  } else if (patch.is_starred === false || patch.is_starred === 0 || patch.is_starred === '0') {
    sets.push('is_starred = 0');
  }
  if (patch.is_archived === true || patch.is_archived === 1 || patch.is_archived === '1') {
    sets.push('is_archived = 1');
  }
  if (patch.is_archived === false || patch.is_archived === 0 || patch.is_archived === '0') {
    sets.push('is_archived = 0');
  }

  const projectPatch = await resolveSessionPatchProjectId(env, patch);
  if (projectPatch?.action === 'null') {
    sets.push('project_id = NULL');
  } else if (projectPatch?.action === 'set') {
    sets.push('project_id = ?');
    binds.push(projectPatch.value);
  }

  if (!sets.length) return { ok: false, error: 'no_changes' };
  sets.push('updated_at = unixepoch()');
  binds.push(conversationId, userId, tenantId);

  try {
    const r = await env.DB.prepare(
      `UPDATE agentsam_chat_sessions SET ${sets.join(', ')}
       WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?`,
    )
      .bind(...binds)
      .run();
    const changed = Number(r.meta?.changes ?? r.changes ?? 0);
    if (!changed) return { ok: false, error: 'not_found' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'patch_failed' };
  }
}

/**
 * Lookup R2 keys for a session (purge coordination). D1 only.
 * @param {any} env
 * @param {{ conversationId: string, userId: string, tenantId: string }} input
 */
export async function getChatSessionArchiveKeys(env, input) {
  if (!env?.DB) return { ok: false, error: 'DB not configured' };
  const conversationId = String(input.conversationId || '').trim();
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  if (!conversationId || !userId || !tenantId) return { ok: false, error: 'missing_context' };
  try {
    const row = await env.DB.prepare(
      `SELECT r2_messages_key, r2_meta_key, latest_digest_r2_key
       FROM agentsam_chat_sessions
       WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?
       LIMIT 1`,
    )
      .bind(conversationId, userId, tenantId)
      .first();
    if (!row) return { ok: false, error: 'not_found' };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: e?.message || 'lookup_failed' };
  }
}

/**
 * D1-only hard delete of agentsam_chat_sessions row.
 * Callers that need R2/DO/run cleanup must use purge.deleteUserChatSession.
 *
 * @param {any} env
 * @param {{ conversationId: string, userId: string, tenantId: string }} input
 */
export async function deleteChatSessionRow(env, input) {
  if (!env?.DB) return { ok: false, error: 'DB not configured' };
  const conversationId = String(input.conversationId || '').trim();
  const userId = String(input.userId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  if (!conversationId || !userId || !tenantId) return { ok: false, error: 'missing_context' };
  try {
    const r = await env.DB.prepare(
      `DELETE FROM agentsam_chat_sessions
       WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?`,
    )
      .bind(conversationId, userId, tenantId)
      .run();
    const changed = Number(r.meta?.changes ?? r.changes ?? 0);
    if (!changed) return { ok: false, error: 'not_found' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'delete_failed' };
  }
}
