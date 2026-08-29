/** Public CMS read: KV current pointer -> immutable R2 manifest/sections; D1 fallback during migration. */
import { CMS_PUBLIC_MANIFEST_PILOT_ROUTES } from './agentsam/cms/adapters/cloudflare/public-manifest-backfill.js';
import { loadCmsPublishedManifestByRoute, readCmsSectionArtifact } from './agentsam/cms/adapters/cloudflare/section-artifacts.js';
import { normalizeCmsRoutePath } from './cms-page-hydrate-dispatch.js';

export { CMS_PUBLIC_MANIFEST_PILOT_ROUTES };

function parseSectionData(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Structured log when public reads still hit the D1 migration path. */
export function logCmsPublicReadFallback(routePath, details = {}) {
  console.warn(
    '[cms-public-read]',
    JSON.stringify({
      event: 'd1_fallback',
      route: normalizeCmsRoutePath(routePath),
      ts: Date.now(),
      ...details,
    }),
  );
}

/**
 * @param {any} env
 * @param {string} routePath
 */
export async function loadPublishedCmsSectionsByRoute(env, routePath) {
  const route = normalizeCmsRoutePath(routePath);
  const pilotRoute = CMS_PUBLIC_MANIFEST_PILOT_ROUTES.includes(route);
  const manifest = await loadCmsPublishedManifestByRoute(env, route).catch(() => null);
  if (manifest?.page && Array.isArray(manifest.sections)) {
    const sections = (
      await Promise.all(
        manifest.sections
          .filter((s) => s.is_visible !== false)
          .map(async (s) => ({
            id: s.id,
            section_type: s.type,
            section_name: s.name,
            section_data: (await readCmsSectionArtifact(env, s.r2_key)) || {},
            sort_order: Number(s.sort_order || 0),
            is_visible: 1,
            r2_key: s.r2_key,
            content_hash: s.content_hash || null,
          })),
      )
    ).sort((a, b) => a.sort_order - b.sort_order);
    return {
      page: {
        ...manifest.page,
        status: 'published',
        published_manifest_r2_key: manifest.manifest_r2_key || null,
      },
      sections,
      source: 'r2_manifest',
      publication_id: manifest.publication_id || null,
    };
  }

  const db = env?.DB;
  if (!db) return { page: null, sections: [], source: 'none' };
  const page = await db
    .prepare(
      `SELECT id,route_path,slug,title,status,page_type,r2_key,published_manifest_r2_key
         FROM cms_pages
        WHERE route_path = ?
          AND status = 'published'
          AND COALESCE(is_active,1) = 1
        LIMIT 1`,
    )
    .bind(route)
    .first()
    .catch(() => null);
  if (!page?.id) {
    if (pilotRoute) logCmsPublicReadFallback(route, { reason: 'published_page_not_found' });
    return { page: null, sections: [], source: pilotRoute ? 'pilot_missing' : 'd1_fallback' };
  }

  const { results = [] } = await db
    .prepare(
      `SELECT id,section_type,section_name,section_data,sort_order,is_visible,published_r2_key
         FROM cms_page_sections
        WHERE page_id = ?
          AND COALESCE(is_visible,1) = 1
        ORDER BY sort_order ASC,section_name ASC`,
    )
    .bind(page.id)
    .all()
    .catch(() => ({ results: [] }));

  const sections = [];
  for (const row of results || []) {
    const publishedKey = String(row.published_r2_key || '').trim();
    const r2 = publishedKey ? await readCmsSectionArtifact(env, publishedKey) : null;
    const allowD1SectionData = !pilotRoute;
    if (pilotRoute && !publishedKey) {
      logCmsPublicReadFallback(route, {
        reason: 'pilot_section_missing_published_r2_key',
        page_id: page.id,
        section_id: row.id,
      });
    }
    sections.push({
      ...row,
      section_data: r2 || (allowD1SectionData ? parseSectionData(row.section_data) : {}),
    });
  }

  logCmsPublicReadFallback(route, {
    page_id: page.id,
    section_count: sections.length,
    pilot_route: pilotRoute,
    published_manifest_r2_key: page.published_manifest_r2_key || null,
  });

  return {
    page,
    sections,
    source: pilotRoute ? 'pilot_d1_fallback' : 'd1_fallback',
  };
}

export function indexCmsSections(sections) {
  const byType = {};
  const byKey = {};
  for (const row of sections || []) {
    const data = row.section_data || {};
    if (!byType[row.section_type]) byType[row.section_type] = data;
    byKey[`${row.section_type}:${row.section_name}`] = data;
  }
  return { byType, byKey };
}

export function cmsSection(byKey, byType, type, name, fallback = {}) {
  if (name && byKey[`${type}:${name}`]) return { ...fallback, ...byKey[`${type}:${name}`] };
  if (byType[type]) return { ...fallback, ...byType[type] };
  return { ...fallback };
}
