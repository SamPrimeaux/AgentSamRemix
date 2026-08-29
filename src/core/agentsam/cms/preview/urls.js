import { normalizeCmsPageRoute } from '../pages/normalize.js';

export function normalizeCmsPreviewHost(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  return host || null;
}

export function buildCmsPageUrls(page, opts = {}) {
  const route = normalizeCmsPageRoute(page?.route_path || page?.path, page?.slug);
  const host = normalizeCmsPreviewHost(opts.domain);
  const pageId = String(page?.id || '');
  if (!host) return { route_path: route, live_url: null, embed_url: null, preview_draft_url: null, preview_published_url: null, page_id: pageId };
  const base = `https://${host}${route}`;
  const withParams = (params) => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.toString();
  };
  return {
    route_path: route,
    live_url: base,
    embed_url: withParams({ cms: '1', page_id: pageId }),
    preview_draft_url: withParams({ preview: 'draft', cms: '1', page_id: pageId }),
    preview_published_url: withParams({ preview: 'published', cms: '1' }),
    page_id: pageId,
  };
}
