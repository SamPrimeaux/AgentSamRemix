/**
 * Server-side hydration for pages/work/index.html from cms_page_sections.
 * Editorial portfolio grid (Clay-style desktop, deck scroll on mobile).
 */
import { cmsSection, indexCmsSections } from './cms-public-page.js';

const CF_HASH = 'g7wf09fCONpnidkRnR_5vw';
const GENERIC_IMG_RE = /1b7ecfe9-550c-4ef7-966c-9e1972e29800|17381bd3-ef22-4668-dd97-78fa7211b700|f8bfc7dd-7234-4336-1029-6f31a5bd7d00/;

const DEFAULT_CARDS = [
  {
    slug: 'companionscpas',
    title: 'Companions of CPAS',
    type_label: 'Client / nonprofit',
    group: 'client',
    layout: 'large',
    layout_offset: false,
    excerpt:
      'Rescue-focused website and CMS system for adoptable animals, foster needs, donations, and community updates.',
    tags: ['Website', 'CMS', 'Nonprofit', 'Donations', 'Animal profiles'],
    accent_color: '#2f7bff',
    detail_route: '/work/companionscpas',
  },
  {
    slug: 'fuelnfreetime',
    title: 'Fuel N Free Time',
    type_label: 'Client / commerce brand',
    group: 'client',
    layout: 'half',
    layout_offset: false,
    excerpt:
      'Lifestyle brand experience with product-forward pages, mobile-first polish, and brand storytelling.',
    tags: ['Website', 'E-commerce', 'Brand system', 'Mobile UX'],
    accent_color: '#ef4444',
    detail_route: '/work/fuelnfreetime',
  },
  {
    slug: 'meauxbility',
    title: 'Meauxbility',
    type_label: 'Nonprofit / owned initiative',
    group: 'owned',
    layout: 'half',
    layout_offset: true,
    excerpt:
      'Accessibility-focused nonprofit platform built around fundraising, athlete support, storytelling, and community impact.',
    tags: ['Nonprofit', 'Fundraising', 'Storytelling', 'CMS'],
    accent_color: '#25c878',
    detail_route: 'https://meauxbility.org',
  },
  {
    slug: 'inneranimalmedia',
    title: 'InnerAnimalMedia Platform',
    type_label: 'Internal product',
    group: 'owned',
    layout: 'large',
    layout_offset: false,
    excerpt:
      'AI-native dashboard for managing content, client systems, tools, files, automations, and production workflows.',
    tags: ['Product design', 'Dashboard', 'AI tools', 'Infrastructure'],
    accent_color: '#67e8ff',
    detail_route: '/work/inneranimalmedia',
  },
  {
    slug: 'designstudio',
    title: 'Design Studio',
    type_label: 'Internal product / lab',
    group: 'owned',
    layout: 'large',
    layout_offset: false,
    excerpt:
      'Mobile-first creative workspace for 3D assets, CAD generation, model editing, animation libraries, and agent-assisted production.',
    tags: ['3D', 'CAD', 'UI/UX', 'Agent workflows'],
    accent_color: '#8b5cf6',
    detail_route: '/work/designstudio',
  },
];

const DEFAULTS = {
  eyebrow: 'Portfolio',
  heading: 'Selected work',
  subheading: 'Real projects you can credibly show',
  cards: DEFAULT_CARDS,
};

const LEGACY_SLUGS = new Set(['workslayr', 'sitesnapps', 'trickcel', 'meauxchess', 'meauxcloud']);

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

function isGenericImage(url) {
  return !url || GENERIC_IMG_RE.test(String(url));
}

function layoutClasses(card) {
  const layout = card.layout === 'large' ? 'large' : 'half';
  const parts = [`work-card--${layout}`];
  if (card.layout_offset) parts.push('work-card--offset');
  return parts.join(' ');
}

function renderMedia(card, title) {
  const accent = escAttr(card.accent_color || '#2f7bff');
  const imageUrl = card.image_url || '';
  if (!isGenericImage(imageUrl)) {
    return `<div class="work-card__media"><img src="${escAttr(imageUrl)}" alt="${title}" loading="lazy"></div>`;
  }
  return `<div class="work-card__media work-card__media--gradient" style="--card-accent:${accent}"></div>`;
}

function renderCard(card) {
  const slug = escAttr(card.slug || '');
  const href = escAttr(card.detail_route || (slug ? `/work/${slug}` : '#'));
  const group = escAttr(card.group || 'owned');
  const title = escHtml(card.title || 'Project');
  const typeLabel = escHtml(card.type_label || card.category || '');
  const excerpt = escHtml(card.excerpt || '');
  const tags = Array.isArray(card.tags) ? card.tags : [];
  const external = /^https?:\/\//i.test(card.detail_route || '');

  const tagsHtml = tags.length
    ? `<div class="work-card__tags">${tags.map((t) => `<span class="work-card__tag">${escHtml(t)}</span>`).join('')}</div>`
    : '';

  const rel = external ? ' rel="noopener noreferrer"' : '';
  const target = external ? ' target="_blank"' : '';

  return `
    <a class="work-card ${layoutClasses(card)}" href="${href}" data-group="${group}"${rel}${target}>
      ${renderMedia(card, title)}
      <div class="work-card__body">
        ${typeLabel ? `<p class="work-card__type">${typeLabel}</p>` : ''}
        <h3 class="work-card__title">${title}</h3>
        ${excerpt ? `<p class="work-card__desc">${excerpt}</p>` : ''}
        ${tagsHtml}
      </div>
    </a>`;
}

/**
 * @param {string} html
 * @param {Array<{section_type:string,section_name:string,section_data:object}>} sections
 */
export function hydrateWorkPageHtml(html, sections) {
  const { byType, byKey } = indexCmsSections(sections);
  const gallery = cmsSection(byKey, byType, 'portfolio_gallery', 'work_portfolio', DEFAULTS);
  let cards = Array.isArray(gallery.cards) ? gallery.cards : DEFAULTS.cards;
  let eyebrow = gallery.eyebrow || DEFAULTS.eyebrow;
  let heading = gallery.heading || DEFAULTS.heading;
  let subheading = gallery.subheading || DEFAULTS.subheading;
  if (cards.some((c) => LEGACY_SLUGS.has(c.slug))) {
    cards = DEFAULT_CARDS;
    eyebrow = DEFAULTS.eyebrow;
    heading = DEFAULTS.heading;
    subheading = DEFAULTS.subheading;
  }

  let out = String(html);
  out = replaceText(out, 'cms-work-gallery-eyebrow', eyebrow);
  out = replaceText(out, 'cms-work-gallery-heading', heading);
  out = replaceText(out, 'cms-work-gallery-subheading', subheading);

  const gridHtml = cards.map(renderCard).join('\n');
  out = out.replace(
    /(<div class="work-grid" id="cms-work-gallery-grid"[^>]*>)[\s\S]*?(<\/div>)/,
    `$1\n${gridHtml}\n$2`,
  );

  return out;
}

export { DEFAULTS as WORK_CMS_DEFAULTS, DEFAULT_CARDS as WORK_PORTFOLIO_DEFAULT_CARDS };
