/**
 * User policy + feature-flag settings APIs.
 * - GET   /api/settings/user-policy
 * - PATCH /api/settings/user-policy
 * - GET   /api/settings/feature-flags
 * Deconstructed from src/api/settings.js (Lane D peel D2, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId, invalidateFeatureFlagsCache, loadFeatureFlagsFromD1 } from '../../identity/index.js';

async function resolveRequestWorkspaceId(env, authUser, url) {
  const fromQuery = url.searchParams.get('workspace_id');
  if (fromQuery != null && String(fromQuery).trim() !== '') return String(fromQuery).trim();
  if (!env?.DB) return '';
  const uid = String(authUser?.id || '').trim();
  try {
    const row = await env.DB.prepare(
      `SELECT default_workspace_id FROM user_settings WHERE user_id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.default_workspace_id != null && String(row.default_workspace_id).trim() !== '') {
      return String(row.default_workspace_id).trim();
    }
  } catch (_) {
    /* legacy schema */
  }
  try {
    const row = await env.DB.prepare(
      `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.active_workspace_id != null && String(row.active_workspace_id).trim() !== '') {
      return String(row.active_workspace_id).trim();
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

export async function handleSettingsPolicyRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method } = authContext || {};
  if (!authUser) return null;

  const isPolicyPath =
    pathLower === '/api/settings/user-policy' ||
    pathLower === '/api/settings/feature-flags';
  if (!isPolicyPath) return null;

  const USER_POLICY_FLAT_PATCH_KEYS = [
    'sync_layouts',
    'show_status_bar',
    'autohide_editor',
    'autoinject_code',
    'web_search_enabled',
    'web_fetch_enabled',
    'text_size',
    'default_agent_location',
    'auto_clear_chat',
    'submit_with_mod_enter',
  ];

  // ── /api/settings/user-policy ────────────────────────────────────────────
  if (pathLower === '/api/settings/user-policy' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const uid = String(authUser.id || '').trim();
    let wsId =
      url.searchParams.get('workspace_id') != null && String(url.searchParams.get('workspace_id')).trim() !== ''
        ? String(url.searchParams.get('workspace_id')).trim()
        : '';
    if (!wsId && authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim() !== '') {
      wsId = String(authUser.active_workspace_id).trim();
    }
    if (!wsId) wsId = await resolveRequestWorkspaceId(env, authUser, url);
    if (!wsId) wsId = '';
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : '';
    if (!tenantId) tenantId = (await fetchAuthUserTenantId(env, uid)) || '';
    if (!tenantId) tenantId = await fallbackSystemTenantId(env);
    try {
      let row = await env.DB.prepare(
        `SELECT * FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
      )
        .bind(uid, wsId)
        .first();
      if (!row) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO agentsam_user_policy (user_id, workspace_id, tenant_id)
           VALUES (?, ?, ?)`,
        )
          .bind(uid, wsId, tenantId)
          .run();
        row = await env.DB.prepare(
          `SELECT * FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
        )
          .bind(uid, wsId)
          .first();
      }
      return jsonResponse({ policy: row ?? {} });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/user-policy' && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const uid = String(authUser.id || '').trim();
    let wsId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : '';
    if (!wsId && authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim() !== '') {
      wsId = String(authUser.active_workspace_id).trim();
    }
    if (!wsId) wsId = await resolveRequestWorkspaceId(env, authUser, url);
    if (!wsId) wsId = '';
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : '';
    if (!tenantId) tenantId = (await fetchAuthUserTenantId(env, uid)) || '';
    if (!tenantId) tenantId = await fallbackSystemTenantId(env);
    const cols = USER_POLICY_FLAT_PATCH_KEYS.filter((k) =>
      Object.prototype.hasOwnProperty.call(body, k),
    );
    if (!cols.length) return jsonResponse({ error: 'No valid fields' }, 400);
    const insertCols = ['user_id', 'workspace_id', 'tenant_id', ...cols].join(', ');
    const placeholders = ['?', '?', '?', ...cols.map(() => '?')].join(', ');
    const updateSet = cols.map((k) => `${k} = excluded.${k}`).join(', ');
    const values = [uid, wsId, tenantId, ...cols.map((k) => body[k])];
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_user_policy (${insertCols})
         VALUES (${placeholders})
         ON CONFLICT(user_id, workspace_id) DO UPDATE SET
           ${updateSet},
           updated_at = datetime('now')`,
      )
        .bind(...values)
        .run();
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/feature-flags' && method === 'GET') {
    if (!env.DB) return jsonResponse({ flags: [], overrides: [] });
    const uid = String(authUser.id || '').trim();
    try {
      const [flagsRes, overridesRes] = await Promise.all([
        env.DB.prepare(
          `SELECT flag_key, description, enabled_globally, environment, rollout_pct, is_archived, updated_at
           FROM agentsam_feature_flag
           WHERE COALESCE(is_archived, 0) = 0
           ORDER BY flag_key ASC`,
        ).all(),
        env.DB.prepare(
          `SELECT flag_key, enabled, updated_at
           FROM agentsam_user_feature_override
           WHERE user_id = ?
           ORDER BY flag_key ASC`,
        )
          .bind(uid)
          .all(),
      ]);
      return jsonResponse({
        flags: flagsRes.results || [],
        overrides: overridesRes.results || [],
      });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  {
    const ffMatch = pathLower.match(/^\/api\/settings\/feature-flags\/([^/]+)$/);
    if (ffMatch && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const flagKey = decodeURIComponent(ffMatch[1] || '').trim();
      if (!flagKey) return jsonResponse({ error: 'flag_key required' }, 400);
      const uid = String(authUser.id || '').trim();
      const body = await request.json().catch(() => ({}));
      if (!Object.prototype.hasOwnProperty.call(body, 'enabled')) {
        return jsonResponse({ error: 'enabled required (boolean)' }, 400);
      }
      const enabled =
        body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0;
      try {
        const flagRow = await env.DB.prepare(
          `SELECT flag_key FROM agentsam_feature_flag WHERE flag_key = ? LIMIT 1`,
        )
          .bind(flagKey)
          .first();
        if (!flagRow) return jsonResponse({ error: 'unknown flag_key' }, 404);
        const personUuid =
          authUser.person_uuid != null && String(authUser.person_uuid).trim() !== ''
            ? String(authUser.person_uuid).trim()
            : null;
        await env.DB.prepare(
          `INSERT INTO agentsam_user_feature_override (user_id, flag_key, enabled, person_uuid, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, flag_key) DO UPDATE SET
             enabled = excluded.enabled,
             person_uuid = COALESCE(excluded.person_uuid, agentsam_user_feature_override.person_uuid),
             updated_at = datetime('now')`,
        )
          .bind(uid, flagKey, enabled, personUuid)
          .run();
        await invalidateFeatureFlagsCache(env, uid);
        const tenantId =
          authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : (await fetchAuthUserTenantId(env, uid)) || null;
        const feature_flags = await loadFeatureFlagsFromD1(env, uid, tenantId);
        return jsonResponse({
          ok: true,
          flag_key: flagKey,
          enabled: enabled === 1,
          feature_flags,
        });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  return null;
}
