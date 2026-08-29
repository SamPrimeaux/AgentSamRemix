/**
 * API-layer bind: injects IAM storefront/draft adapters into canonical CMS host context.
 * Kept out of src/core so platform code does not import the CMS product package.
 */
import { cmsPageHtmlKey } from '../core/cms-edit-safety.js';
import { syncCmsDraftPageArtifact } from '../core/cms-host-draft-artifact.js';
import {
  assembleCmsHostPageArtifact,
  enrichCmsHostPages,
  listCmsHostStorefrontCatalog,
  readCmsHostPageArtifact,
  resolveCmsHostPageArtifact,
  usesCmsHostLegacyAssembler,
} from '../core/cms-host-page-artifact.js';
import { buildCmsHostContext } from '../core/agentsam/cms/host/build-host-context.js';

/**
 * @param {{
 *   env: Record<string, unknown>,
 *   workspaceId: string,
 *   siteConfig?: Record<string, unknown>|null,
 * }} input
 */
export function bindCmsHostPlatformContext(input) {
  const env = input?.env;
  const workspaceId = String(input?.workspaceId || '').trim();
  const siteConfig = input?.siteConfig || null;

  return buildCmsHostContext({
    env,
    workspaceId,
    siteConfig,
    adapters: {
      resolvePageArtifact(page) {
        return resolveCmsHostPageArtifact(page, workspaceId, cmsPageHtmlKey);
      },
      readPageArtifact(binding, hostArtifact, variant) {
        return readCmsHostPageArtifact(binding, hostArtifact, variant);
      },
      syncDraftPageArtifact(draftInput) {
        return syncCmsDraftPageArtifact(env, {
          siteConfig,
          ...draftInput,
        });
      },
      usesLegacyWholePageAssembler(page) {
        return usesCmsHostLegacyAssembler(page);
      },
      assemblePageArtifact(assembleInput) {
        return assembleCmsHostPageArtifact(env, assembleInput);
      },
      enrichPages(pages) {
        return enrichCmsHostPages(pages);
      },
      listStorefrontCatalog() {
        return listCmsHostStorefrontCatalog();
      },
    },
  });
}
