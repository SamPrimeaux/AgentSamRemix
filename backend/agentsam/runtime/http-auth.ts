import type { Env } from '../../src/env';

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/**
 * Return the root AgentSam instance name from the canonical Agents SDK path.
 * The instance name is the existing agentsam_chat_sessions.conversation_id.
 */
export function agentSamConversationIdFromPath(pathname: string): string | null {
  const parts = String(pathname || '')
    .split('/')
    .filter(Boolean);
  if (parts[0] !== 'agents' || parts[1] !== 'agent-sam' || !parts[2]) return null;
  try {
    const id = decodeURIComponent(parts[2]).trim();
    return id && id !== 'sub' && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

/**
 * External AgentSam routing authority.
 *
 * Authentication happens in the Worker before this function. D1 conversation
 * ownership decides whether that authenticated user may address the Durable
 * Agent instance. Workspace is deliberately absent from this authorization.
 */
export async function userOwnsAgentSamConversation(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const uid = trim(userId);
  const cid = trim(conversationId);
  if (!uid || !cid || !env.DB) return false;
  const row = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM agentsam_chat_sessions
    WHERE conversation_id = ? AND user_id = ?
    LIMIT 1
  `).bind(cid, uid).first<{ ok: number }>();
  return Number(row?.ok) === 1;
}
