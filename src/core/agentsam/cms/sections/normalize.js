function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
export function normalizeCmsSectionRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    page_id: String(row.page_id || ''),
    type: String(row.section_type || row.type || 'custom'),
    name: String(row.section_name || row.name || row.section_type || 'Section'),
    data: parseJson(row.section_data ?? row.data, {}),
    sort_order: Number(row.sort_order || 0),
    visible: row.is_visible === true || row.is_visible === 1,
    css_classes: String(row.css_classes || ''),
    custom_css: String(row.custom_css || ''),
    updated_at: row.updated_at ?? null,
  };
}
export function sectionToLegacyRow(section) {
  if (!section) return null;
  return {
    id: section.id,
    page_id: section.page_id,
    section_type: section.type,
    section_name: section.name,
    section_data: section.data,
    sort_order: section.sort_order,
    is_visible: section.visible ? 1 : 0,
    css_classes: section.css_classes || '',
    custom_css: section.custom_css || '',
    updated_at: section.updated_at ?? null,
  };
}
export function normalizeCmsSectionInput(input = {}) {
  const pageId = String(input.page_id || '').trim();
  const type = String(input.type || input.section_type || '').trim();
  if (!pageId) return { ok: false, error: 'page_id_required' };
  if (!type) return { ok: false, error: 'section_type_required' };
  return { ok: true, section: {
    id: String(input.id || '').trim() || `sec_${crypto.randomUUID()}`,
    page_id: pageId,
    type,
    name: String(input.name || input.section_name || type).trim() || type,
    data: parseJson(input.data ?? input.section_data, {}),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 50,
    visible: input.visible === false || input.is_visible === 0 || input.is_visible === false ? false : true,
    css_classes: String(input.css_classes || ''),
    custom_css: String(input.custom_css || ''),
  }};
}
