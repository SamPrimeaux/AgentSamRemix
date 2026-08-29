/**
 * Host-aware page-create provisioning — resolves R2 bucket/keys and default sections
 * from site config (never from hardcoded project_slug branches in route handlers).
 */
import { CMS_DEFAULT_R2_BUCKET } from '../adapters/cloudflare/storage.js';
import { CMS_PLATFORM_PAGE_BASELINE_SECTIONS } from './page-baseline-sections.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export function cmsWorkspacePageKey(workspaceId, projectSlug, slug, variant) {
  return `cms/${workspaceId}/${projectSlug}/${slug}/${variant}.html`;
}

/**
 * Platform unified shell: marketing pages/{slug}/index.html on the site website bucket.
 * @param {Record<string, unknown>|null|undefined} siteConfig
 */
export function usesPlatformStorefrontPageLayout(siteConfig) {
  if (!siteConfig || typeof siteConfig !== 'object') return false;
  const hosting = trim(siteConfig.cms_hosting);
  const shell = trim(siteConfig.cms_shell);
  return hosting === 'platform' && shell === 'iam_unified';
}

/**
 * @param {Record<string, unknown>|null|undefined} siteConfig
 * @param {{
 *   workspaceId: string,
 *   projectSlug: string,
 *   slug: string,
 *   status?: string,
 * }} input
 */
export function resolveCmsPageCreateProvision(siteConfig, input) {
  const workspaceId = trim(input.workspaceId);
  const projectSlug = trim(input.projectSlug);
  const slug = trim(input.slug);
  const pageStatus = trim(input.status) === 'published' ? 'published' : 'draft';
  const r2Variant = pageStatus === 'published' ? 'published' : 'draft';

  if (usesPlatformStorefrontPageLayout(siteConfig)) {
    const configuredBucket = trim(siteConfig?.r2_bucket);
    const r2Bucket = configuredBucket || CMS_DEFAULT_R2_BUCKET;
    const publishedKey = `pages/${slug}/index.html`;
    const draftKey = `pages/.draft/${slug}/index.html`;
    return {
      layout: 'platform_storefront',
      r2Bucket,
      r2Key: pageStatus === 'published' ? publishedKey : draftKey,
      publishedR2Key: publishedKey,
      draftR2Key: draftKey,
      mirrorPublishedToDraftOnCreate: pageStatus === 'published',
      defaultSections: CMS_PLATFORM_PAGE_BASELINE_SECTIONS,
      scaffoldHtmlFromSections: true,
      contentType: 'text/html; charset=utf-8',
    };
  }

  return {
    layout: 'workspace_cms',
    r2Bucket: CMS_DEFAULT_R2_BUCKET,
    r2Key: cmsWorkspacePageKey(workspaceId, projectSlug, slug, r2Variant),
    publishedR2Key: cmsWorkspacePageKey(workspaceId, projectSlug, slug, 'published'),
    draftR2Key: cmsWorkspacePageKey(workspaceId, projectSlug, slug, 'draft'),
    mirrorPublishedToDraftOnCreate: false,
    defaultSections: [],
    scaffoldHtmlFromSections: false,
    contentType: 'text/html',
  };
}
