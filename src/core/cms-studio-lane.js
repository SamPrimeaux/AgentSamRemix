/**
 * CMS Studio lane — legacy /studio/* and studio.inneranimalmedia.com host.
 * Authoring UI is the dashboard CMS (StudioCmsHost iframe → studio-cms.js).
 * This module only redirects those URLs onto /dashboard/cms/* — no old cms-editor shell.
 */
import { getDashboardR2Object } from './dashboard-r2-assets.js';

export const CMS_STUDIO_HOST = 'studio.inneranimalmedia.com';

/** @param {string|null|undefined} hostname */
export function isCmsStudioHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return h === CMS_STUDIO_HOST || h === `www.${CMS_STUDIO_HOST}`;
}

/**
 * Path alias on the primary domain until studio DNS is retired.
 * @param {string} pathLower
 */
export function isCmsStudioPathAlias(pathLower) {
  return (
    pathLower === '/studio' ||
    pathLower === '/studio/' ||
    pathLower === '/studio/editor' ||
    pathLower === '/studio/pages' ||
    pathLower.startsWith('/studio/pages/') ||
    pathLower === '/studio/theme-editor'
  );
}

/**
 * @param {URL} url
 */
export function normalizeCmsStudioUrl(url) {
  if (!isCmsStudioPathAlias(url.pathname.toLowerCase())) return url;
  const next = new URL(url.toString());
  const rest = next.pathname.replace(/^\/studio\/?/, '/');
  next.pathname = rest.startsWith('/') ? rest : `/${rest}`;
  if (next.pathname === '/') next.pathname = '/editor';
  return next;
}

/**
 * @param {string} pathLower
 * @returns {boolean}
 */
export function isCmsStudioAuthShellPath(pathLower) {
  if (!pathLower || pathLower.startsWith('/api/') || pathLower.startsWith('/auth/')) return false;
  if (isCmsStudioPathAlias(pathLower)) return true;
  if (pathLower === '/editor' || pathLower === '/pages' || pathLower === '/theme-editor') return true;
  if (pathLower.startsWith('/pages/')) return true;
  if (pathLower === '/' || pathLower === '') return true;
  return false;
}

/**
 * @param {string} pathLower
 */
export function isCmsStudioStaticAssetPath(pathLower) {
  return (
    pathLower.startsWith('/static/dashboard/app/cms/') ||
    pathLower.startsWith('/static/dashboard/app/vendor/') ||
    pathLower === '/static/dashboard/shell.css'
  );
}

/**
 * Map legacy studio path → dashboard CMS path.
 * @param {URL} studioUrl
 * @param {{ primaryOrigin: string }} opts
 */
export function buildDashboardCmsRedirect(studioUrl, opts) {
  const primary = String(opts.primaryOrigin || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const path = studioUrl.pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(studioUrl.searchParams);
  const site = q.get('site') || q.get('project') || q.get('project_slug') || '';

  let destPath = '/dashboard/cms';
  if (path === '/theme-editor') {
    destPath = '/dashboard/cms/theme-editor';
  } else if (path.startsWith('/pages/')) {
    const pageId = decodeURIComponent(path.slice('/pages/'.length)).split('/')[0];
    destPath = pageId
      ? `/dashboard/cms/pages/${encodeURIComponent(pageId)}`
      : '/dashboard/cms/pages';
  } else if (path === '/pages' || path === '/editor' || path === '/') {
    destPath = '/dashboard/cms/pages';
  }

  const dest = new URL(`${primary}${destPath}`);
  if (site) dest.searchParams.set('site', site);
  const page = q.get('page');
  if (page && !path.startsWith('/pages/')) dest.searchParams.set('page', page);
  return dest;
}

/**
 * @param {any} env
 * @param {string} assetPathLower
 * @param {(key: string) => string} getMimeType
 */
async function serveStudioStaticAsset(env, assetPathLower, getMimeType) {
  if (!env?.ASSETS) return null;
  const key = assetPathLower.startsWith('/') ? assetPathLower.slice(1) : assetPathLower;
  // Old cms-editor.js / cms-studio-shell.html must not be served — redirect HTML shells via lane.
  if (
    key.endsWith('cms-studio-shell.html') ||
    key.endsWith('cms-editor.js') ||
    key.endsWith('cms-editor-core.js') ||
    key.endsWith('designstudiocmslite.html')
  ) {
    return null;
  }
  const obj = await getDashboardR2Object(env.ASSETS, key).catch(() => null);
  if (!obj) {
    const fallback = await env.ASSETS.get(key).catch(() => null);
    if (!fallback) return null;
    return new Response(fallback.body, {
      headers: {
        'Content-Type': fallback.httpMetadata?.contentType || getMimeType(key),
        'Cache-Control': assetPathLower.endsWith('.html')
          ? 'private, no-store, max-age=0'
          : 'public, max-age=3600',
      },
    });
  }
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || getMimeType(key),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * @param {{
 *   request: Request,
 *   url: URL,
 *   env: any,
 *   methodUpper: string,
 *   pathLower: string,
 *   getMimeType: (key: string) => string,
 *   withSessionHealing: (res: Response) => Response,
 * }} opts
 * @returns {Promise<Response|null>}
 */
export async function dispatchCmsStudioLane(opts) {
  const { url, env, methodUpper, pathLower, getMimeType, withSessionHealing } = opts;
  const onStudioHost = isCmsStudioHost(url.hostname);
  const onStudioPath = isCmsStudioPathAlias(pathLower);
  if (!onStudioHost && !onStudioPath) return null;

  const studioUrl = onStudioPath ? normalizeCmsStudioUrl(url) : url;

  if (methodUpper !== 'GET' && methodUpper !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (pathLower.startsWith('/api/') || pathLower.startsWith('/auth/')) return null;

  // Still allow studio-cms.js / studio-cms-shell.html static assets on this host.
  if (isCmsStudioStaticAssetPath(pathLower)) {
    const assetRes = await serveStudioStaticAsset(env, pathLower, getMimeType);
    if (assetRes) return assetRes;
  }

  const pathForRoute = studioUrl.pathname.toLowerCase();
  const primaryOrigin = onStudioHost ? 'https://inneranimalmedia.com' : url.origin;

  if (
    pathForRoute === '/' ||
    pathForRoute === '' ||
    pathForRoute === '/editor' ||
    pathForRoute === '/pages' ||
    pathForRoute.startsWith('/pages/') ||
    pathForRoute === '/theme-editor' ||
    pathLower === '/static/dashboard/app/cms/cms-studio-shell.html'
  ) {
    const dest = buildDashboardCmsRedirect(studioUrl, { primaryOrigin });
    return withSessionHealing(Response.redirect(dest.toString(), 302));
  }

  if (pathLower.startsWith('/static/')) {
    const assetRes = await serveStudioStaticAsset(env, pathLower, getMimeType);
    if (assetRes) return assetRes;
  }

  const dest = buildDashboardCmsRedirect(studioUrl, { primaryOrigin });
  return withSessionHealing(Response.redirect(dest.toString(), 302));
}

/**
 * Platform default studio URL for workspace CMS context — dashboard CMS, not legacy shell.
 * @param {Record<string, unknown>|null|undefined} meta
 */
export function resolvePlatformCmsStudioUrl(meta) {
  const fromMeta = String(meta?.studio_url || meta?.cms_studio_url || '').trim();
  if (fromMeta && !/\/studio\/editor/i.test(fromMeta) && !/cms-studio-shell/i.test(fromMeta)) {
    return fromMeta.replace(/\/$/, '');
  }
  return `https://inneranimalmedia.com/dashboard/cms`;
}
