/**
 * Portable storefront URL helpers — domain must come from bootstrap / workspace API.
 * No slug-derived host guesses.
 */

export type StorefrontUrlInput = {
  projectSlug?: string | null;
  tenantDomain?: string | null;
  publicDomain?: string | null;
  siteDomain?: string | null;
  path?: string;
};

function normalizePath(path?: string): string {
  if (!path?.trim()) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeHost(raw?: string | null): string | null {
  const host = String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  return host || null;
}

export function resolveStorefrontUrl(input: StorefrontUrlInput): string | null {
  const path = normalizePath(input.path);
  for (const candidate of [input.siteDomain, input.publicDomain, input.tenantDomain]) {
    if (!candidate?.trim()) continue;
    const trimmed = candidate.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return `${trimmed.replace(/\/$/, '')}${path}`;
    }
    return `https://${trimmed.replace(/^\/\//, '')}${path}`;
  }
  const host = normalizeHost(input.tenantDomain);
  if (!host) return null;
  const route = path || '/';
  return `https://${host}${route}`;
}

export function storefrontDisplayHost(url: string | null | undefined): string {
  if (!url) return 'Domain not configured';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
