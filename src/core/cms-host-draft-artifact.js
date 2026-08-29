/**
 * CMS host adapter for draft page-artifact synchronization.
 *
 * Canonical section/block mutation does not belong here. This adapter only preserves
 * host-specific page-shell/storage behavior while the CMS converges on section-granular
 * R2 draft artifacts. Generic HTTP routes call this adapter and never branch on a site id.
 */
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './agentsam/cms/adapters/cloudflare/storage.js';
import { usesPlatformStorefrontPageLayout } from './agentsam/cms/host/page-create-provision.js';
import { writeCmsDraftHtmlToR2 } from './cms-draft-artifact-host.js';
import { cmsPageHtmlKey } from './cms-edit-safety.js';
import { assembleAndPutIamPilotPage, isIamAssemblePilotRoute } from './iam-cms-assemble.js';
import { resolveIamPageHtmlKeys } from './iam-storefront-assets.js';

/**
 * Synchronize the host's draft page artifact after canonical CMS content changes.
 *
 * This is intentionally a compatibility adapter. Outcome 3 replaces whole-page draft
 * synchronization with section R2 objects + page manifests.
 *
 * @param {any} env
 * @param {{
 *   siteConfig?: Record<string, unknown>|null,
 *   workspaceId: string,
 *   page: Record<string, unknown>,
 *   userId: string,
 *   draftData: Record<string, unknown>,
 * }} input
 */
export async function syncCmsDraftPageArtifact(env, input) {
  const page = input?.page;
  if (!page) return { ok: false, skipped: true, reason: 'page_required' };

  const pageRoute = String(page.route_path || `/${page.slug || ''}`).trim();
  if (usesPlatformStorefrontPageLayout(input.siteConfig) && isIamAssemblePilotRoute(pageRoute)) {
    const layout = resolveIamPageHtmlKeys(page, input.workspaceId, cmsPageHtmlKey);
    const binding = getCmsR2Binding(
      env,
      layout.bucket || page.r2_bucket || CMS_DEFAULT_R2_BUCKET,
    );
    if (!binding) return { ok: false, skipped: true, reason: 'r2_binding_unavailable' };
    return assembleAndPutIamPilotPage(env, {
      page: { ...page, route_path: pageRoute },
      r2Binding: binding,
      draftOnly: true,
    });
  }

  return writeCmsDraftHtmlToR2(env, {
    workspaceId: input.workspaceId,
    page,
    userId: input.userId,
    draftData: input.draftData,
  });
}
