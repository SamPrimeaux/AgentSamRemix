import { assertCmsPreviewStore } from './contracts.js';
import { buildCmsPreviewModel } from './model.js';
import { resolveEffectiveCmsPreviewMode } from './mode.js';

export async function loadCmsPreviewByPageId(pageId, options, store) {
  assertCmsPreviewStore(store);
  const page = await store.getPageById(String(pageId));
  if (!page) return null;
  const sections = await store.listSections(String(pageId));
  const blocksBySection = typeof store.listBlocksForSections === 'function'
    ? await store.listBlocksForSections((sections || []).map((section) => section.id).filter(Boolean))
    : {};
  if (typeof store.listBlocksForSections !== 'function') {
    for (const section of sections || []) blocksBySection[section.id] = await store.listBlocks(section.id);
  }
  const effective = resolveEffectiveCmsPreviewMode(options || {});
  const draftData = effective === 'draft'
    ? (options?.draftData && typeof options.draftData === 'object'
        ? options.draftData
        : options?.userId ? await store.getDraft(String(pageId), String(options.userId)) : null)
    : null;
  return buildCmsPreviewModel({ page, sections, blocksBySection, draftData, previewMode: effective, cmsEmbed: options?.cmsEmbed, userId: options?.userId });
}

export async function loadCmsPreviewByRoute(routePath, options, store) {
  assertCmsPreviewStore(store);
  const effective = resolveEffectiveCmsPreviewMode(options || {});
  const page = await store.findPageByRoute(routePath, {
    explicitPageId: options?.pageId || null,
    includeDraft: effective === 'draft' || Boolean(options?.pageId),
  });
  if (!page) return null;
  return loadCmsPreviewByPageId(page.id, { ...options, previewMode: effective }, store);
}
