/**
 * Canonical CMS route-path normalizer (package-local name so it does not collide
 * with the legacy hydrator export used by platform storefront code).
 * @param {string} routePath
 */
export function normalizeCmsRoute(routePath) {
  const raw = String(routePath || '').trim() || '/';
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw.replace(/\/+$/, '') || '/';
}
