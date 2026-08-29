/**
 * Studio canvas preview URLs — draft/live storefront with CMS embed markers.
 * Domain must come from bootstrap / workspace context (never invent a host).
 */

export type CmsEditorPreviewMode = 'draft' | 'published' | 'live';

export function cmsEditorSectionEmbedKey(section: { id?: string; name?: string; type?: string }) {
  const raw = String(section?.name || section?.type || section?.id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || String(section?.id || 'section');
}

function normalizeHost(raw?: string | null) {
  const host = String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  return host || null;
}

/**
 * Build the URL the editor iframe should load for a real site preview.
 * Returns null when no public domain is available — callers keep wireframe srcDoc.
 */
export function buildCmsEditorPagePreviewUrl(input: {
  domain?: string | null;
  routePath?: string | null;
  pageId?: string | null;
  mode?: CmsEditorPreviewMode;
  revision?: number;
}): string | null {
  const host = normalizeHost(input.domain);
  if (!host) return null;

  let route = String(input.routePath || '/').trim() || '/';
  if (!route.startsWith('/')) route = `/${route}`;
  if (route.length > 1) route = route.replace(/\/+$/, '');

  const url = new URL(`https://${host}${route}`);
  const mode = input.mode || 'draft';
  if (mode === 'draft') url.searchParams.set('preview', 'draft');
  if (mode === 'published') url.searchParams.set('preview', 'published');
  url.searchParams.set('cms', '1');
  if (input.pageId) url.searchParams.set('page_id', String(input.pageId));
  if (input.revision != null && Number.isFinite(Number(input.revision))) {
    url.searchParams.set('_r', String(input.revision));
  }
  return url.toString();
}
