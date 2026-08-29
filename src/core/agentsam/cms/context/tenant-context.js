/**
 * CMS tenant resolution — D1 cms_tenants + settings.slug_aliases + project_context notes.
 * No hardcoded slug alias maps in application code.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonSafe(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} settingsRaw
 * @returns {string[]}
 */
export function tenantSlugAliasesFromSettings(settingsRaw) {
  const settings = parseJsonSafe(settingsRaw, {});
  const raw = settings.slug_aliases ?? settings.slugAliases ?? settings.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => trim(v)).filter(Boolean);
}

/**
 * @param {any} env
 * @returns {Promise<{ bySlug: Map<string, object>, byAlias: Map<string, object> }>}
 */
export async function loadCmsTenantIndex(env) {
  const bySlug = new Map();
  const byAlias = new Map();
  if (!env?.DB) return { bySlug, byAlias };

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, slug, name, domain, logo_url, primary_color, settings
         FROM cms_tenants
        WHERE COALESCE(is_active, 1) = 1`,
    ).all();

    for (const row of results || []) {
      const slug = trim(row.slug);
      const id = trim(row.id);
      if (slug) bySlug.set(slug, row);
      if (id && id !== slug) bySlug.set(id, row);
      for (const alias of tenantSlugAliasesFromSettings(row.settings)) {
        byAlias.set(alias, row);
      }
    }
  } catch (e) {
    console.warn('[cms-tenant-resolve] load_index', e?.message ?? e);
  }

  return { bySlug, byAlias };
}

/**
 * @param {{ bySlug: Map<string, object>, byAlias: Map<string, object> }} index
 * @param {string|null|undefined} projectSlug
 */
export function resolveCmsTenantFromIndex(index, projectSlug) {
  const slug = trim(projectSlug);
  if (!slug) return null;
  return index.bySlug.get(slug) || index.byAlias.get(slug) || null;
}

/**
 * @param {any} env
 * @param {string|null|undefined} projectSlug
 * @param {{ bySlug?: Map<string, object>, byAlias?: Map<string, object> }} [cachedIndex]
 */
export async function resolveCmsTenantByProjectSlug(env, projectSlug, cachedIndex = null) {
  const slug = trim(projectSlug);
  if (!env?.DB || !slug) return null;

  const index = cachedIndex?.bySlug ? cachedIndex : await loadCmsTenantIndex(env);
  let tenant = resolveCmsTenantFromIndex(index, slug);
  if (tenant) return tenant;

  try {
    const ctx = await env.DB.prepare(
      `SELECT notes FROM agentsam_project_context
        WHERE project_key = ?
          AND COALESCE(status, 'active') = 'active'
        LIMIT 1`,
    )
      .bind(slug)
      .first();
    const canonical = trim(parseJsonSafe(ctx?.notes, {}).canonical_tenant_slug);
    if (canonical) {
      tenant = resolveCmsTenantFromIndex(index, canonical);
      if (tenant) return tenant;
    }
  } catch (e) {
    console.warn('[cms-tenant-resolve] project_context', e?.message ?? e);
  }

  return null;
}

/**
 * @param {object|null|undefined} tenantRow
 */
export function cmsTenantPublicDomain(tenantRow) {
  return trim(tenantRow?.domain) || null;
}
