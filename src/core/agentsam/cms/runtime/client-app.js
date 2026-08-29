/**
 * Resolve client_apps inventory by app_key (= CMS project_slug).
 * Prefer this over agentsam_workspace.metadata_json for storage + dialect.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/** Normalize R2 inventory entries (object entries or legacy strings). */
export function normalizeR2Buckets(raw) {
  const parsed = parseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (typeof item === 'string') {
        const s = trim(item);
        if (!s) return null;
        if (s.includes('r2.cloudflarestorage.com/')) {
          const name = s.split('/').pop() || s;
          return {
            role: 'website_assets',
            binding: null,
            bucket_name: name,
            custom_domain: null,
            s3_api: s,
          };
        }
        return {
          role: 'website_assets',
          binding: null,
          bucket_name: s,
          custom_domain: null,
          s3_api: null,
        };
      }
      if (!item || typeof item !== 'object') return null;
      const bucket_name = trim(item.bucket_name || item.name || item.bucket);
      if (!bucket_name) return null;
      return {
        role: trim(item.role) || 'website_assets',
        binding: trim(item.binding) || null,
        bucket_name,
        custom_domain: trim(item.custom_domain) || null,
        s3_api: trim(item.s3_api) || null,
      };
    })
    .filter(Boolean);
}

export function normalizeD1Databases(raw) {
  const parsed = parseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (typeof item === 'string') {
        const id = trim(item);
        if (!id) return null;
        return { role: 'primary', binding: 'DB', database_name: null, database_id: id };
      }
      if (!item || typeof item !== 'object') return null;
      const database_id = trim(item.database_id || item.id);
      if (!database_id && !trim(item.database_name)) return null;
      return {
        role: trim(item.role) || 'primary',
        binding: trim(item.binding) || 'DB',
        database_name: trim(item.database_name) || null,
        database_id: database_id || null,
      };
    })
    .filter(Boolean);
}

export function deriveCmsApiProfile(meta, fallback = null) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return (
    trim(m.cms_api_profile) ||
    trim(m.api_profile) ||
    (fallback != null ? trim(fallback) : '') ||
    null
  );
}

export function websiteR2FromApp(app) {
  const buckets = Array.isArray(app?.r2_buckets) ? app.r2_buckets : normalizeR2Buckets(app?.r2_buckets);
  const byRole = buckets.find((b) => b.role === 'website_assets');
  return byRole || buckets[0] || null;
}

export function catalogR2FromApp(app) {
  const buckets = Array.isArray(app?.r2_buckets) ? app.r2_buckets : normalizeR2Buckets(app?.r2_buckets);
  return buckets.find((b) => b.role === 'cms_catalog') || null;
}

/**
 * @param {any} env
 * @param {string} projectSlug
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function resolveClientAppByProjectSlug(env, projectSlug) {
  const key = trim(projectSlug);
  if (!env?.DB || !key) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, client_id, app_key, display_name, logo_url, worker_id, github_repository,
              project_id, status, d1_databases, r2_buckets, bindings_json, metadata_json, instructions,
              tenant_id
         FROM client_apps
        WHERE app_key = ? AND COALESCE(status, 'active') = 'active'
        LIMIT 1`,
    )
      .bind(key)
      .first();
    if (!row?.id) return null;

    const metadata_json = parseJson(row.metadata_json, {});
    const r2_buckets = normalizeR2Buckets(row.r2_buckets);
    const d1_databases = normalizeD1Databases(row.d1_databases);
    const bindings_json = parseJson(row.bindings_json, null);
    const cms_api_profile = deriveCmsApiProfile(metadata_json);

    return {
      id: row.id,
      client_id: trim(row.client_id) || null,
      app_key: trim(row.app_key),
      display_name: trim(row.display_name) || key,
      logo_url: trim(row.logo_url) || null,
      worker_id: trim(row.worker_id) || null,
      github_repository: trim(row.github_repository) || null,
      project_id: trim(row.project_id) || null,
      tenant_id: trim(row.tenant_id) || null,
      cms_api_profile,
      d1_databases,
      r2_buckets,
      bindings_json,
      metadata_json,
      instructions: row.instructions != null ? String(row.instructions) : null,
      status: trim(row.status) || 'active',
      website_r2: websiteR2FromApp({ r2_buckets }),
      catalog_r2: catalogR2FromApp({ r2_buckets }),
    };
  } catch (e) {
    console.warn('[cms] resolveClientAppByProjectSlug', e?.message || e);
    return null;
  }
}
