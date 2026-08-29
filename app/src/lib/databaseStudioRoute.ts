/** SQL explorer entry for platform workspace (inneranimalmedia-business via env.DB). */
export const PLATFORM_DATABASE_STUDIO_PATH = '/dashboard/database?studio=1';

export type DatabaseStudioDatasource = 'd1' | 'supabase';
export type DatabaseStudioSection = 'd1' | 'platform_supabase' | 'connected_supabase';

/** Only the explicit legacy flag may opt the bare /dashboard/database route into Studio. */
export function isLegacyDatabaseStudioSearch(params: Pick<URLSearchParams, 'get'>): boolean {
  return params.get('studio') === '1';
}

export function databaseStudioExplorePath(opts: {
  source: 'd1' | 'supabase';
  resourceRef: string;
  resourceScope?: 'platform' | 'connected';
  query?: string;
}): string {
  const q = new URLSearchParams({ studio: '1', source: opts.source });
  if (opts.resourceScope) q.set('resource_scope', opts.resourceScope);
  if (opts.resourceRef) q.set('resource_ref', opts.resourceRef);
  if (opts.query) q.set('q', opts.query);
  return `/dashboard/database?${q.toString()}`;
}

export function parseDatabaseStudioSection(value: string | null): DatabaseStudioSection | null {
  if (value === 'd1') return 'd1';
  if (value === 'supabase') return 'platform_supabase';
  if (value === 'platform_supabase' || value === 'connected_supabase') return value;
  return null;
}

/** A named D1 route selects the initial resource, not the datasource forever. */
export function resolveDatabaseStudioDatasource(
  section: DatabaseStudioSection,
  fallback: DatabaseStudioDatasource = 'd1',
): DatabaseStudioDatasource {
  if (section === 'd1') return 'd1';
  if (section === 'platform_supabase' || section === 'connected_supabase') return 'supabase';
  return fallback;
}

/** Resolve Database Studio path for the active workspace (named URL when collab D1 exists). */
export function databaseStudioPathFromName(databaseName?: string | null): string {
  const name = databaseName?.trim();
  if (name) return `/dashboard/database/${encodeURIComponent(name)}`;
  return PLATFORM_DATABASE_STUDIO_PATH;
}

/** Collab D1 database_name for this workspace, if any. */
export function expectedDatabaseNameForWorkspace(row?: {
  database_studio_name?: string | null;
  slug?: string | null;
  github_repo?: string | null;
} | null): string | null {
  const fromCatalog = row?.database_studio_name?.trim();
  if (fromCatalog) return fromCatalog;
  const slug = row?.slug?.trim();
  if (slug && slug !== 'inneranimalmedia' && slug !== 'inneranimalmedia-mcp') {
    return slug;
  }
  const repo = row?.github_repo?.trim();
  if (repo) {
    const short = repo.includes('/') ? repo.split('/').pop()?.trim() : repo;
    if (short && short !== 'inneranimalmedia') return short;
  }
  return null;
}

export function databaseStudioPathForWorkspace(row?: {
  database_studio_name?: string | null;
  slug?: string | null;
  github_repo?: string | null;
  id?: string | null;
} | null): string {
  const name = expectedDatabaseNameForWorkspace(row);
  if (name) return databaseStudioPathFromName(name);
  if (isPlatformWorkspace(row)) return PLATFORM_DATABASE_STUDIO_PATH;
  return PLATFORM_DATABASE_STUDIO_PATH;
}

export function isPlatformWorkspace(row?: { slug?: string | null; id?: string | null } | null): boolean {
  const slug = row?.slug?.trim().toLowerCase();
  return slug === 'inneranimalmedia' || slug === 'inneranimalmedia-mcp';
}

/** Workspace collab R2 bucket name when not on platform workspace. */
export function expectedR2BucketForWorkspace(row?: {
  database_studio_name?: string | null;
  slug?: string | null;
  github_repo?: string | null;
} | null): string | null {
  if (isPlatformWorkspace(row)) return null;
  return expectedDatabaseNameForWorkspace(row);
}
