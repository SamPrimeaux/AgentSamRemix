/**
 * Cloudflare host adapters for the portable CMS theme domain.
 * Binding names and runtime-specific behavior stay outside src/core/agentsam/cms/theme/.
 */

function parseWorkspaceSettingsJson(settingsJson) {
  if (settingsJson == null || settingsJson === '') return {};
  try {
    return typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
  } catch {
    return {};
  }
}

export async function canUsePlatformAssetsR2Upload(env, workspaceId, tenantId) {
  if (!env?.ASSETS || typeof env.ASSETS.put !== 'function') return false;
  const wid = String(workspaceId || '').trim();
  const tid = String(tenantId || '').trim();
  const envWs = String(env.CMS_THEME_PLATFORM_WORKSPACE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (wid && envWs.includes(wid)) return true;
  const envTn = String(env.CMS_THEME_PLATFORM_TENANT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tid && envTn.includes(tid)) return true;
  if (!wid || !env.DB) return false;
  try {
    const row = await env.DB.prepare(`SELECT settings_json FROM workspaces WHERE id = ? LIMIT 1`).bind(wid).first();
    const parsed = parseWorkspaceSettingsJson(row?.settings_json);
    const pipeline = parsed.cms_pipeline && typeof parsed.cms_pipeline === 'object' ? parsed.cms_pipeline : {};
    return pipeline.platform_r2_upload === true || String(pipeline.storage_output || '').trim() === 'platform_r2';
  } catch {
    return false;
  }
}

function cssVarsFromThemeJson(themeJson) {
  if (!themeJson || typeof themeJson !== 'object' || Array.isArray(themeJson)) return {};
  const source = themeJson.cssVars ?? themeJson.css_vars ?? themeJson.vars;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return Object.fromEntries(Object.entries(source).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  }
  const rawConfig = themeJson.config;
  if (typeof rawConfig === 'string' && rawConfig.trim()) {
    try {
      const config = JSON.parse(rawConfig);
      const vars = config?.cssVars ?? config?.css_vars;
      if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
        return Object.fromEntries(Object.entries(vars).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      }
    } catch {}
  }
  return {};
}

export async function hydrateCmsThemeCssVarsFromR2(env, row, opts = {}) {
  if (!row || typeof row !== 'object') return;
  let existing = {};
  try {
    existing = typeof row.css_vars_json === 'string'
      ? JSON.parse(row.css_vars_json || '{}')
      : row.css_vars_json && typeof row.css_vars_json === 'object' && !Array.isArray(row.css_vars_json)
        ? { ...row.css_vars_json }
        : {};
  } catch {}
  if (Object.keys(existing).length) return;

  const keyRaw = row.css_r2_key != null ? String(row.css_r2_key).trim() : '';
  const slug = row.slug != null ? String(row.slug).trim() : '';
  const cssPath = keyRaw || (slug ? `cms/themes/${slug}/theme.css` : '');
  if (!cssPath) return;
  const jsonKey = cssPath.includes('theme.css') ? cssPath.replace('theme.css', 'theme.json') : cssPath.replace(/\.css$/i, '.json');

  try {
    const stores = [env?.ASSETS, env?.DASHBOARD, env?.R2].filter((store) => typeof store?.get === 'function');
    let object = null;
    for (const store of stores) {
      object = await store.get(jsonKey);
      if (object) break;
    }
    if (!object) return;
    const vars = cssVarsFromThemeJson(await object.json());
    if (!Object.keys(vars).length) return;
    row.css_vars_json = JSON.stringify(vars);
    if (opts.persist !== false && env?.DB && slug) {
      env.DB.prepare(`UPDATE cms_themes SET css_vars_json = ? WHERE slug = ?`).bind(row.css_vars_json, slug).run().catch(() => {});
    }
  } catch {}
}

export async function broadcastWorkspaceThemeCollab(env, workspaceId, payload) {
  if (!env?.IAM_COLLAB || !workspaceId || !payload?.slug || !payload?.data) return;
  const id = env.IAM_COLLAB.idFromName(`canvas:${workspaceId}`);
  const stub = env.IAM_COLLAB.get(id);
  const body = JSON.stringify({
    type: 'theme_update',
    theme_slug: payload.slug,
    cssVars: payload.data,
    monaco_theme: payload.monaco_theme ?? null,
    monaco_bg: payload.monaco_bg ?? null,
    monaco_theme_data: payload.monaco_theme_data ?? null,
    agent_home: payload.agent_home ?? null,
  });
  try {
    await stub.fetch(new Request('https://internal/broadcast', { method: 'POST', body }));
  } catch (error) {
    console.warn('[broadcastWorkspaceThemeCollab]', error?.message ?? error);
  }
}
