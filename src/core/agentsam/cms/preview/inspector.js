export function normalizeCmsInspectorTarget(input = {}) {
  const sectionId = String(input.section_id || input.sectionId || '').trim() || null;
  const blockId = String(input.block_id || input.blockId || input.component_id || '').trim() || null;
  const fieldPath = String(input.field_path || input.fieldPath || '').trim() || null;
  return {
    kind: blockId ? 'block' : sectionId ? 'section' : 'page',
    page_id: String(input.page_id || input.pageId || '').trim() || null,
    section_id: sectionId,
    block_id: blockId,
    field_path: fieldPath,
  };
}
