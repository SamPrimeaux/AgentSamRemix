/**
 * Inner Animal Media marketing storefront — R2 ASSETS layout (inneranimalmedia bucket).
 * Public Worker serves these keys; CMS edits must read/write/publish the same paths.
 */
import { normalizeCmsRoutePath } from './cms-page-hydrate-dispatch.js';

export const IAM_STOREFRONT_BUCKET = 'inneranimalmedia';

/** @typedef {{
 *   route: string,
 *   r2_key: string,
 *   label: string,
 *   chrome?: boolean,
 *   hydrate?: boolean,
 *   cms_page_id?: string,
 *   skip_shell?: boolean,
 * }} IamStorefrontAssetDef */

/** Canonical IAM marketing shells on ASSETS R2 (source of truth for live HTML). */
export const IAM_STOREFRONT_ASSET_PAGES = [
  { route: '/', r2_key: 'pages/home/index.html', label: 'Home', chrome: true, hydrate: true, cms_page_id: 'page_home' },
  { route: '/work', r2_key: 'pages/work/index.html', label: 'Work', chrome: true, hydrate: true, cms_page_id: 'page_inneranimalmedia_work' },
  { route: '/about', r2_key: 'pages/about/index.html', label: 'About', chrome: true, hydrate: true, cms_page_id: 'page_inneranimalmedia_about' },
  { route: '/services', r2_key: 'pages/services/index.html', label: 'Services', chrome: true, hydrate: true, cms_page_id: 'page_inneranimalmedia_services' },
  { route: '/contact', r2_key: 'pages/contact/index.html', label: 'Contact', chrome: true, hydrate: true, cms_page_id: 'page_contact' },
  {
    route: '/agentsam',
    r2_key: 'pages/agentsam/index.html',
    label: 'Agent Sam',
    chrome: true,
    hydrate: false,
    cms_page_id: '5de91aa0-10cc-45e5-9607-199d5c2f8467',
  },
  { route: '/games', r2_key: 'pages/games/index.html', label: 'Games', chrome: true, hydrate: true, cms_page_id: 'page_inneranimalmedia_games' },
  { route: '/pricing', r2_key: 'pages/pricing/index.html', label: 'Pricing', chrome: true, hydrate: true, cms_page_id: 'page_pricing' },
  { route: '/privacy', r2_key: 'pages/privacy/index.html', label: 'Privacy', chrome: true, hydrate: false, cms_page_id: 'page_privacy' },
  { route: '/terms', r2_key: 'pages/terms/index.html', label: 'Terms', chrome: true, hydrate: false, cms_page_id: 'page_terms' },
  { route: '/learn', r2_key: 'learn.html', label: 'Learn', chrome: true, hydrate: false },
  { route: '/start', r2_key: 'start-project.html', label: 'Start project', chrome: true, hydrate: false },
  { route: '/auth/login', r2_key: 'pages/auth/login.html', label: 'Login', skip_shell: true, cms_page_id: 'page_auth_login' },
  { route: '/auth/signup', r2_key: 'pages/auth/signup.html', label: 'Sign up', skip_shell: true, cms_page_id: 'page_auth_signup' },
  { route: '/auth/reset', r2_key: 'pages/auth/reset.html', label: 'Reset password', skip_shell: true, cms_page_id: 'page_auth_reset' },
];

const BY_ROUTE = new Map(
  IAM_STOREFRONT_ASSET_PAGES.map((d) => [normalizeCmsRoutePath(d.route), d]),
);
const BY_R2_KEY = new Map(IAM_STOREFRONT_ASSET_PAGES.map((d) => [d.r2_key, d]));
const BY_PAGE_ID = new Map(
  IAM_STOREFRONT_ASSET_PAGES.filter((d) => d.cms_page_id).map((d) => [d.cms_page_id, d]),
);

/** Worker ASSET_ROUTES map (path → R2 key). */
export function iamAssetRoutesMap() {
  const out = {};
  for (const def of IAM_STOREFRONT_ASSET_PAGES) {
    out[normalizeCmsRoutePath(def.route)] = def.r2_key;
  }
  return out;
}

/** R2 asset key → CMS route for section hydration. */
export function iamCmsHydrateRouteForAssetKey(r2Key) {
  const def = BY_R2_KEY.get(String(r2Key || '').trim());
  if (!def?.hydrate) return null;
  return normalizeCmsRoutePath(def.route);
}

