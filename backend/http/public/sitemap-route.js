import { servePublicHtmlWithShell } from '../../cms/public-site/html-shell.js';
import { buildSitemapXml } from './sitemap-xml.js';
import { SITEMAP_PAGE_HTML } from './sitemap-page-html.generated.js';

const SITEMAP_R2_KEY = 'pages/sitemap/index.html';

/**
 * GET /sitemap — human-readable index (public, no redirects).
 * @param {import('@cloudflare/workers-types').Fetcher} assets
 */
export async function handleSitemapPage(assets) {
  let html = SITEMAP_PAGE_HTML;
  if (assets) {
    const obj = await assets.get(SITEMAP_R2_KEY);
    if (obj) html = await obj.text();
  }
  return servePublicHtmlWithShell(assets, html);
}

/** GET /sitemap.xml — crawler sitemap. */
export function handleSitemapXml() {
  return new Response(buildSitemapXml(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
