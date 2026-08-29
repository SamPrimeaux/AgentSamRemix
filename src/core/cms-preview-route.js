/**
 * Compatibility facade for canonical CMS preview behavior.
 * New preview business logic belongs in src/core/agentsam/cms/preview/.
 */
import {
  buildCmsPageUrls,
  cmsPreviewModelToLegacy,
  isPublicCmsPreviewRequest,
  loadCmsPreviewByRoute,
  parseCmsPreviewRequest,
} from './agentsam/cms/preview/index.js';
import { createCloudflareCmsPreviewStore } from './agentsam/cms/adapters/cloudflare/preview-store.js';

export { buildCmsPageUrls, isPublicCmsPreviewRequest };

export function parseCmsUrlPreviewMode(url) {
  return parseCmsPreviewRequest(url);
}

export async function resolveCmsPageByRoutePath(db, routePath, opts = {}) {
  if (!db) return { page: null, sections: [] };
  const store = createCloudflareCmsPreviewStore({ DB: db });
  const model = await loadCmsPreviewByRoute(routePath, {
    previewMode: opts.includeDraft ? 'draft' : 'published',
    userId: opts.includeDraft ? '__preview_route__' : null,
  }, store);
  if (!model) return { page: null, sections: [] };
  const legacy = cmsPreviewModelToLegacy(model);
  return { page: legacy.page, sections: legacy.sections };
}

export async function loadCmsSectionsForRoute(env, routePath, opts = {}) {
  if (!env?.DB) return { page: null, sections: [], effectiveMode: 'none' };
  const store = createCloudflareCmsPreviewStore(env);
  const model = await loadCmsPreviewByRoute(routePath, {
    previewMode: opts.previewMode || null,
    cmsEmbed: opts.cmsEmbed === true,
    userId: opts.userId || null,
    pageId: opts.pageId || null,
  }, store);
  if (!model) return { page: null, sections: [], effectiveMode: 'none' };
  return cmsPreviewModelToLegacy(model);
}
