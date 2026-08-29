/**
 * Per-app logo resolution — never reuse another client's mark.
 * Prefer client_apps.logo_url for the active app_key / project_slug.
 */
export type CmsBrandingResolveInput = {
  appKey?: string | null;
  clientAppsLogo?: string | null;
  tenantLogo?: string | null;
  propLogo?: string | null;
};

export type CmsBrandingResolveResult = {
  logo_url: string | null;
  branding_source: 'client_apps' | 'cms_tenants' | 'prop' | 'none';
  app_key: string | null;
};

function clean(url?: string | null): string | null {
  const s = String(url || '').trim();
  return s || null;
}

export function resolveCmsLogoUrl(input: CmsBrandingResolveInput): CmsBrandingResolveResult {
  const appKey = String(input.appKey || '').trim() || null;
  const fromApps = clean(input.clientAppsLogo);
  if (fromApps) {
    return { logo_url: fromApps, branding_source: 'client_apps', app_key: appKey };
  }
  const fromTenant = clean(input.tenantLogo);
  if (fromTenant) {
    return { logo_url: fromTenant, branding_source: 'cms_tenants', app_key: appKey };
  }
  const fromProp = clean(input.propLogo);
  if (fromProp) {
    return { logo_url: fromProp, branding_source: 'prop', app_key: appKey };
  }
  return { logo_url: null, branding_source: 'none', app_key: appKey };
}
