import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useWorkspace } from '../../../src/context/WorkspaceContext';

export type DatabasesSurface = 'cloudflare' | 'supabase';
export type DatabasesRange = '1h' | '24h' | '7d' | '30d';

/** @deprecated use DatabasesSurface */
export type DatabasesDs = 'all' | 'd1' | 'supabase';

export type DatabasesWarning = {
  code: string;
  message: string;
  severity?: string;
};

export type KpiMetric = {
  value: number;
  valueMs?: number;
  valueLabel?: string | null;
  trendPct: number;
  dir: 'up' | 'down' | 'neutral';
  wired: boolean;
};

export type CapacityMetric = {
  usedBytes?: number | null;
  limitBytes: number;
  usedLabel?: string | null;
  limitLabel: string;
  pctUsed?: number | null;
  level?: 'ok' | 'watch' | 'action' | 'critical' | 'unknown';
  subtitle?: string | null;
  subtitleOk?: boolean;
  retentionAt?: number | null;
  retentionOk?: boolean | null;
  autovacuumAt?: number | null;
  connectionsUsed?: number | null;
  connectionsMax?: number | null;
  hyperdriveStatus?: string | null;
  hyperdriveLatencyMs?: number | null;
  wired?: boolean;
};

export type DatabasesQueryRow = {
  fingerprint: string;
  tool_name: string;
  datasource: 'd1' | 'supabase';
  call_count: number;
  runtime_pct: number;
  avg_ms: number;
  p50_ms: number;
  p99_ms: number;
  rows_read: number;
  rows_written?: number;
  rows_per_run: number;
  errors: number;
  last_seen: number | null;
};

export type HotTable = { name: string; val: string; ds: 'd1' | 'supabase' };

export type LargeObjectRow = { name: string; size: string; pct: string };

export type StorageBreakdown = {
  usedBytes?: number | null;
  limitBytes?: number;
  usedLabel?: string | null;
  limitLabel?: string;
  pctUsed?: number | null;
  tableCount?: number | null;
  connections?: number | null;
  largeObjects?: LargeObjectRow[];
  wired?: boolean;
};

export type SchemaHealthPayload = {
  noPrimaryKey?: Array<{ name: string; ds?: string; severity?: string }>;
  missingIndexes?: Array<{ name: string; ds?: string; severity?: string }>;
  fkIssues?: Array<{ name?: string; table_name?: string; conname?: string }>;
  wired?: boolean;
};

export type DatabasesOverviewPayload = {
  ok: boolean;
  surface?: DatabasesSurface;
  range: string;
  wired?: boolean;
  database?: { id: string; name: string };
  summary?: { state?: string; surface?: string };
  kpis?: {
    queries?: KpiMetric;
    rowsRead?: KpiMetric;
    rowsWritten?: KpiMetric;
    storage?: KpiMetric;
    tables?: KpiMetric;
    connections?: KpiMetric;
    p95?: KpiMetric;
    errors?: KpiMetric;
  };
  capacity?: CapacityMetric;
  charts?: {
    labels: string[];
    totalQueries: number[];
    readQueries: number[];
    writeQueries: number[];
    rowsRead: number[];
    rowsWritten: number[];
    latencyP50: number[];
    latencyP95: number[];
    latencyP99: number[];
    headlineMs: { p50: number; p95: number; p99: number };
  };
  queries?: DatabasesQueryRow[];
  storage?: StorageBreakdown;
  hotTables?: {
    largest?: HotTable[];
    mostRead?: HotTable[];
    mostWritten?: HotTable[];
  };
  schemaHealth?: SchemaHealthPayload;
  health?: { hyperdrive?: string; latencyMs?: number | null };
  warnings?: DatabasesWarning[];
};

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function fetchJson<T>(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal,
      headers: headers ? { ...headers } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return null;
    return null;
  }
}

