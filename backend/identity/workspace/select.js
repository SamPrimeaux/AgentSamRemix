/**
 * Interactive workspace selection.
 *
 * Membership authorizes the auth user to select the workspace. The only
 * persisted current-workspace authority written here is auth_users.active_workspace_id.
 * Session and JWT synchronization remains a temporary transport concern in HTTP.
 */
import { authorizeWorkspaceAccess } from './authority.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {any} env
 * @param {{ userId: string, workspaceId: string }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   workspace?: { id: string, name: string, slug: string|null },
 * }>}
 */
export async function selectWorkspace(env, input = {}) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  if (!env?.DB || !userId || !workspaceId) {
    return { ok: false, error: 'workspace_selection_invalid' };
  }

  const authorizedId = await authorizeWorkspaceAccess(env, userId, workspaceId);
  if (authorizedId !== workspaceId) {
    return { ok: false, error: 'workspace_access_denied' };
  }

  try {
    await env.DB.prepare(
      `UPDATE auth_users
          SET active_workspace_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(workspaceId, userId)
      .run();

    const row = await env.DB.prepare(
      `SELECT
         aw.id,
         COALESCE(
           NULLIF(TRIM(aw.display_name), ''),
           NULLIF(TRIM(aw.name), ''),
           NULLIF(TRIM(aw.workspace_slug), ''),
           aw.id
         ) AS name,
         aw.workspace_slug AS slug
       FROM agentsam_workspace aw
       WHERE aw.id = ?
       LIMIT 1`,
    )
      .bind(workspaceId)
      .first();

    if (!row?.id) return { ok: false, error: 'workspace_not_found' };
    return {
      ok: true,
      workspace: {
        id: String(row.id),
        name: String(row.name || row.id),
        slug: trim(row.slug) || null,
      },
    };
  } catch (error) {
    console.warn('[selectWorkspace] selection write failed', error?.message ?? error);
    return { ok: false, error: 'workspace_selection_failed' };
  }
}
