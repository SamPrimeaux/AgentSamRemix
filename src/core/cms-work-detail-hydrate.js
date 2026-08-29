/**
 * Server-side hydration for pages/work/detail.html from cms_page_sections.
 * Case study detail pages at /work/{slug}.
 */
import { cmsSection, indexCmsSections } from './cms-public-page.js';

const CF_HASH = 'g7wf09fCONpnidkRnR_5vw';
const PLACEHOLDER_IMG = `https://imagedelivery.net/${CF_HASH}/1b7ecfe9-550c-4ef7-966c-9e1972e29800/hero`;

const DEFAULTS = {
  hero: {
    breadcrumb: 'Portfolio Details',
    title: 'Project',
    title_accent: '',
    feature_image_url: PLACEHOLDER_IMG,
    feature_image_alt: 'Project preview',
  },
  overview: {
    label: 'Our Expertise',
    headline: 'Built for clarity and scale',
    intro: 'A focused digital experience designed to communicate value from the first screen.',
    body: '',
  },
  gallery_images: { images: [] },
  whats_included: {
    heading: "What's Included",
    items: [],
  },
  services_provided: {
    heading: 'Services Provided',
    items: [],
  },
  why_choose: {
    heading: 'Why Choose Inner Animal Media',
    body: 'We combine strategic clarity with production-grade execution — systems that last beyond the launch moment.',
  },
  cta: {
    heading: 'Ready to build',
    heading_accent: 'something lasting?',
    body: 'Tell us about your project and we will map the clearest path from idea to launch.',
    cta_label: 'Start a project',
    cta_href: '/contact',
  },
};

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(value) {
  return escHtml(value).replace(/'/g, '&#39;');
}

function replaceText(html, id, value) {
  const safe = escHtml(value);
  const re = new RegExp(`(<[^>]+id="${id}"[^>]*>)([\\s\\S]*?)(</)`, 'i');
  if (re.test(html)) return html.replace(re, `$1${safe}$3`);
  return html;
}

function replaceAttr(html, id, attr, value) {
  const safe = escAttr(value);
  const re = new RegExp(`(<[^>]+id="${id}"[^>]*\\s${attr}=")[^"]*"`, 'i');
  if (re.test(html)) return html.replace(re, `$1${safe}"`);
  return html.replace(new RegExp(`(<[^>]+id="${id}")`, 'i'), `$1 ${attr}="${safe}"`);
}

function renderTitle(title, accent) {
  const main = escHtml(title || DEFAULTS.hero.title);
  if (!accent) return main;
  return `${main} <em class="accent">${escHtml(accent)}</em>`;
}

function renderGalleryImages(images) {
  if (!Array.isArray(images) || !images.length) return '';
  return images
    .map(
      (img) =>
        `<figure class="detail-gallery-item"><img src="${escAttr(img.url || img.image_url || '')}" alt="${escAttr(img.alt || '')}" loading="lazy"></figure>`,
    )
    .join('\n');
}

function renderChecklist(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((item) => {
      const text = typeof item === 'string' ? item : item.text || item.label || '';
      return `<li class="detail-check-item"><span class="detail-check-icon">✓</span>${escHtml(text)}</li>`;
    })
    .join('\n');
}

function renderServices(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map(
      (item) => `
      <div class="detail-service-item">
        <h4>${escHtml(item.title || item.name || '')}</h4>
        <p>${escHtml(item.description || item.body || '')}</p>
      </div>`,
    )
    .join('\n');
}

/**
 * @param {string} html
 * @param {Array<{section_type:string,section_name:string,section_data:object}>} sections
 */
export function hydrateWorkDetailPageHtml(html, sections) {
  const { byType, byKey } = indexCmsSections(sections);
  const hero = cmsSection(byKey, byType, 'hero', 'case_study_hero', DEFAULTS.hero);
  const overview = cmsSection(byKey, byType, 'overview', 'case_study_overview', DEFAULTS.overview);
  const gallery = cmsSection(byKey, byType, 'gallery_images', 'case_study_gallery', DEFAULTS.gallery_images);
  const included = cmsSection(byKey, byType, 'whats_included', 'case_study_included', DEFAULTS.whats_included);
  const services = cmsSection(byKey, byType, 'services_provided', 'case_study_services', DEFAULTS.services_provided);
  const why = cmsSection(byKey, byType, 'why_choose', 'case_study_why', DEFAULTS.why_choose);
  const cta = cmsSection(byKey, byType, 'cta', 'case_study_cta', DEFAULTS.cta);

  let out = String(html);

  out = replaceText(out, 'cms-detail-breadcrumb', hero.breadcrumb || DEFAULTS.hero.breadcrumb);
  out = out.replace(
    /(<h1 id="cms-detail-title"[^>]*>)[\s\S]*?(<\/h1>)/i,
    `$1${renderTitle(hero.title, hero.title_accent)}$2`,
  );
  out = replaceAttr(out, 'cms-detail-hero-img', 'src', hero.feature_image_url || DEFAULTS.hero.feature_image_url);
  out = replaceAttr(out, 'cms-detail-hero-img', 'alt', hero.feature_image_alt || hero.title || DEFAULTS.hero.feature_image_alt);

  out = replaceText(out, 'cms-detail-overview-label', overview.label || DEFAULTS.overview.label);
  out = replaceText(out, 'cms-detail-overview-headline', overview.headline || DEFAULTS.overview.headline);
  out = replaceText(out, 'cms-detail-overview-intro', overview.intro || DEFAULTS.overview.intro);
  out = replaceText(out, 'cms-detail-overview-body', overview.body || DEFAULTS.overview.body);

  out = replaceText(out, 'cms-detail-included-heading', included.heading || DEFAULTS.whats_included.heading);
  out = replaceText(out, 'cms-detail-services-heading', services.heading || DEFAULTS.services_provided.heading);
  out = replaceText(out, 'cms-detail-why-heading', why.heading || DEFAULTS.why_choose.heading);
  out = replaceText(out, 'cms-detail-why-body', why.body || DEFAULTS.why_choose.body);

  out = out.replace(
    /(<h2 id="cms-detail-cta-heading"[^>]*>)[\s\S]*?(<\/h2>)/i,
    `$1${escHtml(cta.heading || DEFAULTS.cta.heading)} <em class="accent">${escHtml(cta.heading_accent || DEFAULTS.cta.heading_accent)}</em>$2`,
  );
  out = replaceText(out, 'cms-detail-cta-body', cta.body || DEFAULTS.cta.body);
  out = replaceText(out, 'cms-detail-cta-label', cta.cta_label || DEFAULTS.cta.cta_label);
  out = out.replace(
    /id="cms-detail-cta-link"([^>]*)href="[^"]*"/,
    `id="cms-detail-cta-link"$1href="${escAttr(cta.cta_href || DEFAULTS.cta.cta_href)}"`,
  );

  const galleryHtml = renderGalleryImages(gallery.images);
  if (galleryHtml) {
    out = out.replace(
      /(<div class="detail-gallery-grid" id="cms-detail-gallery">)[\s\S]*?(<\/div>)/,
      `$1\n${galleryHtml}\n$2`,
    );
  }

  const checklistHtml = renderChecklist(included.items);
  if (checklistHtml) {
    out = out.replace(
      /(<ul class="detail-checklist" id="cms-detail-included-list">)[\s\S]*?(<\/ul>)/,
      `$1\n${checklistHtml}\n$2`,
    );
  }

  const servicesHtml = renderServices(services.items);
  if (servicesHtml) {
    out = out.replace(
      /(<div class="detail-services-list" id="cms-detail-services-list">)[\s\S]*?(<\/div>)/,
      `$1\n${servicesHtml}\n$2`,
    );
  }

  return out;
}

export { DEFAULTS as WORK_DETAIL_CMS_DEFAULTS };
