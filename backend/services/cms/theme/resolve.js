/**
 * Resolve live `cms_themes` row from D1 using workspace/project/user/tenant fallbacks.
 */
import { fetchAuthUserTenantId } from '../../../identity/users/tenant.js';

/**
 * Tenant for cms_theme_preferences + resolveActiveCmsThemeRow: auth/session tenant first,
 * then workspace row (owner/default) when scoping to a workspace.
 * @param {any} env
 * @param {any} authUser
 * @param {string | null | undefined} workspaceId
 */
export async function resolveTenantIdForCmsThemeOps(env, authUser, workspaceId) {
  let tid = null;
  if (authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== "") {
    tid = String(authUser.tenant_id).trim();
  }
  if (!tid && authUser?.id) {
    tid = await fetchAuthUserTenantId(env, authUser.id).catch(() => null);
  }
  if (!tid && authUser?.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email).catch(() => null);
  }
  const ws = workspaceId != null ? String(workspaceId).trim() : "";
  if (!tid && ws && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT tenant_id, owner_tenant_id, default_tenant_id FROM workspaces WHERE id = ? LIMIT 1`,
      )
        .bind(ws)
        .first();
      for (const col of [row?.tenant_id, row?.owner_tenant_id, row?.default_tenant_id]) {
        if (col != null && String(col).trim() !== "") {
          tid = String(col).trim();
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return tid || null;
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} ref
 */
async function fetchCmsThemeRowByRef(db, ref) {
  const s = String(ref ?? "").trim();
  if (!s) return null;
  let row = await db
    .prepare(
      `SELECT * FROM cms_themes
       WHERE slug = ?
         AND COALESCE(status, 'active') != 'archived'
       ORDER BY sort_order ASC, is_system DESC, updated_at DESC, id ASC
       LIMIT 1`,
    )
    .bind(s)
    .first();
  if (row) return row;
  row = await db.prepare(`SELECT * FROM cms_themes WHERE id = ? LIMIT 1`).bind(s).first();
  return row || null;
}

async function fetchPrefsProject(db, tenantId, workspaceId, projectId) {
  try {
    return await db
      .prepare(
        `SELECT theme_slug FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'project' AND workspace_id = ? AND project_id = ? LIMIT 1`,
      )
      .bind(tenantId, workspaceId, projectId)
      .first();
  } catch {
    return null;
  }
}

async function fetchPrefsWorkspace(db, tenantId, workspaceId) {
  try {
    return await db
      .prepare(
        `SELECT theme_slug FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'workspace' AND workspace_id = ? LIMIT 1`,
      )
      .bind(tenantId, workspaceId)
      .first();
  } catch {
    return null;
  }
}

async function fetchPrefsUserGlobal(db, tenantId, userId) {
  try {
    return await db
      .prepare(
        `SELECT theme_slug FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'user_global' AND user_id = ? LIMIT 1`,
      )
      .bind(tenantId, userId)
      .first();
  } catch {
    return null;
  }
}

async function fetchWorkspaceSettingsThemeRef(db, workspaceId) {
  try {
    const row = await db
      .prepare(`SELECT theme_id, theme FROM workspace_settings WHERE workspace_id = ? LIMIT 1`)
      .bind(workspaceId)
      .first();
    if (!row) return null;
    const a = row.theme != null && String(row.theme).trim() !== "" ? String(row.theme).trim() : null;
    const b =
      row.theme_id != null && String(row.theme_id).trim() !== "" ? String(row.theme_id).trim() : null;
    return a || b;
  } catch {
    try {
      const row = await db
        .prepare(`SELECT theme_id FROM workspace_settings WHERE workspace_id = ? LIMIT 1`)
        .bind(workspaceId)
        .first();
      return row?.theme_id != null ? String(row.theme_id).trim() : null;
    } catch {
      return null;
    }
  }
}

async function fetchWorkspacesThemeRef(db, workspaceId) {
  try {
    const row = await db
      .prepare(`SELECT theme_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(workspaceId)
      .first();
    return row?.theme_id != null && String(row.theme_id).trim() !== ""
      ? String(row.theme_id).trim()
      : null;
  } catch {
    return null;
  }
}

