function trim(value) {
  return value == null ? '' : String(value).trim();
}

/** System/global catalog rows are reusable templates, never tenant-mutable. */
export function isSharedCmsTheme(row) {
  return Number(row?.is_system || 0) === 1 || !trim(row?.tenant_id);
}

/** A tenant may read shared catalog themes and its own custom themes. */
export function tenantCanReadCmsTheme(row, tenantId) {
  if (!row) return false;
  if (isSharedCmsTheme(row)) return true;
  const tid = trim(tenantId);
  return Boolean(tid && trim(row?.tenant_id) === tid);
}

/** Only a tenant-owned non-system row may be mutated or archived in place. */
export function tenantCanMutateCmsTheme(row, tenantId) {
  if (!row || isSharedCmsTheme(row)) return false;
  const tid = trim(tenantId);
  return Boolean(tid && trim(row?.tenant_id) === tid);
}

/**
 * Pick an active globally unique slug. R2 package paths are slug-addressed, so
 * tenant-local SQL uniqueness alone is not enough for a custom fork.
 */
export async function resolveUniqueCmsThemeSlug(env, desiredSlug, opts = {}) {
  const db = env?.DB;
  const base = trim(desiredSlug).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (!db || !base) return base;
  const excludeId = trim(opts.excludeId);
  const exists = async (slug) => {
    const row = await db.prepare(
      `SELECT id FROM cms_themes
       WHERE slug = ?
         AND (? = '' OR id != ?)
       LIMIT 1`,
    ).bind(slug, excludeId, excludeId).first();
    return Boolean(row?.id);
  };
  if (!(await exists(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function findTenantCmsThemeFork(env, tenantId, sourceThemeId) {
  const tid = trim(tenantId);
  const sourceId = trim(sourceThemeId);
  if (!env?.DB || !tid || !sourceId) return null;
  return env.DB.prepare(
    `SELECT * FROM cms_themes
     WHERE tenant_id = ?
       AND alias_of_theme_id = ?
       AND COALESCE(status, 'active') != 'archived'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  ).bind(tid, sourceId).first();
}

/**
 * Fork a shared/system palette into a private tenant-owned row. The source row
 * stays immutable. R2 compile pointers are intentionally cleared because the
 * fork has not been compiled yet.
 */
export async function forkSharedCmsThemeForTenant(env, sourceRow, tenantId, desiredSlug = '') {
  if (!env?.DB) throw new Error('DB not configured');
  const tid = trim(tenantId);
  const sourceId = trim(sourceRow?.id);
  if (!tid || !sourceId || !isSharedCmsTheme(sourceRow)) {
    throw new Error('shared theme and tenant required');
  }

  const existing = await findTenantCmsThemeFork(env, tid, sourceId);
  if (existing) return { row: existing, forked: false };

  const sourceSlug = trim(sourceRow?.slug) || 'theme';
  const requested = trim(desiredSlug);
  const baseSlug = requested && requested !== sourceSlug ? requested : `${sourceSlug}-custom`;
  const slug = await resolveUniqueCmsThemeSlug(env, baseSlug);
  const id = `theme-${crypto.randomUUID()}`;
  const name = trim(sourceRow?.name) || sourceSlug;

  await env.DB.prepare(
    `INSERT INTO cms_themes (
       id, tenant_id, name, slug, css_url, config, is_system,
       wcag_scores, contrast_flags, theme_family, sort_order, workspace_id,
       monaco_theme, monaco_bg, monaco_theme_data,
       tokens_json, css_vars_json, brand_json, layout_json, typography_json,
       components_json, motion_json,
       css_r2_key, compiled_css_hash, preview_image_url,
       status, visibility, alias_of_theme_id, css_r2_bucket,
       created_at, created_at_unix, updated_at
     ) VALUES (
       ?, ?, ?, ?, NULL, ?, 0,
       ?, ?, ?, ?, NULL,
       ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?,
       NULL, NULL, ?,
       'active', 'private', ?, NULL,
       CURRENT_TIMESTAMP, unixepoch(), unixepoch()
     )`,
  ).bind(
    id,
    tid,
    name,
    slug,
    trim(sourceRow?.config) || '{}',
    sourceRow?.wcag_scores ?? null,
    sourceRow?.contrast_flags ?? null,
    trim(sourceRow?.theme_family) || 'custom',
    Number.isFinite(Number(sourceRow?.sort_order)) ? Number(sourceRow.sort_order) : 500,
    trim(sourceRow?.monaco_theme) || 'vs-dark',
    trim(sourceRow?.monaco_bg) || '#1e293b',
    sourceRow?.monaco_theme_data ?? null,
    trim(sourceRow?.tokens_json) || '{}',
    trim(sourceRow?.css_vars_json) || '{}',
    trim(sourceRow?.brand_json) || '{}',
    trim(sourceRow?.layout_json) || '{}',
    trim(sourceRow?.typography_json) || '{}',
    trim(sourceRow?.components_json) || '{}',
    trim(sourceRow?.motion_json) || '{}',
    sourceRow?.preview_image_url ?? null,
    sourceId,
  ).run();

  const row = await env.DB.prepare(`SELECT * FROM cms_themes WHERE id = ? LIMIT 1`).bind(id).first();
  if (!row) throw new Error('Theme fork failed');
  return { row, forked: true };
}
