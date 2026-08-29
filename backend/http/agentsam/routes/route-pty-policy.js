export async function routeUserCanRunPtyFromPolicy(env, userId, workspaceId) {
  if (!env?.DB || !userId || !workspaceId) return false;
  const row = await env.DB.prepare(
    'SELECT can_run_pty FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1',
  ).bind(String(userId), String(workspaceId)).first().catch(() => null);
  return Number(row?.can_run_pty) === 1;
}
