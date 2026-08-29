import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';
import { cancelCadJob, deleteMeshyCadTask } from '../api';
import { designStudioBimGalleryItem } from '../../../lib/designStudioBimExample';
import type { GalleryItem } from './cadStudioTypes';

type AssetRow = {
  id?: string;
  label?: string;
  public_url?: string;
  thumbnail_url?: string;
  scale?: number;
  created_at?: number;
};

type JobRow = {
  id: string;
  engine?: string;
  prompt?: string;
  public_url?: string | null;
  result_url?: string | null;
  thumbnail_url?: string | null;
  status?: string;
  created_at?: number;
  progress_pct?: number;
};

type MeshyTaskRow = {
  id?: string;
  task_id?: string;
  prompt?: string;
  public_url?: string;
  thumbnail_url?: string;
  thumbnail?: string;
  model_urls?: { thumbnail?: string; glb?: string };
  status?: string;
  created_at?: number;
  progress_pct?: number;
};

export type UseStudioGalleryOpts = {
  /** Entry screen: jobs only on mount. Full studio: load everything. */
  mode?: 'entry' | 'full';
  autoFetch?: boolean;
};

function meshyThumbnail(row: MeshyTaskRow): string | undefined {
  const direct = normalizeUrl(row.thumbnail_url || row.thumbnail);
  if (direct) return direct;
  const nested = normalizeUrl(row.model_urls?.thumbnail);
  return nested || undefined;
}

function normalizeUrl(url?: string | null): string {
  if (!url) return '';
  return String(url).trim();
}

function isTerminalJobStatus(status?: string | null): boolean {
  const st = String(status || '').toLowerCase();
  return st === 'done' || st === 'complete' || st === 'completed' || st === 'succeeded' || st === 'success';
}

function isActiveJobStatus(status?: string | null): boolean {
  const st = String(status || '').toLowerCase();
  if (st === 'cancelled' || st === 'failed' || st === 'canceled') return false;
  return (
    st === 'pending' ||
    st === 'queued' ||
    st === 'running' ||
    st === 'processing' ||
    st === 'in_progress' ||
    st === 'script_ready'
  );
}

function shouldIncludeJobRow(row: JobRow): boolean {
  const url = normalizeGlbUrl(normalizeUrl(row.public_url || row.result_url));
  const st = String(row.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'canceled') return false;
  if (url) return true;
  return isActiveJobStatus(st);
}

function jobRowToGalleryItem(row: JobRow): GalleryItem {
  const url = normalizeGlbUrl(normalizeUrl(row.public_url || row.result_url));
  const st = String(row.status || '').toLowerCase();
  const terminal = isTerminalJobStatus(st);
  const pending = isActiveJobStatus(st) && !terminal;
  return {
    id: `job_${row.id}`,
    cadJobId: row.id,
    name: row.prompt?.slice(0, 48) || `${row.engine || 'CAD'} export`,
    url: url || '',
    thumbnail: row.thumbnail_url,
    source: 'job',
    createdAt: row.created_at,
    pending,
    status: row.status,
    progressPct: typeof row.progress_pct === 'number' ? row.progress_pct : undefined,
  };
}