/** @param {string} publishedKey */
export function storefrontAssetDraftKey(publishedKey) {
  const k = String(publishedKey || '').trim();
  if (!k) return '';
  if (k.startsWith('pages/')) return k.replace(/^pages\//, 'pages/.draft/');
  return `.draft/${k}`;
}

/**
 * R2 keys for a new IAM marketing page (not yet in IAM_STOREFRONT_ASSET_PAGES catalog).
 * @param {string} slug
 */
export function iamMarketingPageR2Keys(slug) {
  const seg = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
  const published_key = `pages/${seg}/index.html`;
  return {
    bucket: IAM_STOREFRONT_BUCKET,
    published_key,
    draft_key: storefrontAssetDraftKey(published_key),
  };
}

/**
 * @param {string} publishedKey
 * @param {{ preferDraft?: boolean }} [opts]
 */
export function resolveStorefrontAssetServeKey(publishedKey, opts = {}) {
  const published = String(publishedKey || '').trim();
  if (!published) return { key: '', published_key: '', draft_key: '', used_draft: false };
  const draft = storefrontAssetDraftKey(published);
  if (opts.preferDraft) {
    return { key: draft, published_key: published, draft_key: draft, prefer_draft: true };
  }
  return { key: published, published_key: published, draft_key: draft, prefer_draft: false };
}

/**
 * @param {Record<string, unknown>|null|undefined} page
 */
export function resolveIamStorefrontAssetForPage(page) {
  if (!page) return null;
  const pageId = String(page.id || '').trim();
  if (pageId && BY_PAGE_ID.has(pageId)) return BY_PAGE_ID.get(pageId);
  const route = normalizeCmsRoutePath(page.route_path || page.path || `/${page.slug || ''}`);
  return BY_ROUTE.get(route) || null;
}

/**
 * R2 keys for CMS read/write/publish — asset path is primary when mapped.
 * @param {Record<string, unknown>} page
 * @param {string} workspaceId
 * @param {import('./cms-edit-safety.js').cmsPageHtmlKey} cmsPageKeyFn
 */
export function resolveIamPageHtmlKeys(page, workspaceId, cmsPageKeyFn) {
  const asset = resolveIamStorefrontAssetForPage(page);
  const legacyDraft = cmsPageKeyFn(workspaceId, page.project_id, page.slug, 'draft');
  const legacyPublished = cmsPageKeyFn(workspaceId, page.project_id, page.slug, 'published');
  if (!asset) {
    return {
      mode: 'cms',
      bucket: String(page.r2_bucket || IAM_STOREFRONT_BUCKET).trim(),
      draft_key: legacyDraft,
      published_key: legacyPublished,
      asset: null,
    };
  }
  return {
    mode: 'storefront_asset',
    bucket: IAM_STOREFRONT_BUCKET,
    draft_key: storefrontAssetDraftKey(asset.r2_key),
    published_key: asset.r2_key,
    asset,
    legacy_draft_key: legacyDraft,
    legacy_published_key: legacyPublished,
  };
}

/**
 * @param {any} binding
 * @param {{ draft_key: string, published_key: string }} keys
 * @param {'draft'|'published'} variant
 */
export async function readStorefrontAssetHtml(binding, keys, variant = 'draft') {
  if (!binding) return { html: null, r2_key: null, byte_length: 0 };
  const primary = variant === 'published' ? keys.published_key : keys.draft_key;
  const fallback = variant === 'published' ? keys.published_key : keys.published_key;
  let obj = await binding.get(primary).catch(() => null);
  let usedKey = primary;
  if (!obj && variant === 'draft') {
    obj = await binding.get(keys.published_key).catch(() => null);
    usedKey = keys.published_key;
  }
  if (!obj && variant === 'published' && primary !== fallback) {
    obj = await binding.get(fallback).catch(() => null);
    usedKey = fallback;
  }
  if (!obj) return { html: null, r2_key: primary, byte_length: 0 };
  const html = await obj.text();
  return { html, r2_key: usedKey, byte_length: html.length };
}

/** Enrich bootstrap pages with storefront asset metadata. */
export function enrichPagesWithStorefrontAssets(pages) {
  return (pages || []).map((p) => {
    const asset = resolveIamStorefrontAssetForPage(p);
    if (!asset) return p;
    return {
      ...p,
      storefront_asset_r2_key: asset.r2_key,
      storefront_edit_mode: 'storefront_asset',
      storefront_hydrate: asset.hydrate === true,
      storefront_chrome: asset.chrome === true,
    };
  });
}

export function listIamStorefrontCatalog() {
  return IAM_STOREFRONT_ASSET_PAGES.map((d) => ({
    route_path: normalizeCmsRoutePath(d.route),
    r2_key: d.r2_key,
    label: d.label,
    cms_page_id: d.cms_page_id || null,
    hydrate: d.hydrate === true,
    chrome: d.chrome === true,
    skip_shell: d.skip_shell === true,
    bucket: IAM_STOREFRONT_BUCKET,
    draft_key: storefrontAssetDraftKey(d.r2_key),
  }));
}