function cacheKey(surface: DatabasesSurface, range: DatabasesRange, resourceRef: string) {
  return `iam.db.overview.v4:${surface}:${resourceRef || '_'}:${range}`;
}

export function prefetchDatabasesOverview(
  surface: DatabasesSurface,
  range: DatabasesRange,
  resourceRef = '',
) {
  if (readOverviewCache(surface, range, resourceRef)) return;
  const q = new URLSearchParams({ range, surface });
  if (resourceRef) q.set('database_id', resourceRef);
  void fetchJson<DatabasesOverviewPayload>(`/api/analytics/databases/overview?${q}`).then((data) => {
    if (data?.ok && matchesScope(data, surface, range, resourceRef)) {
      writeOverviewCache(surface, range, resourceRef, data);
    }
  });
}

function matchesScope(
  data: DatabasesOverviewPayload | null | undefined,
  surface: DatabasesSurface,
  range: DatabasesRange,
  resourceRef = '',
): boolean {
  if (!data?.ok) return false;
  if (data.surface && data.surface !== surface) return false;
  if (data.range && data.range !== range) return false;
  if (surface === 'cloudflare' && resourceRef && data.database?.id && data.database.id !== resourceRef) {
    return false;
  }
  return true;
}

function readOverviewCache(
  surface: DatabasesSurface,
  range: DatabasesRange,
  resourceRef = '',
): DatabasesOverviewPayload | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(surface, range, resourceRef));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; data?: DatabasesOverviewPayload };
    if (!parsed?.data || !parsed.at || Date.now() - parsed.at > 300_000) return null;
    if (!matchesScope(parsed.data, surface, range, resourceRef)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeOverviewCache(
  surface: DatabasesSurface,
  range: DatabasesRange,
  resourceRef: string,
  data: DatabasesOverviewPayload,
) {
  try {
    sessionStorage.setItem(cacheKey(surface, range, resourceRef), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* ignore quota errors */
  }
}

export function formatCompact(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function formatTrend(pct: number, dir: string): string {
  const sign = dir === 'down' ? '−' : dir === 'up' ? '+' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function formatQueryMs(ms: number): string {
  const v = Number(ms) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  if (v < 10) return `${v.toFixed(2)}ms`;
  return `${Math.round(v)}ms`;
}

export function formatRelativeSeen(epochSec: number | null): string {
  if (!epochSec) return '—';
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - epochSec);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function useDatabasesObservability(
  surface: DatabasesSurface,
  range: DatabasesRange,
  resourceRef = '',
) {
  const { workspaceId, workspaces } = useWorkspace();
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const wsHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    const ws = workspaceId?.trim();
    if (ws) h['X-IAM-Workspace-Id'] = ws;
    const dbName = activeWorkspace?.database_studio_name?.trim();
    if (dbName) h['X-IAM-Database-Name'] = dbName;
    return h;
  }, [workspaceId, activeWorkspace?.database_studio_name]);

  const [overview, setOverview] = useState<DatabasesOverviewPayload | null>(() =>
    readOverviewCache(surface, range, resourceRef),
  );
  const [queryRows, setQueryRows] = useState<DatabasesQueryRow[]>(() =>
    readOverviewCache(surface, range, resourceRef)?.queries ?? [],
  );
  const [queriesLoading, setQueriesLoading] = useState(false);
  const [loading, setLoading] = useState(() => !readOverviewCache(surface, range, resourceRef));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const overviewRef = useRef(overview);
  overviewRef.current = overview;

  const loadQueries = useCallback(async (opts?: { signal?: AbortSignal }) => {
    setQueriesLoading(true);
    const q = new URLSearchParams({ range, surface });
    try {
      const data = await fetchJson<{ ok?: boolean; queries?: DatabasesQueryRow[] }>(
        `/api/analytics/databases/queries?${q}`,
        opts?.signal,
        wsHeaders,
      );
      if (opts?.signal?.aborted) return;
      if (data?.ok && Array.isArray(data.queries)) {
        setQueryRows(data.queries);
      }
    } finally {
      if (!opts?.signal?.aborted) setQueriesLoading(false);
    }
  }, [surface, range, wsHeaders]);

  const load = useCallback(async (opts?: { background?: boolean; signal?: AbortSignal }) => {
    const background = opts?.background === true;
    if (!background) {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    const q = new URLSearchParams({ range, surface });
    if (resourceRef) q.set('database_id', resourceRef);
    try {
      const data = await fetchJson<DatabasesOverviewPayload>(
        `/api/analytics/databases/overview?${q}`,
        opts?.signal,
        wsHeaders,
      );
      if (opts?.signal?.aborted) return;
      if (data?.ok && matchesScope(data, surface, range, resourceRef)) {
        setOverview(data);
        if (surface === 'cloudflare') {
          setQueryRows(data.queries ?? []);
        }
        writeOverviewCache(surface, range, resourceRef, data);
        setError(null);
      } else if (!background && !overviewRef.current) {
        setError('Could not load database analytics.');
      }
    } finally {
      if (!background) setLoading(false);
      if (!opts?.signal?.aborted) setRefreshing(false);
    }
  }, [surface, range, resourceRef, wsHeaders]);

  useEffect(() => {
    const cached = readOverviewCache(surface, range, resourceRef);
    setOverview(cached);
    setQueryRows(cached?.queries ?? []);
    setLoading(!cached);
    setError(null);
    const controller = new AbortController();
    void load({ background: Boolean(cached), signal: controller.signal });
    return () => controller.abort();
  }, [load, surface, range, resourceRef]);

  useEffect(() => {
    if (surface === 'cloudflare') {
      setQueryRows(overview?.queries ?? []);
      return;
    }
    if (!overview) return;
    const controller = new AbortController();
    void loadQueries({ signal: controller.signal });
    return () => controller.abort();
  }, [loadQueries, overview, surface, range]);

  const alertWarnings = useMemo(() => {
    const codes = new Set<string>();
    const out: DatabasesWarning[] = [];
    for (const w of overview?.warnings ?? []) {
      if (codes.has(w.code)) continue;
      const sev = String(w.severity || 'info').toLowerCase();
      if (sev !== 'warn' && sev !== 'error') continue;
      codes.add(w.code);
      out.push(w);
    }
    return out;
  }, [overview]);

  const warnings = useMemo(() => overview?.warnings ?? [], [overview]);

  const charts = overview?.charts;
  const hasChartData = Boolean(
    charts?.totalQueries?.some((v) => v > 0) ||
      charts?.readQueries?.some((v) => v > 0) ||
      charts?.writeQueries?.some((v) => v > 0),
  );

  const sparks = useMemo(
    () => ({
      queries: charts?.totalQueries ?? [],
      rowsRead: charts?.rowsRead ?? [],
      rowsWritten: charts?.rowsWritten ?? [],
      p95: charts?.latencyP95 ?? [],
    }),
    [charts],
  );

  return {
    overview,
    summary: overview,
    charts,
    sparks,
    capacity: overview?.capacity ?? null,
    queryPerformance: {
      wired: Boolean(queryRows.length),
      rows: queryRows,
    },
    storage: overview?.storage ?? { wired: false },
    hotTables: overview?.hotTables ?? { largest: [], mostRead: [], mostWritten: [] },
    schemaHealth: overview?.schemaHealth ?? { wired: false },
    health: overview?.health,
    database: overview?.database,
    loading: loading && !overview,
    refreshing,
    error: error && !overview ? error : null,
    warnings,
    alertWarnings,
    live: {
      kpis: Boolean(overview?.wired && overview?.kpis?.queries?.wired),
      charts: hasChartData,
    },
    refresh: () => {
      void load({ background: Boolean(overviewRef.current) });
      if (surface !== 'cloudflare') void loadQueries();
    },
    queriesLoading,
  };
}
