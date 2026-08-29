/**
 * Keep agentsam_chat_sessions.artifact_count in sync with artifact inserts
 * so session lists do not correlated-COUNT agentsam_artifacts per row.
 */

export async function bumpChatSessionArtifactCount(env, opts = {}) {
  const db = env?.DB;
  if (!db) return;
  const conversationId =
    opts.conversationId != null && String(opts.conversationId).trim()
      ? String(opts.conversationId).trim()
      : '';
  const runId =
    opts.runId != null && String(opts.runId).trim() ? String(opts.runId).trim() : '';
  try {
    if (conversationId) {
      await db
        .prepare(
          `UPDATE agentsam_chat_sessions
           SET artifact_count = COALESCE(artifact_count, 0) + 1
           WHERE conversation_id = ?`,
        )
        .bind(conversationId)
        .run();
      return;
    }
    if (runId) {
      await db
        .prepare(
          `UPDATE agentsam_chat_sessions
           SET artifact_count = COALESCE(artifact_count, 0) + 1
           WHERE conversation_id = (
             SELECT conversation_id FROM agentsam_agent_run WHERE id = ? LIMIT 1
           )`,
        )
        .bind(runId)
        .run();
    }
  } catch (e) {
    console.warn('[chat-session-artifact-count]', e?.message ?? e);
  }
}
