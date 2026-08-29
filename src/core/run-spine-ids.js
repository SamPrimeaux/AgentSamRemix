/**
 * Normalize agent_run_id + conversation_id for D1 run-spine tables (migration 164).
 * Accepts camelCase or snake_case; conversation falls back to session_id when unset.
 *
 * @param {Record<string, unknown>|null|undefined} fields
 * @returns {{ agent_run_id: string|null, conversation_id: string|null }}
 */
export function pickRunSpineIds(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const pickStr = (...keys) => {
    for (const k of keys) {
      if (f[k] == null) continue;
      const s = String(f[k]).trim();
      if (s) return s;
    }
    return null;
  };
  return {
    agent_run_id: pickStr('agent_run_id', 'agentRunId', 'runId', 'run_id'),
    conversation_id: pickStr('conversation_id', 'conversationId', 'session_id', 'sessionId'),
  };
}
