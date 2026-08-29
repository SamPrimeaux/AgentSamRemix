/**
 * agentsam_workspace_state — per-workspace IDE / resume spine (not chat storage).
 * One row per workspace_id: last conversation_id, state_json, files, locks.
 */

/**
 * Pin the workspace's last active conversation (resume for /api/agent/workspace/:id).
 * @param {any} env
 * @param {any} ctx
 * @param {{ conversationId?: string|null, workspaceId?: string|null }} input
 */
export function scheduleWorkspaceConversationPin(env, ctx, input) {
  const conversationId =
    input.conversationId != null ? String(input.conversationId).trim() : '';
  const workspaceId = input.workspaceId != null ? String(input.workspaceId).trim() : '';
  if (!env?.DB || !conversationId || !workspaceId) return;

  const work = (async () => {
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_workspace_state (
           id, workspace_id, conversation_id, workspace_type, created_at, updated_at
         ) VALUES ('wss_' || lower(hex(randomblob(8))), ?, ?, 'ide', unixepoch(), unixepoch())
         ON CONFLICT(workspace_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           updated_at = unixepoch()`,
      )
        .bind(workspaceId, conversationId)
        .run();
    } catch (e) {
      try {
        await env.DB.prepare(
          `UPDATE agentsam_workspace_state
           SET conversation_id = ?, updated_at = unixepoch()
           WHERE workspace_id = ?`,
        )
          .bind(conversationId, workspaceId)
          .run();
      } catch (e2) {
        console.warn('[agentsam_workspace_state] conversation_id', e2?.message ?? e2);
      }
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(work);
  else void work;
}

/** @deprecated use scheduleWorkspaceConversationPin */
export const scheduleWorkspaceStateConversationUpdate = scheduleWorkspaceConversationPin;
