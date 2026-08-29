import { useCallback, useState } from 'react';

import { fetchDatabaseJson } from '../../../src/lib/databaseStudioApi';
import { pickPreferredD1Resource } from '../resources/preferD1Resource';

export type DatabaseD1Resource = {
  database_name: string;
  database_id?: string | null;
  source?: string | null;
  num_tables?: number | null;
};

export type DatabaseSupabaseProject = {
  id?: string;
  name?: string;
  ref: string;
  region?: string | null;
};

export type PlatformSupabaseResource = {
  name: string;
  ref: string;
  region?: string | null;
};

type UseDatabaseResourcesInput = {
  workspaceId?: string | null;
  databaseName?: string | null;
  initialSource?: string | null;
  initialResourceRef?: string | null;
};

export function useDatabaseResources({
  workspaceId,
  databaseName,
  initialSource,
  initialResourceRef,
}: UseDatabaseResourcesInput) {
  const [d1Resources, setD1Resources] = useState<DatabaseD1Resource[]>([]);
  const [d1ResourceId, setD1ResourceId] = useState(
    initialSource === 'd1' ? initialResourceRef || '' : '',
  );
  const [d1ResourceName, setD1ResourceName] = useState(
    databaseName?.trim() || (initialSource === 'd1' ? initialResourceRef || '' : ''),
  );
  const [d1OnboardingRequired, setD1OnboardingRequired] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [supabaseProjects, setSupabaseProjects] = useState<DatabaseSupabaseProject[]>([]);
  const [supabaseProjectRef, setSupabaseProjectRef] = useState(
    initialSource === 'supabase' ? initialResourceRef || '' : '',
  );
  const [supabaseConnectUrl, setSupabaseConnectUrl] = useState(
    '/api/oauth/supabase/start?return_to=%2Fdashboard%2Fdatabase%3Fstudio%3D1',
  );
  const [platformSupabase, setPlatformSupabase] = useState<PlatformSupabaseResource | null>(null);

  const d1FetchInit = useCallback(
    (init?: RequestInit): RequestInit => {
      const headers: Record<string, string> = {
        ...((init?.headers as Record<string, string> | undefined) || {}),
      };
      const workspace = workspaceId?.trim();
      if (workspace) headers['X-IAM-Workspace-Id'] = workspace;
      const databaseId = d1ResourceId.trim();
      const resolvedName = d1ResourceName.trim() || databaseName?.trim() || '';
      if (databaseId) headers['X-IAM-Database-Id'] = databaseId;
      if (resolvedName) headers['X-IAM-Database-Name'] = resolvedName;
      if (!workspace && !databaseId && !resolvedName) return init || {};
      return { ...init, headers };
    },
    [workspaceId, databaseName, d1ResourceId, d1ResourceName],
  );

  const fetchD1Json = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      return fetchDatabaseJson<T>(url, d1FetchInit(init));
    },
    [d1FetchInit],
  );

  const loadDataPlaneContext = useCallback(async () => {
    try {
      const context = await fetchDatabaseJson<{
        connections?: { supabase?: boolean };
        supabase_projects?: DatabaseSupabaseProject[];
        platform_supabase?: PlatformSupabaseResource | null;
        pinned_supabase_project_ref?: string | null;
        supabase_connect_url?: string;
      }>('/api/data-plane/context');
      setSupabaseConnected(context.connections?.supabase === true);
      if (context.supabase_connect_url) setSupabaseConnectUrl(context.supabase_connect_url);
      if (context.platform_supabase?.name) setPlatformSupabase(context.platform_supabase);
      const projects = Array.isArray(context.supabase_projects)
        ? context.supabase_projects.filter((project) => project?.ref)
        : [];
      setSupabaseProjects(projects);
      const pinned = (context.pinned_supabase_project_ref || '').trim();
      setSupabaseProjectRef((current) => current || pinned || '');
    } catch {
      // Context is optional; keep the current resource state.
    }
  }, []);

  const loadD1Resources = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (workspaceId?.trim()) headers['X-IAM-Workspace-Id'] = workspaceId.trim();
      const context = await fetchDatabaseJson<{
        databases?: DatabaseD1Resource[];
        active_database_name?: string | null;
      }>('/api/d1/context', { credentials: 'same-origin', headers });
      const resources = Array.isArray(context.databases)
        ? context.databases.filter((row) => String(row?.database_name || '').trim())
        : [];
      setD1Resources(resources);
      setD1OnboardingRequired(resources.length === 0);

      const fromUrl = (initialSource === 'd1' ? initialResourceRef || '' : '').trim();
      const preferred = pickPreferredD1Resource(resources, {
        fromUrl,
        databaseNameHint: databaseName || undefined,
      });

      setD1ResourceId((current) => {
        if (fromUrl) {
          const matchById = resources.find((row) => row.database_id && row.database_id === fromUrl);
          const matchByName = resources.find((row) => row.database_name === fromUrl);
          return matchById?.database_id || matchByName?.database_id || fromUrl;
        }
        const next = pickPreferredD1Resource(resources, {
          currentId: current,
          databaseNameHint: databaseName || undefined,
        });
        return next?.database_id || preferred?.database_id || '';
      });
      setD1ResourceName((current) => {
        if (fromUrl) {
          const matchById = resources.find((row) => row.database_id && row.database_id === fromUrl);
          const matchByName = resources.find((row) => row.database_name === fromUrl);
          return (
            matchById?.database_name ||
            matchByName?.database_name ||
            preferred?.database_name ||
            current
          );
        }
        const next = pickPreferredD1Resource(resources, {
          currentId: undefined,
          currentName: current,
          databaseNameHint: databaseName || undefined,
        });
        return next?.database_name || preferred?.database_name || databaseName?.trim() || '';
      });
    } catch {
      setD1Resources([]);
      if (!databaseName?.trim()) {
        setD1ResourceId('');
        setD1ResourceName('');
      }
    }
  }, [databaseName, initialResourceRef, initialSource, workspaceId]);

  return {
    d1Resources,
    d1ResourceId,
    d1ResourceName,
    d1OnboardingRequired,
    setD1ResourceId,
    setD1ResourceName,
    setD1OnboardingRequired,
    supabaseConnected,
    supabaseProjects,
    supabaseProjectRef,
    supabaseConnectUrl,
    platformSupabase,
    setSupabaseProjectRef,
    d1FetchInit,
    fetchD1Json,
    loadDataPlaneContext,
    loadD1Resources,
  };
}
