/**
 * Theme Site Package — inventory manifest from extracted archive entries (no cms_pages).
 */
import { findThemeTemplateEntry, parseShopifyTemplateJson } from './template-plan.js';

function textFromBytes(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * @param {Array<{ path: string, content: Uint8Array }>} entries
 */
export function listThemeTemplateEntries(entries) {
  const templates = [];
  for (const e of entries || []) {
    const p = String(e.path || '').replace(/\\/g, '/');
    if (!/templates\/[^/]+\.json$/i.test(p)) continue;
    const name = p.split('/').pop()?.replace(/\.json$/i, '') || p;
    const plan = parseShopifyTemplateJson(textFromBytes(e.content));
    templates.push({
      name,
      path: p,
      section_order: plan?.order?.map((r) => r.instance_key) || [],
      section_types: plan?.order?.map((r) => r.section_type) || [],
    });
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Array<{ path: string }>} entries
 */
export function categorizeThemePaths(entries) {
  const counts = {
    sections: 0,
    templates: 0,
    snippets: 0,
    assets: 0,
    layout: 0,
    config: 0,
    locales: 0,
    other: 0,
  };
  const samples = {
    sections: [],
    templates: [],
    snippets: [],
    assets: [],
    layout: [],
    config: [],
    other: [],
  };

  for (const e of entries || []) {
    const p = String(e.path || '').replace(/\\/g, '/').toLowerCase();
    if (/^sections\//.test(p)) {
      counts.sections++;
      if (samples.sections.length < 12) samples.sections.push(e.path);
    } else if (/^templates\//.test(p)) {
      counts.templates++;
      if (samples.templates.length < 12) samples.templates.push(e.path);
    } else if (/^snippets\//.test(p)) {
      counts.snippets++;
      if (samples.snippets.length < 8) samples.snippets.push(e.path);
    } else if (/^assets\//.test(p)) {
      counts.assets++;
      if (samples.assets.length < 8) samples.assets.push(e.path);
    } else if (/^layout\//.test(p)) {
      counts.layout++;
      if (samples.layout.length < 6) samples.layout.push(e.path);
    } else if (/^config\//.test(p)) {
      counts.config++;
      if (samples.config.length < 6) samples.config.push(e.path);
    } else if (/^locales\//.test(p)) {
      counts.locales++;
    } else {
      counts.other++;
      if (samples.other.length < 8) samples.other.push(e.path);
    }
  }
  return { counts, samples };
}

/**
 * @param {{
 *   importId: string,
 *   stagingPrefix: string,
 *   archiveR2Key: string,
 *   entries: Array<{ path: string, content: Uint8Array }>,
 *   liquidSections: Array<{ section_key: string, path?: string }>,
 *   sectionRows?: Array<Record<string, unknown>>,
 * }} opts
 */
export function buildThemePackageManifest(opts) {
  const templates = listThemeTemplateEntries(opts.entries || []);
  const categories = categorizeThemePaths(opts.entries || []);
  const indexEntry = findThemeTemplateEntry(opts.entries || [], 'index');
  const indexPlan = indexEntry ? parseShopifyTemplateJson(textFromBytes(indexEntry.content)) : null;

  const defaultTemplate = templates.find((t) => t.name === 'index') || templates[0] || null;
  const defaultSectionKeys =
    indexPlan?.order?.map((r) => r.instance_key) ||
    defaultTemplate?.section_order ||
    (opts.liquidSections || []).map((s) => s.section_key);

  return {
    package_id: opts.importId,
    phase: 'inventory',
    staging_prefix: opts.stagingPrefix,
    archive_r2_key: opts.archiveR2Key,
    entries_total: (opts.entries || []).length,
    categories: categories.counts,
    path_samples: categories.samples,
    templates,
    default_template: defaultTemplate?.name || 'index',
    default_section_keys: defaultSectionKeys,
    sections: (opts.sectionRows || []).map((r) => ({
      id: r.id,
      section_key: r.section_key,
      path: r.path,
      r2_key: r.r2_key,
      file_name: r.file_name,
    })),
    liquid_section_keys: (opts.liquidSections || []).map((s) => s.section_key),
    proceed_hint:
      'POST /api/cms/site-packages/{id}/proceed with template, sections, db_target, r2_target, worker_target',
  };
}

/**
 * @param {unknown} raw
 */
export function parsePackageManifest(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}
