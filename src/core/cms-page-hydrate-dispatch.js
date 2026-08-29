/**
 * Route-aware CMS page hydration — dispatches to page-specific hydrators,
 * then applies R2-injected section HTML for any route.
 */
import { hydrateContactPageHtml } from './cms-contact-hydrate.js';
import { hydrateGamesPageHtml } from './cms-games-hydrate.js';
import { hydrateWorkPageHtml } from './cms-work-hydrate.js';
import { hydratePageWithInjectedSections } from './cms-injected-sections.js';

/** @param {string} routePath */
export function normalizeCmsRoutePath(routePath) {
  const raw = String(routePath || '').trim() || '/';
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw.replace(/\/+$/, '') || '/';
}

/**
 * @param {string} html
 * @param {string} routePath
 * @param {Array<Record<string, unknown>>} sections
 * @param {unknown} r2Binding
 */
export async function hydrateCmsRoutePageHtml(html, routePath, sections, r2Binding) {
  const route = normalizeCmsRoutePath(routePath);
  let out = String(html || '');

  if (route === '/contact') {
    out = hydrateContactPageHtml(out, sections);
  } else if (route === '/games') {
    out = hydrateGamesPageHtml(out, sections);
  } else if (route === '/work') {
    out = hydrateWorkPageHtml(out, sections);
  }

  if (r2Binding) {
    out = await hydratePageWithInjectedSections(out, sections, r2Binding);
  }

  return out;
}

/** Map a CMS route_path to a static R2 shell key when one exists. */
export function cmsStaticShellKeyForRoute(routePath) {
  const route = normalizeCmsRoutePath(routePath);
  const STATIC = {
    '/': 'pages/home/index.html',
    '/home': 'pages/home/index.html',
    '/contact': 'pages/contact/index.html',
    '/games': 'pages/games/index.html',
    '/work': 'pages/work/index.html',
    '/about': 'pages/about/index.html',
    '/services': 'pages/services/index.html',
    '/pricing': 'pages/pricing/index.html',
  };
  return STATIC[route] || null;
}
