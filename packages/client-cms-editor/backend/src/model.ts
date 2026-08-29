import type { CmsEditorBlock, CmsEditorPage, CmsEditorSection, CmsEditorSelection, CmsEditorSite } from './types';

type Json = Record<string, any>;

export function parseCmsEditorObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

export function cmsEditorInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CMS';
}

function zoneFor(row: Json): CmsEditorSection['zone'] {
  const fields = parseCmsEditorObject(row.section_data ?? row.data ?? row.fields);
  const explicit = String(row.zone || fields.zone || '').toUpperCase();
  if (explicit === 'HEADER' || explicit === 'FOOTER' || explicit === 'TEMPLATE') return explicit;
  const type = String(row.section_type || row.type || '').toLowerCase();
  if (type.includes('nav') || type.includes('header')) return 'HEADER';
  if (type.includes('footer')) return 'FOOTER';
  return 'BODY';
}

export function mapCmsEditorBlock(row: Json, sectionId = ''): CmsEditorBlock {
  const data = parseCmsEditorObject(row.block_data ?? row.component_data ?? row.data);
  return {
    id: String(row.id || ''),
    sectionId: String(row.section_id || row.sectionId || sectionId || ''),
    type: String(row.block_type || row.component_type || row.type || 'block'),
    visible: row.is_visible === undefined ? row.visible !== false : Boolean(Number(row.is_visible)),
    data,
    sortOrder: Number(row.sort_order || 0),
  };
}

export function mapCmsEditorSection(row: Json, blocks: CmsEditorBlock[] = []): CmsEditorSection {
  const fields = parseCmsEditorObject(row.section_data ?? row.data ?? row.fields);
  return {
    id: String(row.id || ''),
    name: String(row.section_name || row.name || row.section_type || row.type || 'Section'),
    type: String(row.section_type || row.type || fields.section_type || 'section'),
    zone: zoneFor({ ...row, section_data: fields }),
    visible: row.is_visible === undefined ? row.visible !== false : Boolean(Number(row.is_visible)),
    color: String(fields.bg_color || fields.background_color || row.color || '#111115'),
    fields,
    css: parseCmsEditorObject(fields.css_override || row.css),
    blocks,
  };
}

export function mapCmsEditorPage(row: Json, sections: CmsEditorSection[] = []): CmsEditorPage {
  const route = String(row.route_path || row.slug || '/');
  return {
    id: String(row.id || ''),
    title: String(row.title || row.slug || 'Untitled'),
    slug: route.startsWith('/') ? route : `/${route}`,
    status: row.status === 'published' || row.is_published ? 'live' : row.status === 'new' ? 'new' : 'draft',
    type: String(row.page_type || row.type || (route === '/' ? 'Home' : 'Interior')),
    parent: row.parent_id || undefined,
    sections,
    metaTitle: String(row.seo_title || row.meta_title || row.title || ''),
    metaDescription: String(row.meta_description || ''),
  };
}

export function mapCmsEditorBootstrap(raw: Json, projectSlug: string) {
  const sectionsByPage = raw.sections_by_page || {};
  const blocksBySection = raw.blocks_by_section || raw.components_by_section || {};
  const pages = (raw.pages || []).map((page: Json) => {
    const sections = (sectionsByPage[page.id] || []).map((section: Json) => {
      const blocks = (blocksBySection[section.id] || []).map((row: Json) => mapCmsEditorBlock(row, section.id));
      return mapCmsEditorSection(section, blocks);
    });
    return mapCmsEditorPage(page, sections);
  });
  const tenant = raw.tenant || {};
  const name = String(tenant.name || raw.workspace_label || projectSlug || 'CMS Site');
  const themeVars = parseCmsEditorObject(raw.active_theme?.css_vars || raw.active_theme?.css_vars_json);
  const site: CmsEditorSite = {
    id: projectSlug,
    name,
    initials: cmsEditorInitials(name),
    domain: String(raw.public_domain || tenant.domain || ''),
    edited: 'Just now',
    color: String(themeVars['--brand-primary'] || tenant.primary_color || '#6358ff'),
    pages,
  };
  return {
    site,
    themeVars,
    templates: raw.component_templates || [],
    imports: raw.liquid_imports || [],
    homePageId: raw.home_page?.id || pages[0]?.id || null,
    schemas: {
      protocol_version: Number(raw.protocol_version || raw.schemas?.protocol_version || 1),
      sections: Array.isArray(raw.schemas?.sections) ? raw.schemas.sections : [],
      blocks: Array.isArray(raw.schemas?.blocks) ? raw.schemas.blocks : [],
      fields: Array.isArray(raw.schemas?.fields) ? raw.schemas.fields : [],
    },
  };
}

export function selectCmsEditorTarget(input: Partial<CmsEditorSelection> & { kind?: CmsEditorSelection['kind'] }): CmsEditorSelection {
  const sectionId = String(input.sectionId || '').trim() || null;
  const blockId = String(input.blockId || '').trim() || null;
  const pageId = String(input.pageId || '').trim() || null;
  return {
    kind: input.kind || (blockId ? 'block' : sectionId ? 'section' : 'page'),
    pageId,
    sectionId,
    blockId,
    fieldPath: String(input.fieldPath || '').trim() || null,
  };
}
