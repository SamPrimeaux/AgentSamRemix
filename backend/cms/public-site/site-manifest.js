import { PUBLIC_SITE_MANIFESTS } from '../../../config/public-sites/index.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeHost(value) {
  return trim(value)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase()
    .replace(/^www\./, '');
}

function normalizeKey(value) {
  return trim(value).replace(/^\/+|\/+$/g, '');
}

/**
 * Resolve site data by stable site ID or request host.
 *
 * @param {string|{siteId?: string, host?: string}|null|undefined} selector
 */
export function resolvePublicSiteManifest(selector) {
  const siteId = typeof selector === 'object' ? trim(selector?.siteId).toLowerCase() : trim(selector).toLowerCase();
  const host = typeof selector === 'object' ? normalizeHost(selector?.host) : normalizeHost(selector);
  if (siteId) {
    return PUBLIC_SITE_MANIFESTS.find((site) => site.siteId.toLowerCase() === siteId) || null;
  }
  if (host) {
    return PUBLIC_SITE_MANIFESTS.find((site) => site.hosts.some((candidate) => normalizeHost(candidate) === host)) || null;
  }
  return null;
}

/** @param {string|null|undefined} projectSlug */
export function publicSiteManifestForProject(projectSlug) {
  return resolvePublicSiteManifest(projectSlug);
}

/** @param {string} publishedKey */
export function publicSiteDraftKey(publishedKey) {
  const key = normalizeKey(publishedKey);
  if (!key) return '';
  const slash = key.lastIndexOf('/');
  if (slash < 0) return `.draft/${key}`;
  return `${key.slice(0, slash)}/.draft/${key.slice(slash + 1)}`;
}

/**
 * @param {Record<string, unknown>} site
 * @param {string} key
 */
export function publicSitePublicationKey(site, key) {
  const root = normalizeKey(site?.storage?.publishedRoot);
  const relative = normalizeKey(key);
  return [root, relative].filter(Boolean).join('/');
}

/** @param {Record<string, unknown>} site */
export function publicSiteShellParts(site) {
  return Array.isArray(site?.shell?.parts) ? site.shell.parts : [];
}
