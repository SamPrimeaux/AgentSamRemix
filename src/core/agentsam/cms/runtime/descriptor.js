function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Build a portable CMS runtime descriptor from authoritative registry/config data.
 * This function does not infer a customer, Worker, bucket, binding, or domain.
 */
export function buildCmsRuntimeDescriptor(siteConfig = null, pageFocus = null) {
  const cfg = siteConfig && typeof siteConfig === 'object' ? siteConfig : {};
  const focus = pageFocus && typeof pageFocus === 'object' ? pageFocus : {};
  const appKey = trim(cfg.app_key) || trim(cfg.project_slug) || null;
  if (!appKey && !trim(focus.page_id)) return null;

  return {
    app_key: appKey,
    project_slug: trim(cfg.project_slug) || appKey,
    cms_hosting: trim(cfg.cms_hosting) || trim(cfg.cms_mode) || null,
    cms_mode: trim(cfg.cms_hosting) || trim(cfg.cms_mode) || null,
    cms_shell: trim(cfg.cms_shell) || null,
    api_profile: trim(cfg.api_profile) || trim(cfg.cms_api_profile) || null,
    worker_name: trim(cfg.worker_name) || null,
    worker_base_url: trim(cfg.worker_base_url) || null,
    public_domain: trim(cfg.public_domain) || null,
    studio_url: trim(cfg.studio_url) || null,
    bridge_supported: cfg.bridge_supported === true,
    d1_database_id: trim(cfg.d1_database_id) || null,
    d1_binding: trim(cfg.d1_binding) || null,
    r2_bucket: trim(cfg.r2_bucket) || null,
    r2_binding: trim(cfg.r2_binding) || null,
    website_r2: cfg.website_r2 || null,
    catalog_r2: cfg.catalog_r2 || null,
    kv_namespace: trim(cfg.kv_namespace) || null,
    kv_binding: trim(cfg.kv_binding) || null,
    do_binding: trim(cfg.do_binding) || null,
    inventory_source: trim(cfg.inventory_source) || null,
    page_id: trim(focus.page_id) || null,
    route_path: trim(focus.route_path) || null,
    r2_key: trim(focus.r2_key) || null,
  };
}

export function formatCmsRuntimeDescriptorForPrompt(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const lines = [
    '[CMS runtime descriptor — authoritative registry/config values only.]',
    `app_key: ${ctx.app_key || '(none)'}`,
    `project_slug: ${ctx.project_slug || '(none)'}`,
    `cms_hosting: ${ctx.cms_hosting || '(none)'}`,
    `api_profile: ${ctx.api_profile || '(none)'}`,
    `worker_name: ${ctx.worker_name || '(none)'}`,
    `public_domain: ${ctx.public_domain || '(none)'}`,
    `r2_bucket: ${ctx.r2_bucket || '(none)'}`,
    `d1_database_id: ${ctx.d1_database_id || '(none)'}`,
    `page_id: ${ctx.page_id || '(none)'}`,
    `route_path: ${ctx.route_path || '(none)'}`,
    `r2_key: ${ctx.r2_key || '(none)'}`,
  ];
  return `## CMS runtime\n${lines.join('\n')}`;
}
