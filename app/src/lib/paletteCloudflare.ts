import { isPlatformWorkspace } from './databaseStudioRoute';

export const PALETTE_R2_PAGE_SIZE = 10;

export const PALETTE_CONNECT_CLOUDFLARE = {
  id: 'connect-cloudflare',
  category: 'connect' as const,
  title: '+ Connect Cloudflare',
  subtitle: 'OAuth or API token required to list D1, R2, Hyperdrive, and Vectorize',
};

export type PaletteCfCatalog = {
  ok?: boolean;
  error?: string;
  user_message?: string;
  d1?: { name: string; id?: string; bound?: boolean }[];
  r2?: { name: string; bound?: boolean }[];
  hyperdrive?: { id: string; name: string; bound?: boolean }[];
  vectorize?: { name: string; description?: string | null; bound?: boolean }[];
};

type WorkspaceFetchInit = (init?: RequestInit) => RequestInit;

type CfD1Row = { name?: string; uuid?: string; id?: string };
type CfR2Row = { name?: string };

/**
 * True when the user can list remote Cloudflare data planes (OAuth, BYOK API token, or platform superadmin).
 */
export async function probePaletteCloudflareConnected(
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<boolean> {
  try {
    const ctxRes = await fetch('/api/data-plane/context', {
      credentials: 'same-origin',
      ...workspaceFetchInit(),
    });
    if (ctxRes.ok) {
      const ctx = (await ctxRes.json()) as { connections?: { cloudflare?: boolean } };
      if (ctx?.connections?.cloudflare) return true;
    }

    const integRes = await fetch('/api/settings/integrations/connected', {
      credentials: 'same-origin',
    });
    if (integRes.ok) {
      const integ = (await integRes.json()) as { connected_slugs?: string[] };
      const slugs = new Set((integ.connected_slugs || []).map((s) => String(s).toLowerCase()));
      if (slugs.has('cloudflare') || slugs.has('cloudflare_oauth')) return true;
    }

    const d1Res = await fetch('/api/settings/keys/cloudflare/d1', {
      credentials: 'same-origin',
      ...workspaceFetchInit(),
    });
    if (d1Res.ok) return true;

    const acctRes = await fetch('/api/data-plane/customer-cloudflare/accounts', {
      credentials: 'same-origin',
      ...workspaceFetchInit(),
    });
    return acctRes.ok;
  } catch {
    return false;
  }
}

async function fetchJsonWithInit<T>(
  url: string,
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...workspaceFetchInit() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Unified CF account catalog — D1, R2, Hyperdrive, Vectorize with bound markers. */
export async function fetchPaletteCloudflareCatalog(
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<PaletteCfCatalog | null> {
  return fetchJsonWithInit<PaletteCfCatalog>(
    '/api/data-plane/customer-cloudflare/catalog',
    workspaceFetchInit,
  );
}

function filterByTerm<T extends { name: string }>(rows: T[], searchTerm: string): T[] {
  const t = searchTerm.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(t));
}

/** Account D1 databases (wrangler d1 list equivalent). */
export async function fetchPaletteD1Databases(
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<{ name: string; uuid?: string; bound?: boolean }[]> {
  const catalog = await fetchPaletteCloudflareCatalog(workspaceFetchInit);
  if (catalog?.ok && Array.isArray(catalog.d1) && catalog.d1.length) {
    return catalog.d1.map((db) => ({
      name: db.name,
      uuid: db.id,
      bound: db.bound,
    }));
  }

  const fromKeys = await fetchJsonWithInit<{ ok?: boolean; databases?: CfD1Row[] }>(
    '/api/settings/keys/cloudflare/d1',
    workspaceFetchInit,
  );
  if (fromKeys?.ok && Array.isArray(fromKeys.databases) && fromKeys.databases.length) {
    return fromKeys.databases
      .map((db) => ({
        name: String(db.name || '').trim(),
        uuid: db.uuid != null ? String(db.uuid) : db.id != null ? String(db.id) : undefined,
      }))
      .filter((db) => db.name);
  }

  const fromRemote = await fetchJsonWithInit<{ ok?: boolean; databases?: CfD1Row[] }>(
    '/api/data-plane/customer-cloudflare/d1-databases',
    workspaceFetchInit,
  );
  if (!fromRemote?.ok || !Array.isArray(fromRemote.databases)) return [];
  return fromRemote.databases
    .map((db) => ({
      name: String(db.name || '').trim(),
      uuid: db.uuid != null ? String(db.uuid) : db.id != null ? String(db.id) : undefined,
    }))
    .filter((db) => db.name);
}

export async function fetchPaletteHyperdriveConfigs(
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<{ id: string; name: string; bound?: boolean }[]> {
  const catalog = await fetchPaletteCloudflareCatalog(workspaceFetchInit);
  if (catalog?.ok && Array.isArray(catalog.hyperdrive)) {
    return catalog.hyperdrive.filter((c) => c.id || c.name);
  }
  const remote = await fetchJsonWithInit<{ ok?: boolean; configs?: { id?: string; name?: string }[] }>(
    '/api/data-plane/customer-cloudflare/hyperdrive-configs',
    workspaceFetchInit,
  );
  if (!remote?.ok || !Array.isArray(remote.configs)) return [];
  return remote.configs
    .map((c) => ({
      id: String(c.id || '').trim(),
      name: String(c.name || c.id || '').trim(),
    }))
    .filter((c) => c.id || c.name);
}

export async function fetchPaletteVectorizeIndexes(
  workspaceFetchInit: WorkspaceFetchInit,
): Promise<{ name: string; description?: string | null; bound?: boolean }[]> {
  const catalog = await fetchPaletteCloudflareCatalog(workspaceFetchInit);
  if (catalog?.ok && Array.isArray(catalog.vectorize)) {
    return catalog.vectorize.filter((i) => i.name);
  }
  const remote = await fetchJsonWithInit<{ ok?: boolean; indexes?: { name?: string; description?: string }[] }>(
    '/api/data-plane/customer-cloudflare/vectorize-indexes',
    workspaceFetchInit,
  );
  if (!remote?.ok || !Array.isArray(remote.indexes)) return [];
  return remote.indexes
    .map((i) => ({
      name: String(i.name || '').trim(),
      description: i.description != null ? String(i.description) : null,
    }))
    .filter((i) => i.name);
}

export type PaletteR2BucketRow = { name: string; bound: boolean };

/** Remote R2 bucket names for the connected account. */
export async function fetchPaletteR2Buckets(
  workspaceFetchInit: WorkspaceFetchInit,
  activeWorkspace: { id?: string; slug?: string | null } | null,
): Promise<PaletteR2BucketRow[]> {
  const catalog = await fetchPaletteCloudflareCatalog(workspaceFetchInit);
  if (catalog?.ok && Array.isArray(catalog.r2) && catalog.r2.length) {
    return catalog.r2.map((b) => ({
      name: b.name,
      bound: !!b.bound,
    }));
  }

  const wantAll = isPlatformWorkspace(activeWorkspace);
  const listUrl = wantAll
    ? '/api/r2/list?buckets=true&all=true'
    : '/api/r2/list?buckets=true';

  const fromList = await fetchJsonWithInit<{
    buckets?: string[];
    bound?: string[];
    bucket_names?: string[];
  }>(listUrl, workspaceFetchInit);

  const bound = new Set(
    (fromList?.bound || []).map((n) => String(n).toLowerCase()).filter(Boolean),
  );
  const names = (fromList?.buckets || fromList?.bucket_names || []).map(String).filter(Boolean);

  if (names.length) {
    return names.map((name) => ({
      name,
      bound: bound.has(name.toLowerCase()),
    }));
  }

  const fromCf = await fetchJsonWithInit<{ ok?: boolean; buckets?: CfR2Row[] }>(
    '/api/data-plane/customer-cloudflare/r2-buckets',
    workspaceFetchInit,
  );
  if (!fromCf?.ok || !Array.isArray(fromCf.buckets)) return [];
  return fromCf.buckets
    .map((b) => String(b.name || '').trim())
    .filter(Boolean)
    .map((name) => ({ name, bound: false }));
}

export function filterPaletteR2Buckets(
  rows: PaletteR2BucketRow[],
  searchTerm: string,
): PaletteR2BucketRow[] {
  const t = searchTerm.toLowerCase();
  const filtered = t ? rows.filter((r) => r.name.toLowerCase().includes(t)) : rows;
  const bound = filtered.filter((r) => r.bound);
  const rest = filtered.filter((r) => !r.bound).sort((a, b) => a.name.localeCompare(b.name));
  return [...bound, ...rest];
}

export { filterByTerm };
