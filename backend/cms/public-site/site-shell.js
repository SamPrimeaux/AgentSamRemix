/**
 * Project-level marketing chrome (iam-header / iam-footer) stored in R2 ASSETS.
 * Draft keys live beside published keys — no hardcoded routes in presets.
 * Nav link lists are patched at inject time (iam-site-nav) — CPAS-shaped dynamics.
 */
import {
  loadIamNavVisibility,
  patchIamFooterNavHtml,
  patchIamHeaderNavHtml,
} from './site-nav.js';

/** @typedef {{ id: string, label: string, published_key: string, slot: 'prepend' | 'append' }} SiteShellPartDef */

/** @type {SiteShellPartDef[]} */
export const IAM_SITE_SHELL_PARTS = [
  {
    id: 'header',
    label: 'Site header',
    published_key: 'components/iam-header.html',
    slot: 'prepend',
  },
  {
    id: 'footer',
    label: 'Site footer',
    published_key: 'components/iam-footer.html',
    slot: 'append',
  },
];

/** @param {string} publishedKey */
export function siteShellDraftKey(publishedKey) {
  const key = String(publishedKey || '').trim();
  if (!key.startsWith('components/')) return `components/.draft/${key.split('/').pop()}`;
  return key.replace(/^components\//, 'components/.draft/');
}

/**
 * @param {string} projectSlug
 * @returns {{ bucket: string, parts: SiteShellPartDef[] } | null}
 */
export function siteShellConfigForProject(projectSlug) {
  const slug = String(projectSlug || '').trim().toLowerCase();
  if (slug === 'inneranimalmedia' || slug === 'iam') {
    return { bucket: 'inneranimalmedia', parts: IAM_SITE_SHELL_PARTS };
  }
  return null;
}

function partDef(cfg, partId) {
  return cfg.parts.find((p) => p.id === String(partId || '').trim()) || null;
}

/**
 * @param {any} env
 * @param {{ bucket: string, parts: SiteShellPartDef[] }} cfg
 */
function shellBinding(env, cfg) {
  const bucket = String(cfg?.bucket || '').trim().toLowerCase();
  if (bucket === 'inneranimalmedia' || bucket === 'dashboard') return env?.ASSETS || env?.R2;
  if (bucket === 'cms') return env?.CMS_BUCKET || env?.ASSETS || env?.R2;
  return env?.CMS_BUCKET || env?.ASSETS || env?.R2;
}

/**
 * @param {any} env
 * @param {string} projectSlug
 */
export async function listSiteShellPartsMeta(env, projectSlug) {
  const cfg = siteShellConfigForProject(projectSlug);
  if (!cfg) return { enabled: false, bucket: null, parts: [] };

  const binding = shellBinding(env, cfg);
  const parts = await Promise.all(
    cfg.parts.map(async (def) => {
      const draftKey = siteShellDraftKey(def.published_key);
      const [publishedObj, draftObj] = await Promise.all([
        binding.get(def.published_key).catch(() => null),
        binding.get(draftKey).catch(() => null),
      ]);
      return {
        id: def.id,
        label: def.label,
        slot: def.slot,
        published_key: def.published_key,
        draft_key: draftKey,
        has_published: !!publishedObj,
        has_draft: !!draftObj,
        published_bytes: publishedObj?.size || 0,
        draft_bytes: draftObj?.size || 0,
      };
    }),
  );

  return { enabled: true, bucket: cfg.bucket, parts };
}

/**
 * @param {any} env
 * @param {string} projectSlug
 * @param {string} partId
 * @param {{ draft?: boolean }} [opts]
 */
export async function readSiteShellPart(env, projectSlug, partId, opts = {}) {
  const cfg = siteShellConfigForProject(projectSlug);
  if (!cfg) return null;
  const def = partDef(cfg, partId);
  if (!def) return null;

  const binding = shellBinding(env, cfg);
  const publishedKey = def.published_key;
  const draftKey = siteShellDraftKey(publishedKey);
  const preferDraft = opts.draft === true;

  let activeKey = preferDraft ? draftKey : publishedKey;
  let obj = await binding.get(activeKey).catch(() => null);
  if (preferDraft && !obj) {
    obj = await binding.get(publishedKey).catch(() => null);
    activeKey = publishedKey;
  }

  const draftObj = await binding.get(draftKey).catch(() => null);
  const html = obj ? await obj.text() : '';

  return {
    id: def.id,
    label: def.label,
    slot: def.slot,
    bucket: cfg.bucket,
    published_key: publishedKey,
    draft_key: draftKey,
    r2_key: activeKey,
    html,
    has_draft: !!draftObj,
    has_published: !!(await binding.get(publishedKey).catch(() => null)),
    draft: preferDraft,
  };
}

/**
 * @param {any} env
 * @param {string} projectSlug
 * @param {string} partId
 * @param {string} html
 */
export async function writeSiteShellDraft(env, projectSlug, partId, html) {
  const cfg = siteShellConfigForProject(projectSlug);
  if (!cfg) throw new Error('site_shell_not_configured');
  const def = partDef(cfg, partId);
  if (!def) throw new Error('site_shell_part_not_found');

  const binding = shellBinding(env, cfg);
  const draftKey = siteShellDraftKey(def.published_key);
  const body = new TextEncoder().encode(String(html || ''));
  await binding.put(draftKey, body, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  return readSiteShellPart(env, projectSlug, partId, { draft: true });
}

/**
 * @param {any} env
 * @param {string} projectSlug
 * @param {string} partId
 */
export async function publishSiteShellPart(env, projectSlug, partId) {
  const cfg = siteShellConfigForProject(projectSlug);
  if (!cfg) throw new Error('site_shell_not_configured');
  const def = partDef(cfg, partId);
  if (!def) throw new Error('site_shell_part_not_found');

  const binding = shellBinding(env, cfg);
  const publishedKey = def.published_key;
  const draftKey = siteShellDraftKey(publishedKey);
  const draftObj = await binding.get(draftKey).catch(() => null);
  if (!draftObj) throw new Error('no_shell_draft');

  const body = await draftObj.arrayBuffer();
  await binding.put(publishedKey, body, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  return readSiteShellPart(env, projectSlug, partId, { draft: false });
}

/**
 * Load header/footer HTML for Worker HTMLRewriter injection.
 * @param {any} env
 * @param {{ previewMode?: 'draft' | 'published' | null }} [opts]
 */
export async function loadSiteShellInjectionHtml(env, opts = {}) {
  const preferDraft = opts.previewMode === 'draft';
  const cfg = siteShellConfigForProject('inneranimalmedia');
  if (!cfg || !env) return { headerHtml: '', footerHtml: '' };

  const binding = shellBinding(env, cfg);
  const headerDef = partDef(cfg, 'header');
  const footerDef = partDef(cfg, 'footer');

  async function loadPart(def) {
    if (!def) return '';
    const publishedKey = def.published_key;
    const draftKey = siteShellDraftKey(publishedKey);
    let key = preferDraft ? draftKey : publishedKey;
    let obj = await binding.get(key).catch(() => null);
    if (preferDraft && !obj) {
      obj = await binding.get(publishedKey).catch(() => null);
    }
    return obj ? await obj.text() : '';
  }

  const [rawHeader, rawFooter, visibilityMap] = await Promise.all([
    loadPart(headerDef),
    loadPart(footerDef),
    loadIamNavVisibility(env),
  ]);

  // Prefer R2 chrome template + dynamic nav/footer; empty R2 yields empty inject.
  const headerHtml = patchIamHeaderNavHtml(rawHeader, visibilityMap);
  const footerHtml = patchIamFooterNavHtml(rawFooter, visibilityMap);

  return { headerHtml, footerHtml, nav_dynamic: true };
}

export const publicSiteShellService = Object.freeze({
  listSiteShellPartsMeta,
  readSiteShellPart,
  writeSiteShellDraft,
  publishSiteShellPart,
  loadSiteShellInjectionHtml,
});
