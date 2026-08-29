/**
 * Outcome 3b pilot — backfill published section manifests + KV route pointers.
 */
import { normalizeCmsRoute } from '../../routing/normalize-route.js';
import {
  cmsPublishedRoutePointerKey,
  loadCmsPublishedManifestByRoute,
  publishCmsPageSectionArtifacts,
} from './section-artifacts.js';

/** IAM marketing routes on the manifest-first public read pilot. */
export const CMS_PUBLIC_MANIFEST_PILOT_ROUTES = ['/', '/agentsam', '/about'].map((route) =>
  normalizeCmsRoute(route),
);

/**
 * @param {any} env
 * @param {string} routePath
 */
export async function findPublishedCmsPageByRoute(env, routePath) {
  const route = normalizeCmsRoute(routePath);
  const db = env?.DB;
  if (!db?.prepare) return null;
  return db
    .prepare(
      `SELECT id, route_path, slug, title, status, page_type, project_slug, project_id, r2_key, published_manifest_r2_key
         FROM cms_pages
        WHERE route_path = ?
          AND status = 'published'
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
    .bind(route)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {string} routePath
 */
export async function cmsPublishedRoutePointerExists(env, routePath) {
  const route = normalizeCmsRoute(routePath);
  if (!env?.SESSION_CACHE?.get) return false;
  const raw = await env.SESSION_CACHE.get(cmsPublishedRoutePointerKey(route)).catch(() => null);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.manifest_r2_key);
  } catch {
    return false;
  }
}

/**
 * Publish section artifacts + manifest + KV pointer for one published page route.
 *
 * @param {any} env
 * @param {string} routePath
 * @param {{ force?: boolean }} [opts]
 */
export async function backfillCmsPublishedManifestForRoute(env, routePath, opts = {}) {
  const route = normalizeCmsRoute(routePath);
  const page = await findPublishedCmsPageByRoute(env, route);
  if (!page?.id) {
    return { ok: false, route, skipped: true, reason: 'published_page_not_found' };
  }

  const existingManifest = await loadCmsPublishedManifestByRoute(env, route).catch(() => null);
  const hasPointer = await cmsPublishedRoutePointerExists(env, route);
  if (!opts.force && existingManifest?.page?.id && page.published_manifest_r2_key && hasPointer) {
    return {
      ok: true,
      route,
      skipped: true,
      reason: 'already_backfilled',
      page_id: page.id,
      manifest_r2_key: page.published_manifest_r2_key,
      publication_id: existingManifest.publication_id || null,
    };
  }

  const published = await publishCmsPageSectionArtifacts(env, {
    page,
    pageId: String(page.id),
  });

  return {
    ok: true,
    route,
    skipped: false,
    page_id: page.id,
    publication_id: published.publication_id,
    manifest_r2_key: published.manifest_r2_key,
    section_count: published.sections?.length || 0,
  };
}

/**
 * @param {any} env
 * @param {{ routes?: string[], force?: boolean, dryRun?: boolean }} [opts]
 */
export async function backfillCmsPublicManifestPilotRoutes(env, opts = {}) {
  const routes = (opts.routes?.length ? opts.routes : CMS_PUBLIC_MANIFEST_PILOT_ROUTES).map((route) =>
    normalizeCmsRoute(route),
  );
  const results = [];
  for (const route of routes) {
    if (opts.dryRun) {
      const page = await findPublishedCmsPageByRoute(env, route);
      const manifest = page?.id ? await loadCmsPublishedManifestByRoute(env, route).catch(() => null) : null;
      const hasPointer = page?.id ? await cmsPublishedRoutePointerExists(env, route) : false;
      results.push({
        ok: Boolean(page?.id),
        route,
        dry_run: true,
        page_id: page?.id || null,
        published_manifest_r2_key: page?.published_manifest_r2_key || null,
        manifest_loaded: Boolean(manifest?.page?.id),
        kv_pointer: hasPointer,
        would_publish: Boolean(page?.id) && (!page?.published_manifest_r2_key || !manifest?.page?.id || !hasPointer || opts.force),
      });
      continue;
    }
    results.push(await backfillCmsPublishedManifestForRoute(env, route, { force: opts.force === true }));
  }
  return { routes, results };
}
