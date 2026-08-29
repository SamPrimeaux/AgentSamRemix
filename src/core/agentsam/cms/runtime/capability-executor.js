/**
 * Capability executor — maps canonical CMS capability keys to domain services.
 * Used by agent plan execute() and by thin agentsam_cms_* tools.
 * Never batches create+publish+upload; caller sequences atomic ops.
 */
import {
  createCmsPage,
  getCmsPage,
  listCmsPages,
  updateCmsPage,
} from '../pages/index.js';
import {
  createCmsSection,
  getCmsSection,
  listCmsSections,
  updateCmsSection,
} from '../sections/index.js';
import {
  createCmsBlock,
  getCmsBlock,
  listCmsBlocks,
  updateCmsBlock,
} from '../blocks/index.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {{
 *   cmsScope: object,
 *   actor: object,
 *   pageStore: object,
 *   sectionStore: object,
 *   blockStore: object,
 * }} runtime
 */
export function createCmsCapabilityExecutor(runtime) {
  if (!runtime?.cmsScope || !runtime?.pageStore || !runtime?.sectionStore || !runtime?.blockStore) {
    throw new Error('cms_capability_runtime_required');
  }
  const { cmsScope, actor, pageStore, sectionStore, blockStore } = runtime;

  return Object.freeze({
    /**
     * @param {{ capability?: string, input?: Record<string, unknown> }|Record<string, unknown>} operation
     */
    async execute(operation) {
      const capability = trim(operation?.capability || operation?.op || operation?.type);
      const input = operation?.input && typeof operation.input === 'object' ? operation.input : operation || {};
      if (!capability) throw new Error('cms_capability_required');

      switch (capability) {
        case 'page.list':
          return listCmsPages(cmsScope, { projectSlug: input.project_slug || input.projectSlug || null }, pageStore);
        case 'page.read': {
          const pageId = trim(input.page_id || input.pageId || input.id);
          if (!pageId) return { ok: false, error: 'page_id_required' };
          return getCmsPage(cmsScope, pageId, pageStore, input.project_slug || input.projectSlug || null);
        }
        case 'page.create':
          return createCmsPage(cmsScope, input, actor, pageStore);
        case 'page.update': {
          const pageId = trim(input.page_id || input.pageId || input.id);
          if (!pageId) return { ok: false, error: 'page_id_required' };
          return updateCmsPage(cmsScope, pageId, input, actor, pageStore);
        }
        case 'section.list': {
          const pageId = trim(input.page_id || input.pageId);
          if (!pageId) return { ok: false, error: 'page_id_required' };
          return listCmsSections(cmsScope, pageId, pageStore, sectionStore);
        }
        case 'section.read': {
          const sectionId = trim(input.section_id || input.sectionId || input.id);
          if (!sectionId) return { ok: false, error: 'section_id_required' };
          return getCmsSection(cmsScope, sectionId, pageStore, sectionStore);
        }
        case 'section.create':
          return createCmsSection(cmsScope, input, pageStore, sectionStore);
        case 'section.update': {
          const sectionId = trim(input.section_id || input.sectionId || input.id);
          if (!sectionId) return { ok: false, error: 'section_id_required' };
          return updateCmsSection(cmsScope, sectionId, input, pageStore, sectionStore);
        }
        case 'block.list': {
          const sectionId = trim(input.section_id || input.sectionId);
          if (!sectionId) return { ok: false, error: 'section_id_required' };
          return listCmsBlocks(cmsScope, sectionId, pageStore, sectionStore, blockStore);
        }
        case 'block.read': {
          const blockId = trim(input.block_id || input.blockId || input.component_id || input.id);
          if (!blockId) return { ok: false, error: 'block_id_required' };
          return getCmsBlock(cmsScope, blockId, pageStore, sectionStore, blockStore);
        }
        case 'block.create':
          return createCmsBlock(cmsScope, input, pageStore, sectionStore, blockStore);
        case 'block.update': {
          const blockId = trim(input.block_id || input.blockId || input.component_id || input.id);
          if (!blockId) return { ok: false, error: 'block_id_required' };
          return updateCmsBlock(cmsScope, blockId, input, pageStore, sectionStore, blockStore);
        }
        default:
          return { ok: false, error: `cms_capability_unsupported:${capability}` };
      }
    },
  });
}
