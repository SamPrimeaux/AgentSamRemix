import { normalizeCmsRoute } from '../routing/normalize-route.js';

/** IAM assemble-pilot route that still uses the whole-page assembler. */
export const CMS_LEGACY_WHOLE_PAGE_ASSEMBLER_ROUTE = '/agentsam';

/**
 * @param {string|null|undefined} routePath
 */
export function isCmsLegacyWholePageAssemblerRoute(routePath) {
  return normalizeCmsRoute(routePath || '') === CMS_LEGACY_WHOLE_PAGE_ASSEMBLER_ROUTE;
}
