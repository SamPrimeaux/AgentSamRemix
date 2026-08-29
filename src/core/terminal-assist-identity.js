/**
 * Resolve workspace/user/tenant for POST /api/terminal/assist.
 * Prefer the D1 terminal_sessions row; fall back to iam-pty body fields
 * when the PTY process was not bound to the Worker-minted session id.
 */

/**
 * @param {{ workspace_id?: unknown, tenant_id?: unknown, user_id?: unknown } | null | undefined} sess
 * @param {{ session_id?: unknown, workspace_id?: unknown, tenant_id?: unknown, user_id?: unknown } | null | undefined} body
 */
export function resolveTerminalAssistIdentity(sess, body) {
  const pick = (row, key) => {
    const v = row?.[key];
    return v != null && String(v).trim() !== '' ? String(v).trim() : '';
  };
  const sessionId = pick(body, 'session_id');
  let workspaceId = pick(sess, 'workspace_id') || pick(body, 'workspace_id');
  let tenantId = pick(sess, 'tenant_id') || pick(body, 'tenant_id');
  let userId = pick(sess, 'user_id') || pick(body, 'user_id');
  return { sessionId, workspaceId, tenantId, userId };
}
