import type { DatabaseD1Resource, DatabaseSupabaseProject } from '../hooks/useDatabaseResources';
import type { DatabaseResourceOption } from './DatabaseResourcePicker';
import { isPlatformD1Source } from './preferD1Resource';

export const PLATFORM_SUPABASE_RESOURCE_VALUE = 'platform_supabase';

export type PlatformSupabaseResource = {
  name: string;
  ref: string;
  region?: string | null;
};

export function d1ResourceOptions(resources: DatabaseD1Resource[]): DatabaseResourceOption[] {
  return resources
    .filter((row) => String(row.database_name || '').trim())
    .map((row) => {
      const id = String(row.database_id || row.database_name).trim();
      const name = String(row.database_name).trim();
      const tables =
        typeof row.num_tables === 'number' && Number.isFinite(row.num_tables) ? `${row.num_tables} tables` : '';
      return {
        value: id,
        label: name,
        subtitle: [tables, isPlatformD1Source(row.source) ? 'Cloudflare D1' : 'Connected D1']
          .filter(Boolean)
          .join(' · '),
        meta: row.database_id && row.database_id !== name ? row.database_id.slice(0, 8) : undefined,
      };
    });
}

export function supabaseResourceOptions(input: {
  isSuperadmin: boolean;
  platform?: PlatformSupabaseResource | null;
  projects: DatabaseSupabaseProject[];
}): DatabaseResourceOption[] {
  const out: DatabaseResourceOption[] = [];
  const seen = new Set<string>();
  const platformRef = input.platform?.ref?.trim() || '';

  if (input.isSuperadmin && input.platform?.name) {
    out.push({
      value: PLATFORM_SUPABASE_RESOURCE_VALUE,
      label: input.platform.name,
      subtitle: [input.platform.ref, input.platform.region ? `Supabase · ${input.platform.region}` : 'Supabase Postgres']
        .filter(Boolean)
        .join(' · '),
      meta: platformRef ? platformRef.slice(0, 8) : undefined,
    });
    if (platformRef) seen.add(platformRef.toLowerCase());
  }

  for (const project of input.projects) {
    const ref = String(project.ref || '').trim();
    if (!ref || seen.has(ref.toLowerCase())) continue;
    seen.add(ref.toLowerCase());
    out.push({
      value: ref,
      label: String(project.name || ref).trim(),
      subtitle: [ref, project.region ? `Supabase · ${project.region}` : 'Supabase'].filter(Boolean).join(' · '),
      meta: ref.slice(0, 8),
    });
  }

  return out;
}

export function supabasePickerValue(studioSection: string, supabaseProjectRef: string): string {
  if (studioSection === PLATFORM_SUPABASE_RESOURCE_VALUE) return PLATFORM_SUPABASE_RESOURCE_VALUE;
  return supabaseProjectRef;
}
