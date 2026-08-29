/** Public URLs for search engines (no auth-gated dashboard paths). */
const PUBLIC_SITEMAP_ENTRIES = [
  { loc: 'https://inneranimalmedia.com/', priority: '1.0', changefreq: 'weekly' },
  { loc: 'https://inneranimalmedia.com/work', priority: '0.8', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/about', priority: '0.8', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/services', priority: '0.9', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/contact', priority: '0.8', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/pricing', priority: '0.8', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/games', priority: '0.6', changefreq: 'monthly' },
  { loc: 'https://inneranimalmedia.com/auth/login', priority: '0.5', changefreq: 'yearly' },
  { loc: 'https://inneranimalmedia.com/auth/signup', priority: '0.5', changefreq: 'yearly' },
  { loc: 'https://inneranimalmedia.com/auth/reset', priority: '0.4', changefreq: 'yearly' },
  { loc: 'https://inneranimalmedia.com/privacy', priority: '0.3', changefreq: 'yearly' },
  { loc: 'https://inneranimalmedia.com/terms', priority: '0.3', changefreq: 'yearly' },
  { loc: 'https://inneranimalmedia.com/sitemap', priority: '0.4', changefreq: 'monthly' },
];

const LASTMOD = '2026-05-28';

/**
 * @returns {string}
 */
export function buildSitemapXml() {
  const urls = PUBLIC_SITEMAP_ENTRIES.map(
    (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** @param {string} s */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
