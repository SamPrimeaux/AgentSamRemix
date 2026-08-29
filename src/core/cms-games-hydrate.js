/**
 * Server-side hydration for pages/games/index.html from cms_page_sections.
 * Five sections: interactive_systems hero + three feature_row blocks + London Dream Railway playable section.
 */
import { cmsSection, indexCmsSections } from './cms-public-page.js';

const CF_HASH = 'g7wf09fCONpnidkRnR_5vw';
const HERO_ID = '1b7ecfe9-550c-4ef7-966c-9e1972e29800';
const heroUrl = (variant) => `https://imagedelivery.net/${CF_HASH}/${HERO_ID}/${variant}`;

const DEFAULTS = {
  interactive_systems: {
    headline: 'Interactive systems',
    subheadline: 'MeauxGame engine preview.',
    overlay_title: '3D Multiplayer Chess',
    overlay_subtitle: 'Powered by WebSockets & Durable Objects',
    cta_label: 'Play Full Game',
    hero_image_desktop: heroUrl('hero'),
    hero_image_mobile: heroUrl('public'),
  },
  meauxchess_live: {
    theme: 'dark',
    layout: 'text_left',
    title: 'MeauxChess',
    body: 'Real-time 3D multiplayer with private rooms, Resend email invites, and live board sync on Cloudflare Durable Objects.',
    badge_label: 'Live multiplayer',
    badge_tone: 'teal',
    image_url: `https://imagedelivery.net/${CF_HASH}/17381bd3-ef22-4668-dd97-78fa7211b700/avatar`,
    image_alt: 'MeauxGame',
  },
  meauxgame_engine: {
    theme: 'light',
    layout: 'text_right',
    title: 'MeauxGame Engine',
    body: 'Premium glass-and-amber pieces, SparkChess-style legal-move illumination, and a locked cinematic camera — built for the browser.',
    badge_label: '3D interactive',
    badge_tone: 'blue',
    image_url: heroUrl('thumbnail'),
    image_alt: 'MeauxChess board preview',
  },
  agent_sam_practice: {
    theme: 'dark',
    layout: 'text_left',
    title: 'Agent Sam',
    body: 'Practice anytime on the full board. Agent Sam is your orange opponent — capture rails, timers, and a clean SparkChess-style HUD.',
    badge_label: 'AI practice',
    badge_tone: 'teal',
    image_url: `https://imagedelivery.net/${CF_HASH}/f8bfc7dd-7234-4336-1029-6f31a5bd7d00/avatar`,
    image_alt: 'Agent Sam',
  },
  london_dream_railway: {
    theme: 'dark',
    kicker: 'Flagship playable demo',
    title: 'London Dream Railway',
    body: 'A bright voxel train-table world where little red trains and Tube-inspired carriages weave through London landmarks.',
    card_title: 'London Dream Railway',
    card_body: 'Three.js toy-table city with rails, switches, camera tours, landmarks, tunnels, and smooth train loops.',
    footer_note: 'Playable flagship demo: city table, landmarks, train paths, branch switches, camera tours, instanced props, and optimized WebGL rendering.',
  },
};

