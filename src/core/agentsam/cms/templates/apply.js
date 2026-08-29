/**
 * Apply a cms_component_templates row onto a page (section) or as a marketing page.
 * Portable policy lives here; R2/HTML instantiate stays in the HTTP route adapter path.
 */

import { getCmsSection } from '../registry/index.js';
import { createCmsSection } from '../sections/index.js';
import { getCmsTemplate } from './service.js';

function parseTemplateData(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Map catalog template_type / category onto a portable section type. */
export function resolveCmsTemplateSectionType(template) {
  const type = String(template?.template_type || '').trim().toLowerCase();
  const category = String(template?.category || '').trim().toLowerCase();
  const name = String(template?.template_name || '').trim().toLowerCase();
  if (type === 'hero' || category === 'hero' || name.includes('hero')) return 'hero';
  if (type === 'cta' || category === 'cta' || name.includes('cta')) return 'cta';
  if (type === 'services_grid' || name.includes('services')) return 'services-grid';
  if (type === 'features' || category === 'features' || name.includes('feature')) return 'features';
  if (type === 'image' || category === 'image' || name.includes('image') || name.includes('gallery')) return 'image';
  if (type === 'rich-text' || category === 'text' || name.includes('text') || name.includes('rich')) return 'rich-text';
  if (type && type !== 'section' && type !== 'ui-component') return type.replace(/_/g, '-');
  if (category) return category.replace(/_/g, '-');
  return 'rich-text';
}

export function resolveCmsTemplateSectionData(template, sectionType) {
  const raw = parseTemplateData(template?.template_data);
  const schema = getCmsSection(sectionType, 1);
  const registryDefaults = schema?.defaults && typeof schema.defaults === 'object'
    ? { ...schema.defaults }
    : {};

  // Stub shape from early catalog seeds: { fields: [], defaults: {} }
  if (Array.isArray(raw.fields) || (raw.defaults && typeof raw.defaults === 'object')) {
    return {
      ...registryDefaults,
      ...(raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}),
      _template_id: String(template.id || ''),
      _template_name: String(template.template_name || ''),
    };
  }

  // Prefer flattening known nested keys into section_data used by the editor.
  const out = { ...registryDefaults, ...raw };
  if (out.heading && !out.title) out.title = out.heading;
  if (out.subheading && !out.body) out.body = out.subheading;
  if (out.section_heading && !out.heading) out.heading = out.section_heading;
  if (out.section_description && !out.intro) out.intro = out.section_description;
  if (out.button_text || out.cta_text) {
    out.primaryCta = {
      label: String(out.button_text || out.cta_text || 'Learn more'),
      href: String(out.button_link || out.cta_link || '#'),
    };
  }
  out._template_id = String(template.id || '');
  out._template_name = String(template.template_name || '');
  return out;
}

export function cmsTemplateNeedsHtmlInstantiate(template) {
  const key = String(template?.source_html_r2_key || '').trim();
  if (!key) return false;
  const type = String(template?.template_type || '').trim().toLowerCase();
  return (
    type.includes('page')
    || type === 'marketing_page'
    || type === 'loading_screen'
    || type === 'motion_system'
    || type === 'spline_scene'
  );
}

/**
 * Apply a section-shaped template onto an existing page.
 * @returns {{ ok: true, mode: 'section', section: object, page: object } | { ok: false, error: string, status?: number, mode?: string, template?: object }}
 */
export async function applyCmsTemplateToPage(store, {
  templateId,
  pageId,
  scope,
  pageStore,
  sectionStore,
  sortOrder = null,
} = {}) {
  const lookup = await getCmsTemplate(store, templateId);
  if (!lookup.ok) return lookup;
  const template = lookup.template;

  if (cmsTemplateNeedsHtmlInstantiate(template)) {
    return { ok: false, error: 'use_instantiate', status: 409, mode: 'instantiate', template };
  }

  const targetPageId = String(pageId || '').trim();
  if (!targetPageId) return { ok: false, error: 'page_id_required', status: 400 };

  const sectionType = resolveCmsTemplateSectionType(template);
  const data = resolveCmsTemplateSectionData(template, sectionType);
  const created = await createCmsSection(scope, {
    page_id: targetPageId,
    section_type: sectionType,
    section_name: String(template.template_name || sectionType).trim() || sectionType,
    section_data: data,
    sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 50,
  }, pageStore, sectionStore);

  if (!created.ok) return created;
  return {
    ok: true,
    mode: 'section',
    template_id: String(template.id),
    section: created.section,
    page: created.page,
  };
}
