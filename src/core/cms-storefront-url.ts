/**
 * CMS storefront URL helpers — callers must supply tenant domain from API/D1/Cloudflare resolution.
 * No slug maps or workers.dev guesses.
 */

export function normalizeCmsPublicHost(raw?: string | null): string | null {
  const host = String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  return host || null;
}

/** @deprecated Pass domain from /api/cms/bootstrap or workspace-context — never infer from slug. */
export function resolveCmsPublicDomain(
  _projectSlug?: string | null,
  tenantDomain?: string | null,
): string | null {
  return normalizeCmsPublicHost(tenantDomain);
}

export function resolveCmsStorefrontUrl(
  tenantDomain?: string | null,
  path = '/',
  _projectSlug?: string | null,
): string | null {
  const host = normalizeCmsPublicHost(tenantDomain);
  if (!host) return null;
  let route = String(path || '/').trim() || '/';
  if (!route.startsWith('/')) route = `/${route}`;
  return `https://${host}${route}`;
}
