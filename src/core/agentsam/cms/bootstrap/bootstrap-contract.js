const REQUIRED_ADAPTERS = [
  'enrichPages',
  'resolveActiveThemeRow',
  'getDraftCache',
  'resolveSiteConfig',
  'listSiteShell',
  'resolveTenant',
  'resolvePublicDomain',
  'buildPageUrls',
  'listStorefrontCatalog',
  'upsertProjectContext',
];

export function assertCmsBootstrapAdapters(adapters) {
  const missing = REQUIRED_ADAPTERS.filter((name) => typeof adapters?.[name] !== 'function');
  if (missing.length) {
    throw new Error(`CMS_BOOTSTRAP_ADAPTERS_MISSING:${missing.join(',')}`);
  }
  return adapters;
}

export function normalizeJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
