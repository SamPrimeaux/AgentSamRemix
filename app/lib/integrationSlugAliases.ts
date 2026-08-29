export const REGISTRY_TO_CATALOG_SLUG: Record<string, string> = {
  cloudflare_oauth: 'cloudflare',
  supabase_oauth: 'supabase',
};

/** Registry / catalog keys that fold into one Cloudflare tile in Settings → Integrations. */
export const CLOUDFLARE_FAMILY_KEYS = new Set([
  'cloudflare',
  'cloudflare_oauth',
  'cloudflare_r2',
  'cloudflare_images',
  'cloudflare_kv',
  'cloudflare_d1',
  'cloudflare_do',
  'cloudflare_workers',
  'cloudflare_pages',
  'cloudflare_tunnel',
  'cloudflare_stream',
  'cloudflare_ai',
  'vectorize',
  'browser_rendering',
]);

export const CLOUDFLARE_CAPABILITY_LABELS: Record<string, string> = {
  cloudflare_oauth: 'Developer Platform (OAuth)',
  cloudflare: 'Developer Platform',
  cloudflare_r2: 'R2',
  cloudflare_images: 'Images',
  vectorize: 'Vectorize',
  browser_rendering: 'Browser Rendering',
  cloudflare_kv: 'KV',
  cloudflare_d1: 'D1',
  cloudflare_pages: 'Pages',
  cloudflare_workers: 'Workers',
  cloudflare_tunnel: 'Tunnel',
};

export function isCloudflareFamilyKey(key: string): boolean {
  const k = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (!k) return false;
  if (CLOUDFLARE_FAMILY_KEYS.has(k)) return true;
  return k.startsWith('cloudflare_');
}

export function canonicalCloudflareRegistryKey(): string {
  return 'cloudflare_oauth';
}

export function registrySlugForCatalog(catalogSlug: string): string {
  const slug = String(catalogSlug || '').trim().toLowerCase();
  for (const [registry, catalog] of Object.entries(REGISTRY_TO_CATALOG_SLUG)) {
    if (catalog === slug) return registry;
  }
  return slug;
}

export function catalogSlugForRegistry(providerKey: string): string {
  const key = String(providerKey || '').trim().toLowerCase();
  return REGISTRY_TO_CATALOG_SLUG[key] || key;
}

export function isSlugConnected(slug: string, connectedSlugs: Set<string>): boolean {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return false;
  if (connectedSlugs.has(s)) return true;
  for (const [registry, catalog] of Object.entries(REGISTRY_TO_CATALOG_SLUG)) {
    if (catalog === s && connectedSlugs.has(registry)) return true;
  }
  // Intentionally do NOT treat satellite CF bindings (R2, Images, Vectorize, …)
  // as the Developer Platform OAuth connection — that blocked real CF OAuth reconnect.
  return false;
}