function dedupeGallery(items: GalleryItem[]): GalleryItem[] {
  const sorted = [...items].sort((a, b) => {
    if (a.source === 'job' && b.source === 'meshy') return -1;
    if (a.source === 'meshy' && b.source === 'job') return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  const seen = new Set<string>();
  const out: GalleryItem[] = [];
  for (const item of sorted) {
    const key = item.cadJobId || item.externalTaskId || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function prependFeaturedStock(items: GalleryItem[]): GalleryItem[] {
  const featured = designStudioBimGalleryItem();
  const withoutDup = items.filter(
    (item) =>
      item.id !== featured.id &&
      !String(item.url || '').includes('cadj_bimexample311065'),
  );
  return dedupeGallery([featured, ...withoutDup]);
}

export type GallerySourceFilter = 'all' | 'stock' | 'mine' | 'job' | 'meshy';

export function resolveGalleryCadJobId(item: GalleryItem): string | null {
  if (item.cadJobId?.trim()) return item.cadJobId.trim();
  if (item.id.startsWith('job_')) return item.id.slice(4);
  return null;
}

export function useStudioGallery(opts: UseStudioGalleryOpts = {}) {
  const mode = opts.mode ?? 'full';
  const autoFetch = opts.autoFetch ?? true;

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(mode === 'full');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<GallerySourceFilter>('all');

  const parseAssets = useCallback((data: unknown, source: 'stock' | 'mine') => {
    const rows = Array.isArray((data as { results?: unknown[] })?.results)
      ? (data as { results: AssetRow[] }).results
      : [];
    const out: GalleryItem[] = [];
    for (const row of rows) {
      const url = normalizeGlbUrl(normalizeUrl(row.public_url));
      if (!url) continue;
      out.push({
        id: `${source}_${String(row.id || url)}`,
        name: String(row.label || row.id || 'Asset'),
        url,
        thumbnail: row.thumbnail_url,
        source,
        scale: typeof row.scale === 'number' ? row.scale : 1,
        createdAt: row.created_at,
      });
    }
    return out;
  }, []);

  const fetchJobs = useCallback(async () => {
    const merged: GalleryItem[] = [];
    const jobsRes = await fetch('/api/cad/jobs?limit=50', { credentials: 'include' });
    if (jobsRes.ok) {
      const data = await jobsRes.json();
      const rows = Array.isArray(data?.jobs) ? data.jobs : [];
      for (const row of rows as JobRow[]) {
        if (!shouldIncludeJobRow(row)) continue;
        merged.push(jobRowToGalleryItem(row));
      }
    }

    if (mode === 'full') {
      const meshyRes = await fetch('/api/cad/meshy/tasks?page_size=20', { credentials: 'include' });
      if (meshyRes.ok) {
        const data = await meshyRes.json();
        const rows = Array.isArray(data?.tasks)
          ? data.tasks
          : Array.isArray(data?.results)
            ? data.results
            : [];
        for (const row of rows as MeshyTaskRow[]) {
          const url = normalizeGlbUrl(normalizeUrl(row.public_url || row.model_urls?.glb));
          const st = String(row.status || '').toLowerCase();
          if (st === 'cancelled' || st === 'canceled') continue;
          const terminal = isTerminalJobStatus(st);
          if (!url && !isActiveJobStatus(st)) continue;
          const taskId = String(row.task_id || row.id || '').trim();
          merged.push({
            id: `meshy_${taskId || url || st}`,
            externalTaskId: taskId || undefined,
            taskType: 'text-to-3d',
            name: row.prompt?.slice(0, 48) || 'Meshy task',
            url: url || '',
            thumbnail: meshyThumbnail(row),
            source: 'meshy',
            createdAt: row.created_at,
            pending: !terminal && isActiveJobStatus(st),
            status: row.status,
            progressPct: typeof row.progress_pct === 'number' ? row.progress_pct : undefined,
          });
        }
      }
    }

    return merged;
  }, [mode]);

  const fetchAssets = useCallback(async () => {
    const merged: GalleryItem[] = [];
    const [stockRes, userRes] = await Promise.all([
      fetch('/api/designstudio/assets?category=3d_studio&is_live=1', { credentials: 'include' }),
      fetch('/api/designstudio/assets?category=3d_studio_user&is_live=1', { credentials: 'include' }),
    ]);
    if (stockRes.ok) merged.push(...parseAssets(await stockRes.json(), 'stock'));
    if (userRes.ok) merged.push(...parseAssets(await userRes.json(), 'mine'));
    return prependFeaturedStock(merged);
  }, [parseAssets]);

  const refreshJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const jobs = await fetchJobs();
      setItems((prev) => {
        const assets = prev.filter((i) => i.source === 'stock' || i.source === 'mine');
        return dedupeGallery([...assets, ...jobs]);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchJobs]);

  const refreshAssets = useCallback(async () => {
    setAssetsLoading(true);
    setError(null);
    try {
      const assets = await fetchAssets();
      setItems((prev) => {
        const jobs = prev.filter((i) => i.source === 'job' || i.source === 'meshy');
        return dedupeGallery([...assets, ...jobs]);
      });
      setAssetsLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssetsLoading(false);
    }
  }, [fetchAssets]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobs, assets] = await Promise.all([
        fetchJobs(),
        mode === 'full' || assetsLoaded ? fetchAssets() : Promise.resolve([]),
      ]);
      setItems(dedupeGallery([...assets, ...jobs]));
      if (assets.length > 0) setAssetsLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [assetsLoaded, fetchAssets, fetchJobs, mode]);

  const dismissPending = useCallback(
    async (item: GalleryItem) => {
      const cadJobId = resolveGalleryCadJobId(item);
      if (cadJobId) {
        await cancelCadJob(cadJobId);
      } else if (item.externalTaskId) {
        await deleteMeshyCadTask(item.externalTaskId, item.taskType || 'text-to-3d');
      } else {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      await refreshJobs();
    },
    [refreshJobs],
  );

  useEffect(() => {
    if (!autoFetch) return;
    if (mode === 'entry') {
      void refreshJobs();
      return;
    }
    void refresh();
  }, [autoFetch, mode, refresh, refreshJobs]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
    });
  }, [items, filter, sourceFilter]);

  return {
    items: filtered,
    total: filtered.length,
    loading,
    assetsLoading,
    assetsLoaded,
    error,
    filter,
    setFilter,
    sourceFilter,
    setSourceFilter,
    refresh,
    refreshJobs,
    refreshAssets,
    dismissPending,
  };
}
