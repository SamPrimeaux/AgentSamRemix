import { useCallback, useEffect, useState } from 'react';
import { buildCmsPath, writeStoredCmsProjectSlug } from '../pages/cms/cmsRoute';

export type CmsWorkspaceSite = {
  slug: string;
  name?: string;
  domain?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  page_count?: number;
  source?: string;
  target_workspace_id?: string | null;
  is_featured?: boolean;
  hub_priority?: number;
  cms_hosting?: 'platform' | 'client_worker' | null;
  updated_at?: string | number | null;
};

export type CmsWorkspaceContext = {
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_slug: string | null;
  ui_label: string | null;
  project_slug: string | null;
  project_name: string | null;
  resolved_from: string | null;
  bootstrap_cache_key: string | null;
  bootstrap_id: string | null;
  sites: CmsWorkspaceSite[];
  cms_hosting?: 'platform' | 'client_worker';
  api_profile?: string | null;
  studio_url?: string | null;
  bridge_supported?: boolean;
  worker_base_url?: string | null;
  public_domain?: string | null;
  r2_bucket?: string | null;
  d1_database_id?: string | null;
  agent_site_context?: Record<string, unknown> | null;
  is_operator_hub?: boolean;
  error?: string | null;
};

type UseCmsWorkspaceContextOptions = {
  workspaceId?: string | null;
  siteSlug?: string | null;
  enabled?: boolean;
};

/** API must return an array — guard object/map payloads that break `.find`. */
export function normalizeCmsSitesList(raw: unknown): CmsWorkspaceSite[] {
  if (Array.isArray(raw)) {
    return raw.filter((s) => s && typeof s === 'object' && trimSlug(s.slug));
  }
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw as Record<string, unknown>);
    const asSites = vals.filter(
      (v): v is CmsWorkspaceSite =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as CmsWorkspaceSite).slug === 'string' &&
        Boolean(trimSlug((v as CmsWorkspaceSite).slug)),
    );
    if (asSites.length) return asSites;
  }
  return [];
}

function trimSlug(v: unknown): string {
  return v != null ? String(v).trim() : '';
}

function normalizeWorkspaceContextPayload(
  data: CmsWorkspaceContext & { error?: string; message?: string },
): CmsWorkspaceContext & { error?: string; message?: string } {
  return {
    ...data,
    sites: normalizeCmsSitesList(data.sites),
  };
}

export function useCmsWorkspaceContext(opts: UseCmsWorkspaceContextOptions = {}) {
  const [context, setContext] = useState<CmsWorkspaceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (opts.enabled === false) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (opts.siteSlug) qs.set('site', opts.siteSlug);
      const ws = trimSlug(opts.workspaceId);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ws) headers['X-IAM-Workspace-Id'] = ws;
      const res = await fetch(`/api/cms/workspace-context${qs.size ? `?${qs}` : ''}`, {
        credentials: 'include',
        cache: 'no-store',
        headers,
      });
      const data = normalizeWorkspaceContextPayload(
        (await res.json()) as CmsWorkspaceContext & { error?: string; message?: string },
      );
      if (!res.ok) {
        setContext(data);
        setError(data.error || data.message || res.statusText);
        return;
      }
      setContext(data);
      if (data.project_slug && opts.workspaceId) {
        writeStoredCmsProjectSlug(opts.workspaceId, data.project_slug);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CMS workspace context');
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [opts.enabled, opts.siteSlug, opts.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistSite = useCallback(
    async (projectSlug: string) => {
      const ws = trimSlug(opts.workspaceId);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ws) headers['X-IAM-Workspace-Id'] = ws;
      const res = await fetch('/api/cms/workspace-context', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ project_slug: projectSlug }),
      });
      const data = normalizeWorkspaceContextPayload(
        (await res.json()) as CmsWorkspaceContext & { error?: string },
      );
      if (!res.ok) throw new Error(data.error || res.statusText);
      setContext(data);
      if (opts.workspaceId) writeStoredCmsProjectSlug(opts.workspaceId, projectSlug);
      return data;
    },
    [opts.workspaceId],
  );

  return {
    context,
    loading,
    error,
    reload: load,
    persistSite,
    pagesPath: (pageId?: string | null) =>
      buildCmsPath({
        panel: 'pages',
        pageId,
        siteSlug: context?.project_slug || opts.siteSlug || null,
      }),
  };
}
