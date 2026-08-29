import { normalizeSourceUrl } from '../media/identity.js';

export const WEBSITE_INGEST_SCHEMA = 'iam.website-ingest.v1';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function bool(value, fallback) {
  return value == null ? fallback : value === true;
}

function int(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function uniqueUrls(values, baseUrl) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const normalized = normalizeSourceUrl(raw, baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Stable input contract for website content/media migration.
 * Execution is adapter-driven; this function performs no crawl, network, AI, D1, or R2 work.
 */
export function normalizeWebsiteIngestRequest(input = {}) {
  const scope = object(input.scope);
  const siteInput = typeof input.site === 'string' ? { base_url: input.site } : object(input.site);
  const crawlInput = object(input.crawlPolicy ?? input.crawl_policy ?? input.crawl);
  const assetInput = object(input.assetPolicy ?? input.asset_policy ?? input.assets);
  const destinationInput = object(input.destination);
  const enrichmentInput = object(assetInput.enrichment);

  const baseUrl = normalizeSourceUrl(
    siteInput.base_url ?? siteInput.baseUrl ?? siteInput.url ?? input.base_url ?? input.baseUrl,
  );
  const seeds = uniqueUrls(input.seeds?.length ? input.seeds : baseUrl ? [baseUrl] : [], baseUrl || undefined);
  const modeRaw = text(crawlInput.mode).toLowerCase();
  const mode = modeRaw === 'page' ? 'page' : 'site';

  return {
    schema: WEBSITE_INGEST_SCHEMA,
    tenant_id: text(input.tenant_id ?? input.tenant ?? scope.tenant_id ?? scope.tenantId) || null,
    workspace_id: text(input.workspace_id ?? scope.workspace_id ?? scope.workspaceId) || null,
    project_id: text(input.project_id ?? scope.project_id ?? scope.projectId) || null,
    site: {
      id: text(siteInput.id ?? siteInput.site_id) || null,
      slug: text(siteInput.slug ?? siteInput.site_slug) || null,
      base_url: baseUrl,
    },
    seeds,
    crawl_policy: {
      mode,
      same_domain: bool(crawlInput.same_domain ?? crawlInput.sameDomain, true),
      respect_robots_txt: bool(crawlInput.respect_robots_txt ?? crawlInput.respectRobotsTxt, true),
      max_pages: int(crawlInput.max_pages ?? crawlInput.maxPages, mode === 'page' ? 1 : 100, 1, 10000),
      max_depth: int(crawlInput.max_depth ?? crawlInput.maxDepth, mode === 'page' ? 0 : 8, 0, 100),
      strip_tracking_params: bool(
        crawlInput.strip_tracking_params ?? crawlInput.stripTrackingParams,
        true,
      ),
      include: Array.isArray(crawlInput.include) ? crawlInput.include.map(String) : [],
      exclude: Array.isArray(crawlInput.exclude) ? crawlInput.exclude.map(String) : [],
    },
    asset_policy: {
      preserve_original: bool(assetInput.preserve_original ?? assetInput.preserveOriginal, true),
      discover_img_src: bool(assetInput.discover_img_src ?? assetInput.discoverImgSrc, true),
      discover_srcset: bool(assetInput.discover_srcset ?? assetInput.discoverSrcset, true),
      discover_picture_sources: bool(
        assetInput.discover_picture_sources ?? assetInput.discoverPictureSources,
        true,
      ),
      discover_css_backgrounds: bool(
        assetInput.discover_css_backgrounds ?? assetInput.discoverCssBackgrounds,
        true,
      ),
      exact_hash: text(assetInput.exact_hash ?? assetInput.exactHash).toLowerCase() || 'sha256',
      source_identity_dedupe: bool(
        assetInput.source_identity_dedupe ?? assetInput.sourceIdentityDedupe,
        true,
      ),
      perceptual_dedupe: text(assetInput.perceptual_dedupe ?? assetInput.perceptualDedupe).toLowerCase() || 'advisory',
      optimization: text(assetInput.optimization).toLowerCase() || 'derived_async',
      enrichment: {
        enabled: bool(enrichmentInput.enabled, false),
        semantic_tags: bool(enrichmentInput.semantic_tags ?? enrichmentInput.semanticTags, false),
        accessibility_alt_suggestion: bool(
          enrichmentInput.accessibility_alt_suggestion ?? enrichmentInput.accessibilityAltSuggestion,
          false,
        ),
      },
    },
    destination: {
      provider: text(destinationInput.provider).toLowerCase() || 'r2',
      bucket: text(destinationInput.bucket ?? destinationInput.r2_bucket) || null,
      prefix: text(destinationInput.prefix).replace(/^\/+|\/+$/g, ''),
      register_media_assets: bool(
        destinationInput.register_media_assets ?? destinationInput.registerMediaAssets,
        true,
      ),
      delivery_base_url: text(destinationInput.delivery_base_url ?? destinationInput.deliveryBaseUrl) || null,
    },
    resume_key: text(input.resume_key ?? input.idempotency_key) || null,
  };
}

export function validateWebsiteIngestRequest(input = {}) {
  const request = normalizeWebsiteIngestRequest(input);
  const errors = [];
  if (!request.tenant_id) errors.push('tenant_id_required');
  if (!request.workspace_id) errors.push('workspace_id_required');
  if (!request.site.base_url) errors.push('site_base_url_required');
  if (!request.seeds.length) errors.push('seed_required');
  if (request.destination.provider === 'r2' && !request.destination.bucket) {
    errors.push('destination_bucket_required');
  }
  return { ok: errors.length === 0, errors, request };
}
