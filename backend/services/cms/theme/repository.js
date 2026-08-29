/** D1 persistence for cms_themes rows. HTTP parsing does not belong here. */

export async function readCmsThemeById(env, themeId) {
  const id = String(themeId || '').trim();
  if (!id || !env?.DB) return null;
  return (await env.DB.prepare(`SELECT * FROM cms_themes WHERE id = ?`).bind(id).first()) || null;
}

export async function readCmsThemeBySlug(env, slug) {
  const value = String(slug || '').trim();
  if (!value || !env?.DB) return null;
  return (
    (await env.DB.prepare(
      `SELECT * FROM cms_themes
       WHERE slug = ?
         AND COALESCE(status, 'active') != 'archived'
       ORDER BY sort_order ASC, is_system DESC, updated_at DESC, id ASC
       LIMIT 1`,
    ).bind(value).first()) || null
  );
}

export async function findCmsThemeSlugConflict(env, slug, excludeId = null) {
  const value = String(slug || '').trim();
  if (!value || !env?.DB) return null;
  const excluded = excludeId != null ? String(excludeId).trim() : '';
  if (excluded) {
    return (
      (await env.DB.prepare(`SELECT id FROM cms_themes WHERE slug = ? AND id != ? LIMIT 1`)
        .bind(value, excluded)
        .first()) || null
    );
  }
  return (await env.DB.prepare(`SELECT id FROM cms_themes WHERE slug = ? LIMIT 1`).bind(value).first()) || null;
}

export async function insertTenantCmsTheme(env, row) {
  if (!env?.DB) throw new Error('DB not configured');
  await env.DB.prepare(
    `INSERT INTO cms_themes (
       id, tenant_id, name, slug, config, theme_family, sort_order,
       monaco_theme, monaco_bg, monaco_theme_data,
       tokens_json, css_vars_json, brand_json, layout_json, typography_json, components_json, motion_json,
       preview_image_url, status, visibility, is_system, workspace_id, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?,
       ?, 'active', 'private', 0, NULL, unixepoch()
     )`,
  ).bind(
    row.id,
    row.tenantId,
    row.name,
    row.slug,
    row.configJson,
    row.themeFamily,
    row.sortOrder,
    row.monacoTheme,
    row.monacoBg,
    row.monacoThemeDataJson,
    row.sidecars.tokens_json,
    row.sidecars.css_vars_json,
    row.sidecars.brand_json,
    row.sidecars.layout_json,
    row.sidecars.typography_json,
    row.sidecars.components_json,
    row.sidecars.motion_json,
    row.previewImageUrl ?? null,
  ).run();
  return readCmsThemeById(env, row.id);
}

export async function updateTenantCmsTheme(env, { rowId, tenantId, desiredSlug, patch }) {
  const id = String(rowId || '').trim();
  const tid = String(tenantId || '').trim();
  if (!id || !tid || !env?.DB) return null;
  await env.DB.prepare(
    `UPDATE cms_themes SET
       name = ?, slug = ?, config = ?, theme_family = ?, sort_order = ?,
       monaco_theme = ?, monaco_bg = ?, monaco_theme_data = ?,
       tokens_json = ?, css_vars_json = ?, brand_json = ?, layout_json = ?,
       typography_json = ?, components_json = ?, motion_json = ?,
       preview_image_url = CASE WHEN ? = 1 THEN ? ELSE preview_image_url END,
       updated_at = unixepoch()
     WHERE id = ? AND tenant_id = ? AND COALESCE(is_system, 0) = 0`,
  ).bind(
    patch.name,
    desiredSlug,
    patch.configJson,
    patch.themeFamily,
    patch.sortOrder,
    patch.monacoTheme,
    patch.monacoBg,
    patch.monacoThemeDataJson,
    patch.sidecars.tokens_json,
    patch.sidecars.css_vars_json,
    patch.sidecars.brand_json,
    patch.sidecars.layout_json,
    patch.sidecars.typography_json,
    patch.sidecars.components_json,
    patch.sidecars.motion_json,
    patch.previewImageUrlExplicit ? 1 : 0,
    patch.previewImageUrl,
    id,
    tid,
  ).run();
  return readCmsThemeById(env, id);
}

export async function archiveTenantCmsTheme(env, { themeId, tenantId }) {
  const id = String(themeId || '').trim();
  const tid = String(tenantId || '').trim();
  if (!id || !tid || !env?.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE cms_themes
     SET status = 'archived', visibility = 'private', updated_at = unixepoch()
     WHERE id = ? AND tenant_id = ? AND COALESCE(is_system, 0) = 0`,
  ).bind(id, tid).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function readCmsThemeTokensJson(env, themeId) {
  const id = String(themeId || '').trim();
  if (!id || !env?.DB) return null;
  const row = await env.DB.prepare(`SELECT tokens_json FROM cms_themes WHERE id = ? LIMIT 1`).bind(id).first();
  return row?.tokens_json ?? null;
}

export async function writeCmsThemePackageMeta(env, themeId, tokensJson) {
  const id = String(themeId || '').trim();
  if (!id || !env?.DB) return;
  await env.DB.prepare(`UPDATE cms_themes SET tokens_json = ?, updated_at = unixepoch() WHERE id = ?`)
    .bind(tokensJson, id)
    .run();
}

export async function updateCmsThemeR2Meta(env, themeId, meta) {
  const id = String(themeId || '').trim();
  if (!id || !env?.DB) return;
  const hasPreview = Object.prototype.hasOwnProperty.call(meta, 'preview_image_url');
  if (hasPreview) {
    await env.DB.prepare(
      `UPDATE cms_themes SET
         css_r2_key = ?, css_url = ?, css_r2_bucket = ?, compiled_css_hash = ?,
         preview_image_url = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(
      meta.css_r2_key,
      meta.css_url,
      meta.css_r2_bucket,
      meta.compiled_css_hash,
      meta.preview_image_url ?? null,
      id,
    ).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE cms_themes SET
       css_r2_key = ?, css_url = ?, css_r2_bucket = ?, compiled_css_hash = ?, updated_at = unixepoch()
     WHERE id = ?`,
  ).bind(meta.css_r2_key, meta.css_url, meta.css_r2_bucket, meta.compiled_css_hash, id).run();
}
