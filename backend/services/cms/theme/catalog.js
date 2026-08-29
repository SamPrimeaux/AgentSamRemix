import { normalizeCatalogThemeRow } from './preview-model.js';

export async function listCmsThemeCatalog(env, tenantId = null) {
  if (!env?.DB) return [];
  const tid = tenantId != null ? String(tenantId).trim() : '';
  let results = [];
  if (tid) {
    ({ results = [] } = await env.DB.prepare(
      `SELECT * FROM cms_themes
       WHERE COALESCE(status, 'active') = 'active'
         AND (
           COALESCE(is_system, 0) = 1
           OR tenant_id IS NULL
           OR tenant_id = ?
         )
         AND (
           tenant_id = ?
           OR COALESCE(visibility, 'public') IN ('public', 'internal')
         )
       ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
                is_system DESC, theme_family ASC, sort_order ASC, name ASC`,
    ).bind(tid, tid, tid).all());
  } else {
    ({ results = [] } = await env.DB.prepare(
      `SELECT * FROM cms_themes
       WHERE COALESCE(status, 'active') = 'active'
         AND (COALESCE(is_system, 0) = 1 OR tenant_id IS NULL)
         AND COALESCE(visibility, 'public') IN ('public', 'internal')
       ORDER BY is_system DESC, theme_family ASC, sort_order ASC, name ASC`,
    ).all());
  }
  return results.map((row) => normalizeCatalogThemeRow(row));
}

export async function listCmsThemesForWorkspace(env, workspaceId, limit = 100) {
  if (!env?.DB) return [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const { results = [] } = await env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.theme_family, t.css_r2_key, t.compiled_css_hash,
            t.css_vars_json, t.tokens_json, t.monaco_theme, t.sort_order,
            tp.id AS pref_id
     FROM cms_themes t
     LEFT JOIN cms_theme_preferences tp
       ON tp.theme_id = t.id AND tp.workspace_id = ? AND tp.is_active = 1
     WHERE t.status = 'active' ORDER BY tp.id DESC, t.sort_order LIMIT ?`,
  ).bind(workspaceId, safeLimit).all();
  return results;
}

export async function getCmsThemeForWorkspace(env, workspaceId, themeIdOrSlug) {
  const key = String(themeIdOrSlug || '').trim();
  if (!env?.DB || !key) return null;
  const themes = await listCmsThemesForWorkspace(env, workspaceId, 500);
  return (
    themes.find((theme) => String(theme.id || '').trim() === key) ||
    themes.find((theme) => String(theme.slug || '').trim() === key) ||
    null
  );
}
