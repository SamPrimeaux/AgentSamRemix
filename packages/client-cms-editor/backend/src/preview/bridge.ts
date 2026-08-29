import { selectCmsEditorTarget } from '../model';
import type { CmsEditorSelection } from '../types';

export const CMS_EDITOR_PREVIEW_TYPES = {
  READY: 'cms:ready', SELECT: 'cms:select', SECTION_CLICK: 'cms:section-click', HIGHLIGHT: 'cms:highlight',
  DESELECT: 'cms:deselect', SCROLL_TO: 'cms:scroll-to', SCROLL: 'cms:scroll', THEME_VARS: 'cms:theme-vars',
  STYLE: 'cms:style', MODE: 'cms:preview-mode', REFRESH: 'cms:refresh',
  /** Live storefront embed (?cms=1) — sectionKey matches assembled data-section-key */
  SECTION_CLICKED: 'cms:section-clicked',
  SELECT_SECTION: 'cms:select-section',
  SECTIONS_READY: 'cms:sections-ready',
} as const;

export type CmsEditorPreviewMessage = {
  type: string;
  page_id?: string;
  section_id?: string;
  section_key?: string;
  block_id?: string;
  path?: string;
  vars?: Record<string, unknown>;
  css?: Record<string, unknown>;
  mode?: string;
  scroll_y?: number;
};

const VALID = new Set(Object.values(CMS_EDITOR_PREVIEW_TYPES));

export function normalizeCmsEditorPreviewMessage(input: unknown): CmsEditorPreviewMessage | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, any>;
  const type = String(row.type || '').trim();
  if (!VALID.has(type as any)) return null;
  const out: CmsEditorPreviewMessage = { type };
  const pageId = String(row.page_id || row.pageId || '').trim();
  const sectionId = String(row.section_id || row.sectionId || '').trim();
  const sectionKey = String(row.section_key || row.sectionKey || '').trim();
  const blockId = String(row.block_id || row.blockId || row.component_id || '').trim();
  if (pageId) out.page_id = pageId;
  if (sectionId) out.section_id = sectionId;
  if (sectionKey) out.section_key = sectionKey;
  if (blockId) out.block_id = blockId;
  if (row.path != null) out.path = String(row.path);
  if (row.vars && typeof row.vars === 'object') out.vars = row.vars;
  if (row.css && typeof row.css === 'object') out.css = row.css;
  if (row.mode != null) out.mode = String(row.mode);
  if (row.scroll_y != null || row.scrollY != null) {
    const n = Number(row.scroll_y ?? row.scrollY);
    if (Number.isFinite(n)) out.scroll_y = n;
  }
  return out;
}

export function cmsEditorSelectionFromPreview(input: unknown, currentPageId: string | null = null): CmsEditorSelection | null {
  const msg = normalizeCmsEditorPreviewMessage(input);
  if (!msg) return null;
  if (![
    CMS_EDITOR_PREVIEW_TYPES.SELECT,
    CMS_EDITOR_PREVIEW_TYPES.SECTION_CLICK,
    CMS_EDITOR_PREVIEW_TYPES.SECTION_CLICKED,
  ].includes(msg.type as any)) return null;
  return selectCmsEditorTarget({
    pageId: msg.page_id || currentPageId,
    sectionId: msg.section_id || msg.section_key,
    blockId: msg.block_id,
    fieldPath: msg.path,
  });
}

/** Tell the live storefront embed (?cms=1) which section key to outline. */
export function postCmsEditorLiveSelect(target: Window | null | undefined, sectionKey: string) {
  const key = String(sectionKey || '').trim();
  if (!target || !key) return;
  target.postMessage({ type: CMS_EDITOR_PREVIEW_TYPES.SELECT_SECTION, sectionKey: key }, '*');
}

export function postCmsEditorPreviewMessage(target: Window | null | undefined, message: CmsEditorPreviewMessage) {
  target?.postMessage(message, '*');
}
