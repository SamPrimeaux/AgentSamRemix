import { useCallback, useEffect, useState } from 'react';

export type CmsLinkedProject = {
  id: string;
  name: string;
  cover_image_url?: string | null;
  metadata_json?: string | Record<string, unknown> | null;
  status?: string | null;
  project_type?: string | null;
};

function normalizeSlug(v: unknown): string {
  return v == null ? '' : String(v).trim().toLowerCase();
}

function projectMatchesSite(
  row: {
    id?: string;
    name?: string;
    metadata_json?: string | Record<string, unknown> | null;
    domain?: string | null;
  },
  siteSlug: string,
): boolean {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return false;
  const id = normalizeSlug(row.id).replace(/^proj_/, '');
  if (id === slug) return true;
  if (normalizeSlug(row.id) === slug) return true;
  if (normalizeSlug(row.domain) === slug) return true;
  let meta: Record<string, unknown> = {};
  try {
    meta =
      typeof row.metadata_json === 'string'
        ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
        : (row.metadata_json as Record<string, unknown>) || {};
  } catch {
    meta = {};
  }
  const cmsSlug = normalizeSlug(meta.cms_site_slug || meta.cmsSiteSlug || meta.project_slug);
  if (cmsSlug && cmsSlug === slug) return true;
  return normalizeSlug(row.name).replace(/\s+/g, '-') === slug;
}

export function useCmsLinkedProject(siteSlug: string | null | undefined, enabled = true) {
  const [project, setProject] = useState<CmsLinkedProject | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && siteSlug));

  const refresh = useCallback(async () => {
    const slug = normalizeSlug(siteSlug);
    if (!enabled || !slug) {
      setProject(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/projects/overview?scope=tenant&include_archived=1', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects?: Array<Record<string, unknown>> };
      const rows = Array.isArray(data.projects) ? data.projects : [];
      const match = rows.find((row) => projectMatchesSite(row, slug));
      if (match?.id) {
        setProject({
          id: String(match.id),
          name: String(match.name || match.id),
          cover_image_url: (match.cover_image_url as string | null | undefined) ?? null,
          metadata_json: (match.metadata_json as string | Record<string, unknown> | null | undefined) ?? null,
          status: (match.status as string | null | undefined) ?? null,
          project_type: (match.project_type as string | null | undefined) ?? null,
        });
      } else {
        setProject(null);
      }
    } catch {
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, siteSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { project, loading, refresh };
}
