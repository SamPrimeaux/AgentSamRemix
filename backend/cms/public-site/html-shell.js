import { loadSiteShellInjectionHtml } from './site-shell.js';

/**
 * Serve marketing HTML with shared iam-header / iam-footer injection (R2 ASSETS).
 */

/**
 * @param {import('@cloudflare/workers-types').Fetcher} [assets]
 * @param {string} html
 * @param {{ skipShellInject?: boolean, cacheControl?: string, previewMode?: 'draft' | 'published' | null, env?: any }} [opts]
 */
export async function servePublicHtmlWithShell(assets, html, opts = {}) {
  const skipShellInject = Boolean(opts.skipShellInject);
  const cacheControl = opts.cacheControl || 'public, max-age=300';

  let headerHtml = '';
  let footerHtml = '';
  if (!skipShellInject && (opts.env || assets)) {
    if (opts.env) {
      const shell = await loadSiteShellInjectionHtml(opts.env, {
        previewMode: opts.previewMode,
      });
      headerHtml = shell.headerHtml;
      footerHtml = shell.footerHtml;
    } else if (assets) {
      const [headerObj, footerObj] = await Promise.all([
        assets.get('components/iam-header.html'),
        assets.get('components/iam-footer.html'),
      ]);
      headerHtml = headerObj ? await headerObj.text() : '';
      footerHtml = footerObj ? await footerObj.text() : '';
    }
  }

  const base = new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl },
  });

  if (skipShellInject || (!headerHtml && !footerHtml)) {
    return base;
  }

  return new HTMLRewriter()
    .on('body', {
      element(el) {
        if (headerHtml) el.prepend(headerHtml, { html: true });
        if (footerHtml) el.append(footerHtml, { html: true });
      },
    })
    .transform(base);
}
