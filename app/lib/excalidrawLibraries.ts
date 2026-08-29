/** Excalidraw library catalog + hydration (draw_libraries D1 + .excalidrawlib URLs). */

import { normalizeExcalidrawLibraryPayload } from '../src/core/excalidraw-library-normalize.js';

export type DrawLibraryRow = {
  slug: string;
  name: string;
  filename?: string;
  category?: string;
  icon?: string;
  public_url?: string;
  r2_dev_url?: string;
  auto_load?: number | boolean;
  agent_tags?: string;
  description?: string;
  item_count?: number;
  enabled?: boolean;
  pinned?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExcalidrawLibraryItem = any;

const LIBRARY_CACHE_KEY = 'iam.draw.libraryItems.v1';
const LIBRARY_CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h session cache

type LibraryCacheEntry = {
  slugsKey: string;
  savedAt: number;
  items: ExcalidrawLibraryItem[];
};

function slugsCacheKey(slugs: string[]): string {
  return [...slugs].sort().join('|');
}

function readLibrarySessionCache(slugs: string[]): ExcalidrawLibraryItem[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LibraryCacheEntry;
    if (!parsed?.items?.length) return null;
    if (parsed.slugsKey !== slugsCacheKey(slugs)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > LIBRARY_CACHE_TTL_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function writeLibrarySessionCache(slugs: string[], items: ExcalidrawLibraryItem[]): void {
  if (typeof sessionStorage === 'undefined' || !items.length) return;
  try {
    const entry: LibraryCacheEntry = {
      slugsKey: slugsCacheKey(slugs),
      savedAt: Date.now(),
      items,
    };
    sessionStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota — ignore */
  }
}

export async function fetchDrawLibraryCatalog(): Promise<DrawLibraryRow[]> {
  const res = await fetch('/api/draw/libraries', { credentials: 'same-origin' });
  if (!res.ok) return [];
  const data = (await res.json()) as { libraries?: DrawLibraryRow[] };
  return Array.isArray(data.libraries) ? data.libraries : [];
}

export async function fetchDrawLibraryPrefs(): Promise<{ slug: string; enabled: boolean; pinned: boolean }[]> {
  const res = await fetch('/api/draw/library-prefs', { credentials: 'same-origin' });
  if (!res.ok) return [];
  const data = (await res.json()) as { prefs?: { slug: string; enabled: boolean; pinned: boolean }[] };
  return Array.isArray(data.prefs) ? data.prefs : [];
}

export async function saveDrawLibraryPrefs(
  slugs: string[],
): Promise<void> {
  await fetch('/api/draw/library-prefs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled_slugs: slugs }),
  });
}

/** Persist default auto_load slugs when user has no prefs yet (one-time seed). */
export async function ensureDrawLibraryPrefsSeeded(
  catalog: DrawLibraryRow[],
  prefs: { slug: string; enabled: boolean }[],
): Promise<string[]> {
  const resolved = resolveEnabledLibrarySlugs(catalog, prefs);
  if (prefs.length === 0 && resolved.length > 0) {
    await saveDrawLibraryPrefs(resolved).catch(() => {});
  }
  return resolved;
}

export async function fetchLibraryItemsBySlug(slug: string): Promise<ExcalidrawLibraryItem[]> {
  const res = await fetch('/api/draw/library', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { libraryItems?: ExcalidrawLibraryItem[] };
  if (Array.isArray(data.libraryItems) && data.libraryItems.length > 0) {
    if (data.libraryItems[0]?.elements) return data.libraryItems;
    return normalizeExcalidrawLibraryPayload({ libraryItems: data.libraryItems }, { slug });
  }
  return [];
}

function parseLibraryPayload(raw: unknown, slug = ''): ExcalidrawLibraryItem[] {
  return normalizeExcalidrawLibraryPayload(raw, { slug, itemNamePrefix: slug || undefined });
}

export async function fetchLibraryItemsFromUrl(url: string, slug = ''): Promise<ExcalidrawLibraryItem[]> {
  const trimmed = url.trim();
  if (!trimmed) return [];
  const res = await fetch(trimmed, { credentials: 'omit' });
  if (!res.ok) return [];
  try {
    const json = await res.json();
    return parseLibraryPayload(json, slug);
  } catch {
    return [];
  }
}

/** Merge library item arrays by id (later wins). */
export function mergeLibraryItemArrays(
  ...groups: ExcalidrawLibraryItem[][]
): ExcalidrawLibraryItem[] {
  const byId = new Map<string, ExcalidrawLibraryItem>();
  for (const group of groups) {
    for (const item of group) {
      const id = String(item?.id ?? '').trim();
      if (id) byId.set(id, item);
    }
  }
  return [...byId.values()];
}

/** Resolve which slugs to load: user prefs > auto_load defaults. */
export function resolveEnabledLibrarySlugs(
  catalog: DrawLibraryRow[],
  prefs: { slug: string; enabled: boolean }[],
): string[] {
  const prefMap = new Map(prefs.map((p) => [p.slug, p.enabled]));
  if (prefMap.size > 0) {
    return catalog.filter((row) => prefMap.get(row.slug) === true).map((r) => r.slug);
  }
  return catalog.filter((row) => row.auto_load === 1 || row.auto_load === true).map((r) => r.slug);
}

export async function hydrateLibraryItemsForSlugs(
  catalog: DrawLibraryRow[],
  slugs: string[],
): Promise<ExcalidrawLibraryItem[]> {
  if (!slugs.length) return [];

  const cached = readLibrarySessionCache(slugs);
  if (cached?.length) return cached;

  const slugSet = new Set(slugs);
  const targets = catalog.filter((row) => slugSet.has(row.slug));
  const batches = await Promise.all(
    targets.map(async (row) => {
      const url = row.public_url || row.r2_dev_url || '';
      if (!url) return fetchLibraryItemsBySlug(row.slug);
      return fetchLibraryItemsFromUrl(url, row.slug);
    }),
  );
  const merged = mergeLibraryItemArrays(...batches);
  if (merged.length) writeLibrarySessionCache(slugs, merged);
  return merged;
}

/** Catalog + prefs + hydration in one call (cache-aware). */
export async function loadDrawLibrariesForCanvas(
  slugsOverride?: string[],
): Promise<{ slugs: string[]; items: ExcalidrawLibraryItem[]; itemCount: number }> {
  const [catalog, prefs] = await Promise.all([fetchDrawLibraryCatalog(), fetchDrawLibraryPrefs()]);
  const slugs =
    slugsOverride ??
    (await ensureDrawLibraryPrefsSeeded(catalog, prefs));
  const items = await hydrateLibraryItemsForSlugs(catalog, slugs);
  return { slugs, items, itemCount: items.length };
}
