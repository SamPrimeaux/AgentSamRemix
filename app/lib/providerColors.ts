/** DB-driven provider colors (finance_categories kind=provider). */

export type FinanceProviderRow = {
  id: string;
  name: string;
  color: string;
  ai_keywords?: string | null;
};

/** Normalize rollup / event provider keys before color lookup. */
export function normalizeProviderKey(key: string): string {
  const x = String(key || '').toLowerCase().trim();
  if (x === 'cloudflare_workers_ai' || x === 'workers_ai' || x === 'cloudflare') return 'cloudflare';
  return x;
}

const BLOCKED_LEGEND_KEYS = new Set(['groq', 'unknown', 'meta', 'other']);

export function isBlockedProviderKey(key: string): boolean {
  return BLOCKED_LEGEND_KEYS.has(normalizeProviderKey(key));
}

export function buildProviderColorMap(providers: FinanceProviderRow[]): Record<string, string> {
  const acc: Record<string, string> = {};
  const rows = Array.isArray(providers) ? providers : [];
  for (const p of rows) {
    const color = String(p.color || '').trim();
    if (!color) continue;
    let keys: unknown[] = [];
    try {
      const parsed = JSON.parse(p.ai_keywords || '[]');
      keys = Array.isArray(parsed) ? parsed : [];
    } catch {
      keys = [];
    }
    for (const k of keys) {
      const nk = normalizeProviderKey(String(k));
      if (nk && !isBlockedProviderKey(nk)) acc[nk] = color;
    }
    const slug = String(p.id || '').replace(/^cat_provider_/, '');
    if (slug) {
      const nk = normalizeProviderKey(slug);
      if (!isBlockedProviderKey(nk)) acc[nk] = color;
    }
  }
  return acc;
}

/** Returns color or null (no grey fallback). */
export function lookupProviderColor(colorMap: Record<string, string>, key: string): string | null {
  const nk = normalizeProviderKey(key);
  if (!nk || isBlockedProviderKey(nk)) return null;
  return colorMap[nk] ?? null;
}
