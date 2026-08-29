/**
 * IAM assemble pipeline (CPAS-shaped): D1 sections → page HTML → R2 draft + published.
 * Pilot: /agentsam multi-section landing with page CSS/JS + story rail wrap.
 */

import { normalizeCmsRoutePath } from './cms-page-hydrate-dispatch.js';
import {
  IAM_STOREFRONT_BUCKET,
  resolveIamStorefrontAssetForPage,
  storefrontAssetDraftKey,
} from './iam-storefront-assets.js';
const PILOT_ROUTES = new Set(['/agentsam'].map((route) => normalizeCmsRoutePath(route)));

const STORY_SECTION_KEYS = new Set(['secure', 'scale', 'state', 'observe']);

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugSeg(value, fallback = 'section') {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

/**
 * @param {string|null|undefined} routePath
 */
export function isIamAssemblePilotRoute(routePath) {
  return PILOT_ROUTES.has(normalizeCmsRoutePath(routePath || ''));
}

/**
 * @param {Record<string, unknown>} page
 * @param {string} sectionKey
 */
export function iamSectionFragmentKey(page, sectionKey) {
  const asset = resolveIamStorefrontAssetForPage(page);
  const slug = asset
    ? String(asset.r2_key || '')
        .replace(/^pages\//, '')
        .replace(/\/index\.html$/, '')
    : slugSeg(page.slug || page.route_path, 'page');
  return `pages/${slug}/sections/${slugSeg(sectionKey)}.html`;
}

function parseSectionData(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {Record<string, unknown>} section
 */
export function renderIamPilotSectionHtml(section) {
  const key = slugSeg(section.section_name || section.section_key || section.id, 'section');
  const type = String(section.section_type || 'html_block').trim() || 'html_block';
  const data = parseSectionData(section.section_data);
  const role = String(data.role || '').trim();
  if (role === 'page_css' || type === 'page_css' || key === 'page_styles') return '';
  if (role === 'page_js' || type === 'page_js' || key === 'page_scripts') return '';
  if (role === 'story_chrome' || type === 'story_chrome') return '';

  const htmlFromData = String(data.html || data.body_html || data.content_html || '').trim();
  if (htmlFromData) {
    if (/^<section[\s>]/i.test(htmlFromData) || /^<aside[\s>]/i.test(htmlFromData)) {
      return htmlFromData;
    }
    return `<section data-section-key="${esc(key)}" data-cms-section="${esc(key)}" data-section-type="${esc(type)}">${htmlFromData}</section>`;
  }

  const headline = data.headline || data.heading || data.title || section.section_name || type;
  const body = data.body || data.paragraph || data.description || data.subheadline || '';
  return `<section class="iam-cms-section" data-section-key="${esc(key)}" data-cms-section="${esc(key)}" data-section-type="${esc(type)}">
  <div class="iam-cms-section-inner">
    ${headline ? `<h2>${esc(String(headline))}</h2>` : ''}
    ${body ? `<p>${esc(String(body))}</p>` : ''}
  </div>
</section>`;
}

/**
 * @param {Record<string, unknown>} page
 * @param {Array<Record<string, unknown>>} sections
 * @param {{ pageCss?: string, pageJs?: string, storyChrome?: string }} extras
 */
export function assembleIamPilotPageHtml(page, sections, extras = {}) {
  const title = esc(page.seo_title || page.title || 'Inner Animal Media');
  const description = esc(
    page.meta_description || `${page.title || 'Page'} — Inner Animal Media`,
  );
  const route = esc(normalizeCmsRoutePath(page.route_path || `/${page.slug || ''}`));
  const pageCss = String(extras.pageCss || '').trim();
  const pageJs = String(extras.pageJs || '').trim();
  const storyChrome = String(extras.storyChrome || '').trim();

  const visible = (sections || []).filter((s) => {
    const key = slugSeg(s.section_name || s.id, 'section');
    const data = parseSectionData(s.section_data);
    const role = String(data.role || '').trim();
    if (role === 'page_css' || role === 'page_js' || role === 'story_chrome') return false;
    if (key === 'page_styles' || key === 'page_scripts' || key === 'story_chrome') return false;
    return s.is_visible === 1 || s.is_visible === true || s.is_visible == null;
  });

  const before = [];
  const story = [];
  const after = [];
  for (const section of visible) {
    const key = slugSeg(section.section_name || section.id, 'section');
    const html = renderIamPilotSectionHtml(section);
    if (!html) continue;
    if (STORY_SECTION_KEYS.has(key)) story.push(html);
    else if (story.length === 0 && key !== 'cta') before.push(html);
    else after.push(html);
  }

  let body = before.join('\n');
  if (story.length || storyChrome) {
    body += `\n<div class="story">\n${storyChrome}\n${story.join('\n')}\n</div>\n`;
  }
  body += after.join('\n');

  const styleBlock = pageCss
    ? `<style id="agentsam-page-css">\n${pageCss}\n</style>`
    : `<style>
  :root { --ink:#f8fbff; --muted:#9daac2; --bg:#050713; --line:rgba(255,255,255,.12); --blue:#2f7bff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  main.agentsam-landing { padding-top: 76px; }
</style>`;

  const scriptBlock = pageJs ? `<script>\n${pageJs}\n</script>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${styleBlock}
</head>
<body data-footer-theme="dark" data-route="${route}">
<main id="top" class="iam-public-page agentsam-landing" data-route="${route}">
${body || '<!-- no visible sections -->'}
</main>
${scriptBlock}
</body>
</html>
`;
}

/**
 * Load sections and assemble pilot storefront HTML into R2 (draft + published).
 * @param {any} env
 * @param {{ page: Record<string, unknown>, r2Binding: any, preferDraft?: boolean, publish?: boolean }} opts
 */
export async function assembleAndPutIamPilotPage(env, opts) {
  const page = opts?.page || {};
  const route = normalizeCmsRoutePath(page.route_path || `/${page.slug || ''}`);
  if (!isIamAssemblePilotRoute(route)) {
    return { ok: false, skipped: true, reason: 'not_pilot_route' };
  }
  if (!env?.DB || !opts.r2Binding) {
    return { ok: false, error: 'missing_db_or_r2' };
  }

  const pageId = String(page.id || '').trim();
  const { results: sections = [] } = await env.DB.prepare(
    `SELECT id, section_name, section_type, section_data, sort_order, is_visible
       FROM cms_page_sections
      WHERE page_id = ?
      ORDER BY sort_order ASC, section_name ASC`,
  )
    .bind(pageId)
    .all()
    .catch(() => ({ results: [] }));

  let pageCss = '';
  let pageJs = '';
  let storyChrome = '';
  for (const section of sections || []) {
    const data = parseSectionData(section.section_data);
    const role = String(data.role || '').trim();
    const key = slugSeg(section.section_name || section.id, 'section');
    if (role === 'page_css' || key === 'page_styles' || section.section_type === 'page_css') {
      pageCss = String(data.css || data.html || '').trim();
    }
    if (role === 'page_js' || key === 'page_scripts' || section.section_type === 'page_js') {
      pageJs = String(data.js || data.html || '').trim();
    }
    if (role === 'story_chrome' || key === 'story_chrome' || section.section_type === 'story_chrome') {
      storyChrome = String(data.html || '').trim();
    }
  }

  const fragKeys = [];
  for (const section of sections || []) {
    const key = slugSeg(section.section_name || section.id, 'section');
    const data = parseSectionData(section.section_data);
    const role = String(data.role || '').trim();
    if (role === 'page_css' || role === 'page_js') continue;
    const html = role === 'story_chrome' ? String(data.html || '') : renderIamPilotSectionHtml(section);
    if (!html) continue;
    const fragKey = iamSectionFragmentKey(page, key);
    fragKeys.push(fragKey);
    await opts.r2Binding.put(fragKey, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }

  if (pageCss) {
    const cssKey = `pages/${slugSeg(page.slug || 'agentsam')}/page.css`;
    await opts.r2Binding.put(cssKey, pageCss, {
      httpMetadata: { contentType: 'text/css; charset=utf-8' },
    });
  }

  const fullHtml = assembleIamPilotPageHtml(page, sections || [], {
    pageCss,
    pageJs,
    storyChrome,
  });
  const asset = resolveIamStorefrontAssetForPage(page);
  const publishedKey = asset?.r2_key || `pages/${slugSeg(page.slug || route)}/index.html`;
  const draftKey = storefrontAssetDraftKey(publishedKey);

  // Always keep draft in sync so Theme Studio ?preview=draft&cms=1 can canvas-preview.
  await opts.r2Binding.put(draftKey, fullHtml, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const draftOnly = opts.draftOnly === true;
  if (!draftOnly) {
    await opts.r2Binding.put(publishedKey, fullHtml, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }

  return {
    ok: true,
    route,
    published_key: publishedKey,
    draft_key: draftKey,
    bucket: IAM_STOREFRONT_BUCKET,
    section_count: (sections || []).length,
    fragment_keys: fragKeys,
    bytes: fullHtml.length,
    draft_only: draftOnly,
  };
}
