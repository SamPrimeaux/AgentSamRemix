export const CMS_PREVIEW_BRIDGE_TYPES = Object.freeze({
  READY: 'cms:ready',
  SELECT: 'cms:select',
  SECTION_CLICK: 'cms:section-click',
  HIGHLIGHT: 'cms:highlight',
  DESELECT: 'cms:deselect',
  SCROLL_TO: 'cms:scroll-to',
  SCROLL: 'cms:scroll',
  THEME_VARS: 'cms:theme-vars',
  STYLE: 'cms:style',
  MODE: 'cms:preview-mode',
  REFRESH: 'cms:refresh',
});

const LEGACY_TYPE_MAP = Object.freeze({
  'cms:section-click': CMS_PREVIEW_BRIDGE_TYPES.SECTION_CLICK,
  'cms:highlight': CMS_PREVIEW_BRIDGE_TYPES.HIGHLIGHT,
  'cms:deselect': CMS_PREVIEW_BRIDGE_TYPES.DESELECT,
  'cms:scroll-to': CMS_PREVIEW_BRIDGE_TYPES.SCROLL_TO,
  'cms:scroll': CMS_PREVIEW_BRIDGE_TYPES.SCROLL,
  'cms:theme-vars': CMS_PREVIEW_BRIDGE_TYPES.THEME_VARS,
  'cms:style': CMS_PREVIEW_BRIDGE_TYPES.STYLE,
  'cms:ready': CMS_PREVIEW_BRIDGE_TYPES.READY,
});

export function normalizeCmsPreviewBridgeMessage(input) {
  if (!input || typeof input !== 'object') return null;
  const rawType = String(input.type || '').trim();
  const type = LEGACY_TYPE_MAP[rawType] || rawType;
  if (!Object.values(CMS_PREVIEW_BRIDGE_TYPES).includes(type)) return null;
  const sectionId = String(input.section_id || input.sectionId || '').trim() || null;
  const blockId = String(input.block_id || input.blockId || input.component_id || '').trim() || null;
  const out = { type };
  if (sectionId) out.section_id = sectionId;
  if (blockId) out.block_id = blockId;
  if (input.path != null) out.path = String(input.path);
  if (input.vars && typeof input.vars === 'object') out.vars = input.vars;
  if (input.css && typeof input.css === 'object') out.css = input.css;
  if (input.mode != null) out.mode = String(input.mode);
  if (input.scrollY != null && Number.isFinite(Number(input.scrollY))) out.scroll_y = Number(input.scrollY);
  return out;
}

export function cmsPreviewBridgeTarget(message) {
  const normalized = normalizeCmsPreviewBridgeMessage(message);
  if (!normalized) return null;
  return {
    page_id: String(message.page_id || message.pageId || '').trim() || null,
    section_id: normalized.section_id || null,
    block_id: normalized.block_id || null,
  };
}
