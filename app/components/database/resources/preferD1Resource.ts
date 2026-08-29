/**
 * Prefer the worker-bound business D1 over alphabetically-first empty catalog DBs.
 * Catalog historically labeled platform rows as `platform_token_catalog` while UI
 * looked for `platform_operator` — treat both as platform.
 */

export const PLATFORM_WORKER_D1_DATABASE_ID = 'cf87b717-d4e2-4cf8-bab0-a81268e32d49';

export type D1ResourceLike = {
  database_id?: string | null;
  database_name?: string | null;
  source?: string | null;
};

export function isPlatformD1Source(source: unknown): boolean {
  const s = String(source || '').trim();
  return s === 'platform_operator' || s === 'platform_token_catalog';
}

export function findPlatformD1Resource<T extends D1ResourceLike>(resources: T[]): T | null {
  if (!Array.isArray(resources) || !resources.length) return null;
  const byId = resources.find(
    (row) => String(row.database_id || '').trim() === PLATFORM_WORKER_D1_DATABASE_ID,
  );
  if (byId) return byId;
  const bySource = resources.find((row) => isPlatformD1Source(row.source));
  if (bySource) return bySource;
  const byName = resources.find((row) =>
    /inneranimalmedia-business/i.test(String(row.database_name || '')),
  );
  return byName || null;
}

/**
 * Sticky localStorage often keeps empty `inneranimal` (CF catalog-first).
 * Migrate that known-bad default to the platform business DB when present.
 */
export function shouldMigrateAwayFromD1(resource: D1ResourceLike | null | undefined): boolean {
  if (!resource) return false;
  if (isPlatformD1Source(resource.source)) return false;
  const id = String(resource.database_id || '').trim();
  const name = String(resource.database_name || '').trim().toLowerCase();
  if (id === PLATFORM_WORKER_D1_DATABASE_ID) return false;
  return name === 'inneranimal';
}

export function pickPreferredD1Resource<T extends D1ResourceLike>(
  resources: T[],
  opts: {
    fromUrl?: string;
    currentId?: string;
    currentName?: string;
    databaseNameHint?: string;
  } = {},
): T | null {
  const list = Array.isArray(resources) ? resources : [];
  if (!list.length) return null;

  const fromUrl = String(opts.fromUrl || '').trim();
  if (fromUrl) {
    const match =
      list.find((row) => String(row.database_id || '').trim() === fromUrl) ||
      list.find((row) => String(row.database_name || '').trim() === fromUrl);
    if (match) return match;
  }

  const currentId = String(opts.currentId || '').trim();
  const currentName = String(opts.currentName || '').trim();
  if (currentId || currentName) {
    const current =
      list.find((row) => String(row.database_id || '').trim() === currentId) ||
      list.find((row) => String(row.database_name || '').trim() === currentName) ||
      list.find((row) => String(row.database_name || '').trim() === currentId);
    if (current && !shouldMigrateAwayFromD1(current)) return current;
  }

  const hint = String(opts.databaseNameHint || '').trim().toLowerCase();
  if (hint) {
    const byHint = list.find((row) => String(row.database_name || '').trim().toLowerCase() === hint);
    if (byHint) return byHint;
  }

  return findPlatformD1Resource(list) || list[0] || null;
}
