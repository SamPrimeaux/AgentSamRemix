/**
 * Gate CMS D1 route probes — skip dashboard, static assets, and other non-storefront paths.
 */
import { isPublicCmsPreviewRequest } from './cms-preview-route.js';

const STATIC_ASSET_EXT =
  /\.(js|mjs|cjs|css|map|woff2?|ttf|eot|png|jpe?g|gif|webp|svg|ico|json|webmanifest|glb|gltf|wasm|mp4|webm|mp3|txt|xml|pdf)$/i;

/**
 * @param {string} pathLower
 * @returns {boolean}
 */
export function isNonCmsWorkerPath(pathLower) {
  const p = String(pathLower || '').trim().toLowerCase();
  if (!p || p.startsWith('/api/')) return true;
  if (p === '/dashboard' || p.startsWith('/dashboard/')) return true;
  if (p.startsWith('/static/')) return true;
  if (p.startsWith('/assets/')) return true;
  if (p === '/onboarding' || p.startsWith('/onboarding/')) return true;
  if (p.startsWith('/oauth/')) return true;
  if (STATIC_ASSET_EXT.test(p)) return true;
  return false;
}

/**
 * Whether the Worker should run cms_pages D1 lookup for a dynamic (non-assetHtmlKey) path.
 * @param {URL} url
 * @param {string} [method='GET']
 */
export function shouldProbeCmsPagesForRequest(url, method = 'GET') {
  const pathLower = String(url?.pathname || '').trim().toLowerCase() || '/';
  if (isNonCmsWorkerPath(pathLower)) return false;
  if (isPublicCmsPreviewRequest(url, method)) return true;
  if (pathLower.startsWith('/marketing/')) return false;
  if (/^\/work\/[a-z0-9-]+$/i.test(pathLower)) return false;
  return true;
}
