export function normalizeCmsThemeVars(vars) {
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!/^--[a-z0-9][a-z0-9-]{0,79}$/i.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    normalized[key] = String(value).slice(0, 500);
  }
  return normalized;
}

export function mergeCmsThemeVars(base, overrides) {
  return { ...(base || {}), ...(overrides || {}) };
}

export function applyCmsThemeOverrides(theme, overrides) {
  const vars = normalizeCmsThemeVars(overrides);
  if (!Object.keys(vars).length) return theme || null;
  return {
    ...(theme || {}),
    css_vars: mergeCmsThemeVars(theme?.css_vars, vars),
    site_overrides: vars,
  };
}

export async function getCmsSiteThemeOverrides(env, { tenantId, workspaceId, projectSlug }) {
  if (!env?.DB || !tenantId || !workspaceId || !projectSlug) return {};
  const row = await env.DB.prepare(
    `SELECT vars_json FROM cms_site_theme_overrides
     WHERE tenant_id = ? AND workspace_id = ? AND project_slug = ? LIMIT 1`,
  ).bind(tenantId, workspaceId, projectSlug).first().catch(() => null);
  if (!row?.vars_json) return {};
  try {
    const parsed = typeof row.vars_json === 'string' ? JSON.parse(row.vars_json) : row.vars_json;
    return normalizeCmsThemeVars(parsed);
  } catch {
    return {};
  }
}

export async function saveCmsSiteThemeOverrides(env, { tenantId, workspaceId, projectSlug, vars, updatedBy }) {
  if (!env?.DB) throw new Error('DB not configured');
  const normalized = normalizeCmsThemeVars(vars);
  if (!Object.keys(normalized).length) return { ok: false, error: 'no valid CSS variables', vars: {} };
  await env.DB.prepare(
    `INSERT INTO cms_site_theme_overrides
       (tenant_id, workspace_id, project_slug, vars_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(tenant_id, workspace_id, project_slug) DO UPDATE SET
       vars_json = excluded.vars_json,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(tenantId, workspaceId, projectSlug, JSON.stringify(normalized), updatedBy || null).run();
  return { ok: true, vars: normalized };
}
