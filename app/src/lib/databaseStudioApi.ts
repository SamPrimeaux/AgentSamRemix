import type { DatabaseTableMeta } from './databaseStudioModels';

export async function fetchDatabaseJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export function isTransientDatabaseFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network|load failed|aborted|timed out|timeout/i.test(message);
}

export function databaseTableApiPath(
  table: DatabaseTableMeta | { name: string; table_schema?: string },
  datasource: 'd1' | 'supabase',
  suffix: string,
  connectedProjectRef = '',
) {
  const base = datasource === 'd1' ? '/api/d1/table' : '/api/hyperdrive/table';
  const schema = table.table_schema?.trim();
  if (datasource === 'supabase' && !schema) {
    throw new Error('Select a Supabase schema before loading table data.');
  }
  if (datasource === 'supabase' && connectedProjectRef.trim()) {
    return `/api/data-plane/customer-supabase/table/${encodeURIComponent(table.name)}/${suffix}?schema=${encodeURIComponent(schema)}&project_ref=${encodeURIComponent(connectedProjectRef.trim())}`;
  }
  const query = datasource === 'supabase'
    ? `?schema=${encodeURIComponent(schema)}&resource_ref=platform_supabase`
    : '';
  return `${base}/${encodeURIComponent(table.name)}/${suffix}${query}`;
}
