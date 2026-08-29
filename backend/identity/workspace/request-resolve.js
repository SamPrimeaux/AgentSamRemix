/**
 * Request-scoped workspace selection.
 *
 * This is deliberately a leaf: it accepts already-authenticated values and
 * owns only workspace selection plus membership authorization.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function authorizeWorkspace(env, userId, workspaceId) {
  const { authorizeWorkspaceAccess } = await import('./access.js');
  return authorizeWorkspaceAccess(env, userId, workspaceId);
}

async function resolveCanonicalWorkspace(env, userId) {
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
    `).bind(userId).first();
    return row?.workspace_id ?? null;
  } catch (error) {
    console.warn('[resolveCanonicalWorkspace]', error?.message ?? error);
    return null;
  }
}

function explicitWorkspaceId(request, requestedWorkspaceId) {
  const headerWorkspaceId = trim(request?.headers?.get?.('x-iam-workspace-id'));
  if (headerWorkspaceId) return headerWorkspaceId;
  try {
    const queryWorkspaceId = trim(new URL(request?.url || '').searchParams.get('workspace_id'));
    if (queryWorkspaceId) return queryWorkspaceId;
  } catch {}
  return trim(requestedWorkspaceId);
}

/**
 * Resolve and authorize the workspace for an authenticated request.
 *
 * `source: 'none'` is intentional; the caller must turn it into a 403.
 *
 * @param {any} env
 * @param {{ request?: Request|null, userId: string, tenantId?: string|null,
 *   authType?: string|null, requestedWorkspaceId?: string|null,
 *   storedActiveWorkspaceId?: string|null, sessionWorkspaceId?: string|null,
 *   tokenWorkspaceId?: string|null }} options
 * @returns {Promise<{ id: string|null, source: string }>}
 */
export async function resolveRequestWorkspace(env, options = {}) {
  const userId = trim(options.userId);
  const explicitId = explicitWorkspaceId(options.request, options.requestedWorkspaceId);
  if (explicitId) {
    const authorizedId = await authorizeWorkspace(env, userId, explicitId);
    return authorizedId ? { id: authorizedId, source: 'request' } : { id: null, source: 'none' };
  }

  const candidates = [];
  if (options.authType === 'mcp') {
    candidates.push({ id: trim(options.tokenWorkspaceId), source: 'token' });
  }
  candidates.push(
    { id: trim(options.storedActiveWorkspaceId), source: 'active_pin' },
    { id: trim(await resolveCanonicalWorkspace(env, userId)), source: 'canonical' },
    { id: trim(options.sessionWorkspaceId), source: 'session' },
  );

  for (const candidate of candidates) {
    const authorizedId = await authorizeWorkspace(env, userId, candidate.id);
    if (authorizedId) return { id: authorizedId, source: candidate.source };
  }
  return { id: null, source: 'none' };
}

/**
 * Persist the selected workspace after the caller has authorized it.
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null }} input
 */
export async function persistWorkspaceSelection(env, input = {}) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  if (!env?.DB || !userId || !workspaceId) {
    return { ok: false, activeUpdated: false, legacyUpdated: false };
  }
  const authorizedId = await authorizeWorkspace(env, userId, workspaceId);
  if (authorizedId !== workspaceId) {
    return { ok: false, activeUpdated: false, legacyUpdated: false, error: 'workspace_access_denied' };
  }

  let activeUpdated = false;
  let legacyUpdated = false;
  try {
    await env.DB.prepare(
      `UPDATE auth_users
          SET active_workspace_id = ?,
              active_tenant_id = COALESCE(NULLIF(TRIM(active_tenant_id), ''), ?),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(workspaceId, trim(input.tenantId) || null, userId).run();
    activeUpdated = true;
  } catch (error) {
    console.warn('[identity] active workspace preference write failed', error?.message || error);
  }

  try {
    const update = await env.DB.prepare(
      `UPDATE user_settings
          SET default_workspace_id = ?, updated_at = unixepoch()
        WHERE user_id = ?`,
    ).bind(workspaceId, userId).run();
    if (update?.meta?.changes) {
      legacyUpdated = true;
    } else {
      await env.DB.prepare(
        `INSERT INTO user_settings (id, user_id, default_workspace_id, theme, updated_at)
         VALUES (?, ?, ?, 'meaux-storm-gray', unixepoch())`,
      ).bind(`us_${userId}`, userId, workspaceId).run();
      legacyUpdated = true;
    }
  } catch (error) {
    console.warn('[identity] legacy workspace preference mirror failed', error?.message || error);
  }

  return { ok: activeUpdated || legacyUpdated, activeUpdated, legacyUpdated };
}
