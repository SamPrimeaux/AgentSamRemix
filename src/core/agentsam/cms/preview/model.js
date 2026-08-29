import { normalizeCmsBlockRow } from '../blocks/normalize.js';
import { normalizeCmsPageRow } from '../pages/normalize.js';
import { normalizeCmsSectionRow } from '../sections/normalize.js';
import { filterCmsPreviewVisibility, mergeCmsDraftSections } from './selection.js';
import { resolveEffectiveCmsPreviewMode } from './mode.js';

export function buildCmsPreviewModel({ page, sections = [], blocksBySection = {}, draftData = null, previewMode = null, cmsEmbed = false, userId = null } = {}) {
  const effectiveMode = resolveEffectiveCmsPreviewMode({ previewMode, cmsEmbed, userId });
  const normalizedSections = sections.map(normalizeCmsSectionRow).filter(Boolean);
  const merged = effectiveMode === 'draft' ? mergeCmsDraftSections(normalizedSections, draftData) : normalizedSections;
  const visible = filterCmsPreviewVisibility(merged, effectiveMode);
  const normalizedBlocks = {};
  for (const section of visible) {
    const rows = blocksBySection[section.id] || blocksBySection[String(section.id)] || [];
    normalizedBlocks[section.id] = rows.map(normalizeCmsBlockRow).filter(Boolean)
      .filter((b) => effectiveMode === 'draft' || b.visible === true)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }
  return {
    page: normalizeCmsPageRow(page),
    mode: effectiveMode,
    sections: visible.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    blocks_by_section: normalizedBlocks,
    draft_data: effectiveMode === 'draft' ? draftData || null : null,
  };
}

export function cmsPreviewModelToLegacy(model) {
  const sections = (model?.sections || []).map((s) => ({
    id: s.id,
    page_id: s.page_id,
    section_type: s.type,
    section_name: s.name,
    section_data: s.data,
    sort_order: s.sort_order,
    is_visible: s.visible ? 1 : 0,
    css_classes: s.css_classes || '',
    custom_css: s.custom_css || '',
  }));
  const componentsBySection = {};
  for (const [sectionId, blocks] of Object.entries(model?.blocks_by_section || {})) {
    componentsBySection[sectionId] = (blocks || []).map((b) => ({
      id: b.id,
      section_id: b.section_id,
      component_type: b.type,
      component_data: b.data,
      sort_order: b.sort_order,
      is_visible: b.visible ? 1 : 0,
    }));
  }
  return { page: model?.page || null, sections, componentsBySection, draftData: model?.draft_data || null, effectiveMode: model?.mode || 'published' };
}
