/**
 * ACP session domain: sessionId = conversation_id (agentsam_chat_sessions + AgentChat DO).
 * Each session/prompt creates/uses its own agentsam_agent_run — never arun_* as sessionId.
 */

import { ensureChatSessionRow } from '../../agentsam/sessions/index.js';
import { bootstrapAgentSession } from '../../agentsam/sessions/session-context.js';
export { extractAcpPromptText, assertNotAgentRunIdAsSession } from './session-contract.js';

/**
 * @param {any} env
 * @param {{
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   title?: string|null,
 *   modelKey?: string|null,
 *   conversationId?: string|null,
 * }} p
 */
export async function createAcpChatSession(env, p) {
  const conversationId =
    p.conversationId != null && String(p.conversationId).trim()
      ? String(p.conversationId).trim()
      : crypto.randomUUID();

  await ensureChatSessionRow(env, {
    conversationId,
    tenantId: p.tenantId,
    userId: p.userId,
    workspaceId: p.workspaceId,
    title: p.title || 'ACP session',
    modelKey: p.modelKey ?? null,
  });

  try {
    await bootstrapAgentSession(env, conversationId, {
      userId: p.userId,
      tenantId: p.tenantId,
      workspaceId: p.workspaceId,
      source: 'acp',
    });
  } catch {
    /* DO optional at create */
  }

  return { sessionId: conversationId, conversationId };
}
/**
 * @param {any} env
 * @param {{ sessionId: string, userId: string }} p
 */
export async function loadAcpChatSession(env, p) {
  const sessionId = String(p.sessionId || '').trim();
  if (!sessionId) {
    const err = new Error('sessionId required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  if (!env?.DB) {
    const err = new Error('Database not configured');
    /** @type {any} */ (err).code = -32000;
    throw err;
  }
  const row = await env.DB.prepare(
    `SELECT conversation_id, user_id, workspace_id, title
     FROM agentsam_chat_sessions
     WHERE conversation_id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(sessionId, p.userId)
    .first();

  if (!row?.conversation_id) {
    const err = new Error('session not found');
    /** @type {any} */ (err).code = -32001;
    throw err;
  }
  return {
    sessionId: String(row.conversation_id),
    conversationId: String(row.conversation_id),
    title: row.title != null ? String(row.title) : null,
  };
}
