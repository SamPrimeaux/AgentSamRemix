/**
 * Map integration_registry.provider_key ↔ integration_catalog.slug.
 * Registry uses suffixed keys (cloudflare_oauth); catalog uses connect slugs (cloudflare).
 */

export const REGISTRY_TO_CATALOG_SLUG = Object.freeze({
  cloudflare_oauth: 'cloudflare',
  supabase_oauth: 'supabase',
});

export const CATALOG_TO_REGISTRY_SLUG = Object.freeze(
  Object.fromEntries(
    Object.entries(REGISTRY_TO_CATALOG_SLUG).map(([registry, catalog]) => [catalog, registry]),
  ),
);

export function catalogSlugForRegistry(providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  return REGISTRY_TO_CATALOG_SLUG[key] || key;
}

export function registrySlugForCatalog(catalogSlug) {
  const slug = String(catalogSlug || '').trim().toLowerCase();
  return CATALOG_TO_REGISTRY_SLUG[slug] || slug;
}

export function expandConnectedSlugs(registrySlugs) {
  const out = new Set();
  for (const raw of registrySlugs || []) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    out.add(key);
    const catalog = catalogSlugForRegistry(key);
    if (catalog) out.add(catalog);
  }
  return [...out];
}
