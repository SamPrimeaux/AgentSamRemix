/**
 * CMS host context — config-driven injection point for site-specific storage/layout.
 *
 * HTTP routes receive one host object per request (from resolveCmsSiteConfig output)
 * and call host.* instead of importing IAM storefront or draft adapters directly.
 *
 * Production IAM storefront/draft behavior is injected via `adapters` from
 * src/api/cms-host-platform-bind.js. Canonical defaults stay inside this package.
 */
import { CMS_DEFAULT_R2_BUCKET } from '../adapters/cloudflare/storage.js';
import { isCmsLegacyWholePageAssemblerRoute } from './pilot-route.js';
import { cmsWorkspacePageKey, resolveCmsPageCreateProvision } from './page-create-provision.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function defaultResolvePageArtifact(page, workspaceId) {
  if (!page) {
    return {
      bucket: null,
      publishedKey: null,
      draftKey: null,
      layout: null,
      asset: null,
      route: null,
    };
  }
  const projectSlug = trim(page.project_slug || page.projectSlug);
  const slug = trim(page.slug);
  const publishedKey = cmsWorkspacePageKey(workspaceId, projectSlug, slug, 'published');
  const draftKey = cmsWorkspacePageKey(workspaceId, projectSlug, slug, 'draft');
  return {
    bucket: trim(page.r2_bucket) || CMS_DEFAULT_R2_BUCKET,
    publishedKey,
    draftKey,
    layout: { published_key: publishedKey, draft_key: draftKey },
    asset: null,
    route: trim(page.route_path) || (slug ? `/${slug}` : '/'),
  };
}

/**
 * @param {{
 *   env: Record<string, unknown>,
 *   workspaceId: string,
 *   siteConfig?: Record<string, unknown>|null,
 *   adapters?: {
 *     resolvePageArtifact?: Function,
 *     readPageArtifact?: Function,
 *     syncDraftPageArtifact?: Function,
 *     usesLegacyWholePageAssembler?: Function,
 *     assemblePageArtifact?: Function,
 *     enrichPages?: Function,
 *     listStorefrontCatalog?: Function,
 *   },
 * }} input
 */
export function buildCmsHostContext(input) {
  const env = input?.env;
  const workspaceId = String(input?.workspaceId || '').trim();
  const siteConfig = input?.siteConfig || null;
  const adapters = input?.adapters || {};

  return {
    siteConfig,
    workspaceId,

    /** Page-create R2 keys, default sections, and scaffold flags from site config. */
    pageCreateProvision(provisionInput) {
      return resolveCmsPageCreateProvision(siteConfig, provisionInput);
    },

    /** Map a canonical page row to the host storefront artifact layout. */
    resolvePageArtifact(page) {
      if (typeof adapters.resolvePageArtifact === 'function') {
        return adapters.resolvePageArtifact(page);
      }
      return defaultResolvePageArtifact(page, workspaceId);
    },

    /** Read draft/published HTML from the host storefront bucket. */
    readPageArtifact(binding, hostArtifact, variant = 'draft') {
      if (typeof adapters.readPageArtifact === 'function') {
        return adapters.readPageArtifact(binding, hostArtifact, variant);
      }
      return { html: null, r2_key: null, byte_length: 0 };
    },

    /** Sync whole-page draft shell after section mutations (legacy until Outcome 3b). */
    syncDraftPageArtifact(draftInput) {
      if (typeof adapters.syncDraftPageArtifact === 'function') {
        return adapters.syncDraftPageArtifact(draftInput);
      }
      if (!draftInput?.page) return { ok: false, skipped: true, reason: 'page_required' };
      return { ok: false, skipped: true, reason: 'host_adapter_required' };
    },

    /** True when this page still uses the IAM pilot whole-page assembler. */
    usesLegacyWholePageAssembler(page) {
      if (typeof adapters.usesLegacyWholePageAssembler === 'function') {
        return adapters.usesLegacyWholePageAssembler(page);
      }
      const route = page?.route_path || (page?.slug ? `/${page.slug}` : '');
      return isCmsLegacyWholePageAssemblerRoute(route);
    },

    /** Run the legacy whole-page assembler (publish/draft paths only). */
    assemblePageArtifact(assembleInput) {
      if (typeof adapters.assemblePageArtifact === 'function') {
        return adapters.assemblePageArtifact(assembleInput);
      }
      return Promise.resolve({ ok: false, skipped: true, reason: 'host_adapter_required' });
    },

    /** Bootstrap/UI: attach storefront metadata to canonical page rows. */
    enrichPages(pages) {
      if (typeof adapters.enrichPages === 'function') {
        return adapters.enrichPages(pages);
      }
      return Array.isArray(pages) ? pages : [];
    },

    /** Bootstrap/UI: list host storefront catalog entries. */
    listStorefrontCatalog() {
      if (typeof adapters.listStorefrontCatalog === 'function') {
        return adapters.listStorefrontCatalog();
      }
      return [];
    },
  };
}
