/**
 * Canonical workspace resolution at login — peeled from src/api/oauth.js for backend/identity.
 */
export async function resolveCanonicalWorkspace(env, userId) {
  if (!env?.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(`
      SELECT COALESCE(
        (SELECT w.id FROM workspaces w
          INNER JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = au.id
         WHERE w.id = au.default_workspace_id AND COALESCE(wm.is_active, 1) = 1
         LIMIT 1),
        (SELECT w.id FROM workspaces w
          INNER JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = au.id
         WHERE w.id = au.active_workspace_id AND COALESCE(wm.is_active, 1) = 1
         LIMIT 1),
        (SELECT wm.workspace_id FROM workspace_members wm
          INNER JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = au.id AND COALESCE(wm.is_active, 1) = 1
         ORDER BY COALESCE(wm.joined_at, wm.created_at) ASC
         LIMIT 1)
      ) AS workspace_id
      FROM auth_users au
      WHERE au.id = ?
    `)
      .bind(userId)
      .first();
    return row?.workspace_id ?? null;
  } catch (e) {
    console.warn('[resolveCanonicalWorkspace]', e?.message ?? e);
    return null;
  }
}
