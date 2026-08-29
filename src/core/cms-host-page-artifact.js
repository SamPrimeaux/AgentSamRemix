/**
 * CMS host page-artifact compatibility boundary.
 *
 * Generic CMS routes/publish code use this module instead of importing IAM storefront
 * compatibility helpers directly. This does not own canonical CMS behavior; it only maps
 * a canonical page to the host's current storefront artifact layout while Outcome 3 moves
 * publication to section R2 objects + immutable page manifests.
 */
import { CMS_DEFAULT_R2_BUCKET } from './agentsam/cms/adapters/cloudflare/storage.js';
import { normalizeCmsRoutePath } from './cms-page-hydrate-dispatch.js';
import {
  enrichPagesWithStorefrontAssets,
  listIamStorefrontCatalog,
  readStorefrontAssetHtml,
  resolveIamPageHtmlKeys,
  resolveIamStorefrontAssetForPage,
} from './iam-storefront-assets.js';
import { assembleAndPutIamPilotPage, isIamAssemblePilotRoute } from './iam-cms-assemble.js';

/**
 * @param {Record<string, unknown>} page
 * @param {string} workspaceId
 * @param {(workspaceId:string, projectSlug:string, slug:string, variant:string)=>string} pageKeyFn
 */
export function resolveCmsHostPageArtifact(page, workspaceId, pageKeyFn) {
  const layout = resolveIamPageHtmlKeys(page, workspaceId, pageKeyFn);
  const asset = resolveIamStorefrontAssetForPage(page);
  return {
    layout,
    asset,
    bucket: String(layout.bucket || page?.r2_bucket || CMS_DEFAULT_R2_BUCKET).trim(),
    publishedKey: String(layout.published_key || page?.r2_key || '').trim(),
    draftKey: String(layout.draft_key || '').trim(),
    mode: layout.mode || 'cms',
    hydrate: asset?.hydrate === true,
    route: asset ? normalizeCmsRoutePath(asset.route) : normalizeCmsRoutePath(page?.route_path || `/${page?.slug || ''}`),
  };
}

/** Read the host's existing storefront page artifact for editor preview compatibility. */
export function readCmsHostPageArtifact(binding, hostArtifact, variant = 'draft') {
  if (!hostArtifact?.asset) return Promise.resolve({ html: null, r2_key: null, byte_length: 0 });
  return readStorefrontAssetHtml(
    binding,
    {
      draft_key: hostArtifact.draftKey,
      published_key: hostArtifact.publishedKey,
    },
    variant,
  );
}

/** Existing host storefront metadata added to canonical page rows for compatibility UI. */
export function enrichCmsHostPages(pages) {
  return enrichPagesWithStorefrontAssets(pages);
}

/** Existing host storefront catalog exposed to bootstrap while legacy shells remain. */
export function listCmsHostStorefrontCatalog() {
  return listIamStorefrontCatalog();
}

/** Temporary legacy whole-page assembler selector; hidden from generic route/publish callers. */
export function usesCmsHostLegacyAssembler(page) {
  const route = String(page?.route_path || `/${page?.slug || ''}`).trim();
  return isIamAssemblePilotRoute(route);
}

/** Temporary legacy whole-page assembler; Outcome 3 removes this path. */
export function assembleCmsHostPageArtifact(env, input) {
  return assembleAndPutIamPilotPage(env, {
    page: input.page,
    r2Binding: input.r2Binding,
    draftOnly: input.draftOnly === true,
  });
}
