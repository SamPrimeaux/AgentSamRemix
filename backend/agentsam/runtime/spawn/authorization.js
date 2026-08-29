// guard-dup-allow: backend spawn peel; shared authorization callers migrate separately.
/**
 * Authorization seam used by child lanes.
 *
 * Child execution inherits the spawning user's auth row and workspace PTY
 * policy. No tenant or operator identity is synthesized here.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export async function resolveGrantAuthUserRow(env, input) {
  const id = trim(typeof input === 'string' ? input : input?.id);
  if (!id) return null;
  const suppliedEmail = trim(input?.email).toLowerCase();
  if (suppliedEmail) return { id, email: suppliedEmail };
  const row = await env?.DB?.prepare(
    `SELECT id, email FROM auth_users WHERE id = ? LIMIT 1`,
  ).bind(id).first().catch(() => null);
  return row?.id ? { id: trim(row.id), email: trim(row.email).toLowerCase() } : { id };
}

export async function userMayUsePrivilegedTerminal(env, authUser, workspaceId) {
  const userId = trim(authUser?.id);
  const workspace = trim(workspaceId);
  if (!userId || !workspace || !env?.DB) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok
       FROM agentsam_user_policy
      WHERE user_id = ? AND workspace_id = ? AND COALESCE(can_run_pty, 0) = 1
      LIMIT 1`,
  ).bind(userId, workspace).first().catch(() => null);
  return Number(row?.ok) === 1;
}