async function fetchUserSettingsThemeRef(db, userId) {
  try {
    const row = await db
      .prepare(`SELECT theme FROM user_settings WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first();
    return row?.theme != null && String(row.theme).trim() !== "" ? String(row.theme).trim() : null;
  } catch {
    return null;
  }
}

async function fetchTenantAppearanceSlug(db, tenantId) {
  try {
    const row = await db
      .prepare(
        `SELECT t.slug FROM cms_themes t
         INNER JOIN settings s ON (s.setting_value = t.slug OR s.setting_value = CAST(t.id AS TEXT))
         WHERE s.tenant_id = ? AND s.setting_key = 'appearance.theme' LIMIT 1`,
      )
      .bind(tenantId)
      .first();
    return row?.slug != null ? String(row.slug).trim() : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ row: Record<string, unknown> | null, resolved_from: string }} ResolvedCmsTheme
 */

/**
 * @param {any} env
 * @param {{
 *   tenantId: string | null,
 *   authUser: { id?: string } | null,
 *   workspaceId: string | null,
 *   projectId: string | null,
 * }} args
 * @returns {Promise<ResolvedCmsTheme>}
 */
/**
 * Resolve the authenticated dashboard user's appearance.
 * Dashboard chrome is deliberately user-global: workspace/project theme
 * preferences remain available to CMS/site rendering, but never participate
 * in the logged-in dashboard color scheme.
 *
 * Resolution order: user_global -> legacy user_settings.theme -> tenant -> system.
 * @param {any} env
 * @param {{ tenantId: string | null, authUser: { id?: string } | null }} args
 */
export async function resolveDashboardUserThemeRow(env, { tenantId, authUser }) {
  const db = env?.DB;
  if (!db) return { row: null, resolved_from: "no_db" };

  const tid = tenantId != null ? String(tenantId).trim() : "";
  const uid = authUser?.id != null ? String(authUser.id).trim() : "";

  const trySlug = async (ref, source) => {
    if (ref == null || String(ref).trim() === "") return null;
    const row = await fetchCmsThemeRowByRef(db, ref);
    return row ? { row, resolved_from: source } : null;
  };

  if (tid && uid) {
    const pref = await fetchPrefsUserGlobal(db, tid, uid);
    if (pref?.theme_slug) {
      const hit = await trySlug(pref.theme_slug, "cms_theme_preferences.user_global");
      if (hit) return hit;
    }
  }

  if (uid) {
    const legacyRef = await fetchUserSettingsThemeRef(db, uid);
    const hit = await trySlug(legacyRef, "user_settings.theme");
    if (hit) return hit;
  }

  if (tid) {
    const tenantRef = await fetchTenantAppearanceSlug(db, tid);
    const hit = await trySlug(tenantRef, "settings.appearance.theme");
    if (hit) return hit;
  }

  let fallback = await db
    .prepare(`SELECT * FROM cms_themes WHERE is_system = 1 AND slug = 'dark' LIMIT 1`)
    .first();
  if (!fallback) {
    fallback = await db
      .prepare(`SELECT * FROM cms_themes WHERE is_system = 1 ORDER BY sort_order ASC LIMIT 1`)
      .first();
  }
  if (fallback) return { row: fallback, resolved_from: "system_default" };
  return { row: null, resolved_from: "none" };
}

export async function resolveActiveCmsThemeRow(env, { tenantId, authUser, workspaceId, projectId }) {
  const db = env?.DB;
  if (!db) return { row: null, resolved_from: "no_db" };

  const tid = tenantId != null ? String(tenantId).trim() : "";
  const wsId = workspaceId != null ? String(workspaceId).trim() : "";
  const projId = projectId != null ? String(projectId).trim() : "";
  const uid = authUser?.id != null ? String(authUser.id).trim() : "";

  const trySlug = async (ref, source) => {
    if (ref == null || String(ref).trim() === "") return null;
    const row = await fetchCmsThemeRowByRef(db, ref);
    return row ? { row, resolved_from: source } : null;
  };

  if (tid && wsId && projId) {
    const p = await fetchPrefsProject(db, tid, wsId, projId);
    if (p?.theme_slug) {
      const hit = await trySlug(p.theme_slug, "cms_theme_preferences.project");
      if (hit) return hit;
    }
  }

  if (tid && wsId) {
    const p = await fetchPrefsWorkspace(db, tid, wsId);
    if (p?.theme_slug) {
      const hit = await trySlug(p.theme_slug, "cms_theme_preferences.workspace");
      if (hit) return hit;
    }
  }

  if (wsId) {
    const ref = await fetchWorkspaceSettingsThemeRef(db, wsId);
    const hit = await trySlug(ref, "workspace_settings");
    if (hit) return hit;
  }

  if (wsId) {
    const ref = await fetchWorkspacesThemeRef(db, wsId);
    const hit = await trySlug(ref, "workspaces");
    if (hit) return hit;
  }

  if (tid && uid) {
    const p = await fetchPrefsUserGlobal(db, tid, uid);
    if (p?.theme_slug) {
      const hit = await trySlug(p.theme_slug, "cms_theme_preferences.user_global");
      if (hit) return hit;
    }
  }

  if (uid) {
    const ref = await fetchUserSettingsThemeRef(db, uid);
    const hit = await trySlug(ref, "user_settings.theme");
    if (hit) return hit;
  }

  if (tid) {
    const ref = await fetchTenantAppearanceSlug(db, tid);
    const hit = await trySlug(ref, "settings.appearance.theme");
    if (hit) return hit;
  }

  let fallback = await db
    .prepare(`SELECT * FROM cms_themes WHERE is_system = 1 AND slug = 'dark' LIMIT 1`)
    .first();
  if (!fallback) {
    fallback = await db
      .prepare(`SELECT * FROM cms_themes WHERE is_system = 1 ORDER BY sort_order ASC LIMIT 1`)
      .first();
  }
  if (fallback) return { row: fallback, resolved_from: "system_default" };

  return { row: null, resolved_from: "none" };
}
