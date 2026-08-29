/**
 * agentsam_user_policy row for dashboard bootstrap (ChatAssistant policy props).
 */

/**
 * @param {any} env
 * @param {string | null | undefined} sessionUserId
 * @param {string | null | undefined} email
 */
async function resolveAgentsamUserCandidates(env, sessionUserId, email) {
  if (!env?.DB) {
    const sid = sessionUserId != null ? String(sessionUserId).trim() : '';
    return { authId: sid || null, userId: null };
  }
  const sid = sessionUserId != null ? String(sessionUserId).trim() : '';
  const em = email != null ? String(email).trim() : '';
  try {
    const row = await env.DB.prepare(
      `SELECT au.id as auth_id, u.id as user_id
         FROM auth_users au
         LEFT JOIN users u ON u.auth_id = au.id OR LOWER(COALESCE(u.email,'')) = LOWER(au.email)
        WHERE au.id = ? OR LOWER(au.email) = LOWER(?)
        LIMIT 1`,
    )
      .bind(sid, em || sid)
      .first();
    return { authId: row?.auth_id || sid || null, userId: row?.user_id || null };
  } catch {
    return { authId: sid || null, userId: null };
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown> | null | undefined} authUser
 * @param {string | null | undefined} workspaceId
 */
export async function fetchDashboardBootstrapAgentPolicy(env, authUser, workspaceId) {
  if (!env?.DB) return null;
  const sessionUserId = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!sessionUserId) return null;
  const ws = workspaceId != null ? String(workspaceId).trim() : '';

  try {
    const { authId, userId: canonicalUserId } = await resolveAgentsamUserCandidates(
      env,
      sessionUserId,
      authUser?.email,
    );
    const candidates = Array.from(
      new Set([authId, canonicalUserId, sessionUserId].filter(Boolean).map((x) => String(x))),
    );
    if (candidates.length === 0) return null;

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
         WHERE workspace_id = ?
           AND user_id IN (${candidates.map(() => '?').join(', ')})
         LIMIT 1`,
    )
      .bind(ws || null, ...candidates)
      .first()
      .catch(() => null);

    const agentsamUserId = stored?.user_id ? String(stored.user_id) : sessionUserId;
    const policyRow = await env.DB.prepare(
      `SELECT * FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(agentsamUserId, ws || null)
      .first()
      .catch(() => null);

    return policyRow || null;
  } catch {
    return null;
  }
}