/** @deprecated legacy hero key — still merged as fallback */
const LEGACY_HERO = {
  eyebrow: 'Inner Animal Media',
  headline: 'MeauxChess',
  subheadline: 'Real-time 3D multiplayer. Cloudflare-powered.',
  primary_cta_label: 'Play MeauxChess',
  badge_online: 'ONLINE & OFFLINE',
  hero_image_desktop: heroUrl('hero'),
  hero_image_mobile: heroUrl('public'),
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

function resolveHero(byKey, byType) {
  const interactive = cmsSection(byKey, byType, 'hero', 'interactive_systems', DEFAULTS.interactive_systems);
  const legacy = cmsSection(byKey, byType, 'hero', 'meauxchess_hero', LEGACY_HERO);
  return {
    headline: interactive.headline || legacy.headline || DEFAULTS.interactive_systems.headline,
    subheadline: interactive.subheadline || legacy.subheadline || DEFAULTS.interactive_systems.subheadline,
    overlay_title: interactive.overlay_title || DEFAULTS.interactive_systems.overlay_title,
    overlay_subtitle: interactive.overlay_subtitle || DEFAULTS.interactive_systems.overlay_subtitle,
    cta_label:
      interactive.cta_label ||
      interactive.primary_cta_label ||
      legacy.primary_cta_label ||
      DEFAULTS.interactive_systems.cta_label,
    hero_image_desktop:
      interactive.hero_image_desktop || legacy.hero_image_desktop || DEFAULTS.interactive_systems.hero_image_desktop,
    hero_image_mobile:
      interactive.hero_image_mobile ||
      legacy.hero_image_mobile ||
      interactive.hero_image_desktop ||
      DEFAULTS.interactive_systems.hero_image_mobile,
  };
}

function hydrateFeatureRow(html, prefix, data, defaults) {
  const row = { ...defaults, ...data };
  let out = html;
  out = replaceText(out, `${prefix}-title`, row.title);
  out = replaceText(out, `${prefix}-body`, row.body);
  out = replaceText(out, `${prefix}-badge`, row.badge_label);
  out = replaceAttr(out, `${prefix}-img`, 'src', row.image_url);
  out = replaceAttr(out, `${prefix}-img`, 'alt', row.image_alt || row.title);
  return out;
}

/**
 * @param {string} html
 * @param {Array<{section_type:string,section_name:string,section_data:object}>} sections
 */
export function hydrateGamesPageHtml(html, sections) {
  const { byType, byKey } = indexCmsSections(sections);
  const hero = resolveHero(byKey, byType);

  const live = cmsSection(byKey, byType, 'feature_row', 'meauxchess_live', DEFAULTS.meauxchess_live);
  const engine = cmsSection(byKey, byType, 'feature_row', 'meauxgame_engine', DEFAULTS.meauxgame_engine);
  const agent = cmsSection(byKey, byType, 'feature_row', 'agent_sam_practice', DEFAULTS.agent_sam_practice);
  const railway = cmsSection(byKey, byType, 'playable_game', 'london_dream_railway', DEFAULTS.london_dream_railway);

  let out = String(html);

  out = replaceText(out, 'cms-games-hero-headline', hero.headline);
  out = replaceText(out, 'cms-games-hero-subheadline', hero.subheadline);
  out = replaceText(out, 'cms-games-overlay-title', hero.overlay_title);
  out = replaceText(out, 'cms-games-overlay-subtitle', hero.overlay_subtitle);
  out = replaceText(out, 'cms-games-cta', hero.cta_label);

  out = replaceAttr(out, 'cms-games-hero-img', 'src', hero.hero_image_desktop);
  out = replaceAttr(out, 'cms-games-hero-mobile-src', 'srcset', hero.hero_image_mobile);
  out = replaceAttr(out, 'cms-games-hero-desktop-src', 'srcset', hero.hero_image_desktop);

  out = hydrateFeatureRow(out, 'cms-games-feat-live', live, DEFAULTS.meauxchess_live);
  out = hydrateFeatureRow(out, 'cms-games-feat-engine', engine, DEFAULTS.meauxgame_engine);
  out = hydrateFeatureRow(out, 'cms-games-feat-agent', agent, DEFAULTS.agent_sam_practice);

  out = replaceText(out, 'cms-games-railway-kicker', railway.kicker);
  out = replaceText(out, 'railway-title', railway.title);
  out = replaceText(out, 'cms-games-railway-body', railway.body);
  out = replaceText(out, 'cms-games-railway-card-title', railway.card_title || railway.title);
  out = replaceText(out, 'cms-games-railway-card-body', railway.card_body || railway.body);
  out = replaceText(out, 'cms-games-railway-footer', railway.footer_note);

  return out;
}

export { DEFAULTS as GAMES_CMS_DEFAULTS };
