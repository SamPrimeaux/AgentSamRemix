function trim(value) {
  return value == null ? '' : String(value).trim();
}

export function buildCmsSiteManifest({
  projectSlug,
  siteConfig,
  tenant,
  domainResolved,
  pages,
  homePage,
  cacheKey,
  defaultR2Bucket,
  storageBindings = {},
}) {
  const publicHost =
    trim(domainResolved?.domain) ||
    trim(siteConfig?.public_domain) ||
    trim(tenant?.domain) ||
    null;

  return {
    cms_hosting: siteConfig?.cms_hosting || 'platform',
    worker_name: siteConfig?.worker_name || null,
    worker_base_url: siteConfig?.worker_base_url || null,
    studio_url: siteConfig?.studio_url || null,
    tenant: tenant
      ? { ...tenant, domain: publicHost }
      : { slug: projectSlug, domain: publicHost },
    public_domain: publicHost,
    domain_source: domainResolved?.source || (siteConfig?.public_domain ? 'cms_site_config' : null),
    pages,
    home_page: homePage
      ? {
          id: homePage.id,
          slug: homePage.slug,
          title: homePage.title,
          route_path: homePage.route_path,
          status: homePage.status,
          r2_key: homePage.r2_key,
          storefront_edit_mode: homePage.storefront_edit_mode || null,
          storefront_asset_r2_key: homePage.storefront_asset_r2_key || null,
          storefront_hydrate: homePage.storefront_hydrate === true,
        }
      : null,
    storage: {
      r2_bucket: defaultR2Bucket,
      r2_key: homePage?.r2_key || null,
      bootstrap_cache_key: cacheKey,
      kv_binding: storageBindings.kv || null,
      do_binding: storageBindings.collaboration || null,
    },
  };
}
