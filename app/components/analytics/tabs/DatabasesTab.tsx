import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Database, RefreshCw, ExternalLink, Search, ChevronRight, TrendingUp, TrendingDown,
  AlertCircle, AlertTriangle, BarChart2, ListFilter, Table2, Activity, ShieldAlert, Layers,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { useWorkspace } from '../../../src/context/WorkspaceContext';
import { databaseStudioExplorePath } from '../../../src/lib/databaseStudioRoute';
import { DatabaseResourcePicker } from '../../database/resources/DatabaseResourcePicker';
import { d1ResourceOptions } from '../../database/resources/databaseResourceOptions';
import {
  isPlatformD1Source,
  pickPreferredD1Resource,
} from '../../database/resources/preferD1Resource';
import type { DatabaseD1Resource } from '../../database/hooks/useDatabaseResources';

import styles from './DatabasesTab.module.css';
import {
  useDatabasesObservability,
  prefetchDatabasesOverview,
  formatCompact,
  formatTrend,
  formatQueryMs,
  type DatabasesSurface,
  type DatabasesRange,
  type DatabasesQueryRow,
  type KpiMetric,
  type CapacityMetric,
  type HotTable,
  type SchemaHealthPayload,
} from './useDatabasesObservability';

type LatencyKey = 'p50' | 'p95' | 'p99';

function chartColors(surface: DatabasesSurface) {
  if (surface === 'cloudflare') {
    return {
      primary: '#9b8afb',
      grid: 'rgba(0,0,0,0.06)',
      axis: 'rgba(0,0,0,0.35)',
      tooltip: { bg: '#ffffff', border: 'rgba(0,0,0,0.1)', title: '#6b6b80', body: '#1a1a2e' },
    };
  }
  return {
    primary: '#00d37e',
    grid: 'rgba(255,255,255,0.06)',
    axis: 'rgba(255,255,255,0.25)',
    tooltip: { bg: '#1c1c1c', border: 'rgba(255,255,255,0.1)', title: '#7a7a8a', body: '#ededed' },
  };
}

function capacityRingColor(level: string | undefined, surface: DatabasesSurface) {
  if (level === 'critical') return '#e05555';
  if (level === 'action') return '#f0a050';
  if (level === 'watch') return '#6c8fff';
  return surface === 'supabase' ? '#00d37e' : '#9b8afb';
}

function CtrlGroup<T extends string>({
  options, labels, value, onChange,
}: { options: T[]; labels?: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <div className={styles.ctrlGroup} role="tablist">
      {options.map(o => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={value === o}
          className={`${styles.ctrlBtn} ${value === o ? styles.ctrlBtnActive : ''}`}
          onClick={() => onChange(o)}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick?: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={styles.iconBtn} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => ({ i, v }));
  if (!pts.length) return null;
  return (
    <div className={styles.kpiSpark}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CapacityRing({
  capacity, loading, surface,
}: { capacity: CapacityMetric | null; loading: boolean; surface: DatabasesSurface }) {
  const pct = capacity?.pctUsed ?? 0;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const stroke = capacityRingColor(capacity?.level, surface);

  return (
    <div className={styles.capacityCard}>
      <div className={styles.kpiLabel}>Capacity</div>
      <div className={styles.capacityBody}>
        <svg viewBox="0 0 88 88" className={styles.capacityRing} aria-hidden>
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--db-surface-2)" strokeWidth="8" />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="8"
            strokeDasharray={circ}
            strokeDashoffset={loading ? circ : offset}
            strokeLinecap="round"
            transform="rotate(-90 44 44)"
          />
        </svg>
        <div className={styles.capacityCenter}>
          <div className={styles.capacityPct}>{loading ? '…' : `${pct.toFixed(1)}%`}</div>
          <div className={styles.capacityUsed}>{capacity?.usedLabel ?? '—'}</div>
        </div>
      </div>
      <div className={styles.capacityFoot}>
        {capacity?.limitLabel ? `of ${capacity.limitLabel}` : null}
      </div>
      {capacity?.subtitle ? (
        <div className={capacity.subtitleOk ? styles.capacitySubOk : styles.capacitySubWarn}>
          {capacity.subtitle}
        </div>
      ) : null}
    </div>
  );
}

type KpiDef = { id: string; label: string; key: keyof NonNullable<ReturnType<typeof useDatabasesObservability>['overview']>['kpis'] };

const CF_KPIS: KpiDef[] = [
  { id: 'queries', label: 'Total queries', key: 'queries' },
  { id: 'rowsRead', label: 'Rows read', key: 'rowsRead' },
  { id: 'rowsWritten', label: 'Rows written', key: 'rowsWritten' },
  { id: 'tables', label: 'Tables', key: 'tables' },
];

const SB_KPIS: KpiDef[] = [
  { id: 'storage', label: 'Database size', key: 'storage' },
  { id: 'tables', label: 'Tables', key: 'tables' },
  { id: 'connections', label: 'Connections', key: 'connections' },
  { id: 'queries', label: 'Agent queries', key: 'queries' },
];

function kpiDisplay(def: KpiDef, m?: KpiMetric): { value: string; trend: string; dir: 'up' | 'down' | 'neutral' } {
  if (!m?.wired) return { value: '—', trend: '—', dir: 'neutral' };
  if (def.id === 'storage' && m.valueLabel) {
    return { value: m.valueLabel, trend: formatTrend(m.trendPct, m.dir), dir: m.dir };
  }
  return {
    value: formatCompact(m.value),
    trend: formatTrend(m.trendPct, m.dir),
    dir: m.dir,
  };
}

function KpiCards({
  defs, kpis, sparks, loading, surface,
}: {
  defs: KpiDef[];
  kpis?: ReturnType<typeof useDatabasesObservability>['overview'] extends infer O ? O extends { kpis?: infer K } ? K : never : never;
  sparks: Record<string, number[]>;
  loading: boolean;
  surface: DatabasesSurface;
}) {
  const color = chartColors(surface).primary;
  return (
    <>
      {defs.map(def => {
        const m = kpis?.[def.key as keyof typeof kpis] as KpiMetric | undefined;
        const d = kpiDisplay(def, m);
        const sparkKey = def.id === 'connections' ? 'queries' : def.id;
        const trendClass =
          d.dir === 'up' ? styles.trendUp : d.dir === 'down' ? styles.trendDown : styles.trendNeutral;
        return (
          <div key={def.id} className={styles.kpiCard}>
            <div className={styles.kpiLabel}>{def.label}</div>
            <div className={styles.kpiValue}>{loading ? '…' : d.value}</div>
            <div className={styles.kpiMeta}>
              <span className={trendClass}>
                {d.dir === 'up' ? <TrendingUp size={10} /> : d.dir === 'down' ? <TrendingDown size={10} /> : null}
                {loading ? '…' : d.trend}
              </span>
              <span className={styles.kpiMetaHint}>vs prev period</span>
            </div>
            {sparks[sparkKey]?.length ? (
              <Sparkline data={sparks[sparkKey]} color={color} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function BarPanel({
  title, data, dataKey, loading, empty, surface, height = 220, legendTotal,
}: {
  title: string;
  data: { h: string; v: number }[];
  dataKey?: string;
  loading: boolean;
  empty?: string;
  surface: DatabasesSurface;
  height?: number;
  legendTotal?: string;
}) {
  const C = chartColors(surface);
  const key = dataKey ?? 'v';
  const hasData = data.some(d => d.v > 0);
  const tooltipStyle = {
    contentStyle: { background: C.tooltip.bg, border: `1px solid ${C.tooltip.border}`, borderRadius: 8, fontSize: 11 },
    labelStyle: { color: C.tooltip.title, fontSize: 10 },
    itemStyle: { color: C.tooltip.body },
  };
  return (
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}><BarChart2 size={14} /> {title}</div>
        {legendTotal ? (
          <div className={styles.legend}>
            <span className={styles.legendDot} style={{ background: C.primary }} />
            {legendTotal}
          </div>
        ) : null}
      </div>
      <div className={styles.chartBody}>
        {!loading && !hasData && empty ? (
          <div className={styles.chartEmpty} style={{ minHeight: height }}>{empty}</div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data.length ? data : [{ h: '—', v: 0 }]} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="0" stroke={C.grid} vertical={false} />
              <XAxis dataKey="h" tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} width={40} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey={key} fill={C.primary} fillOpacity={0.85} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function LatencyPanel({
  charts, loading, live, surface,
}: {
  charts: ReturnType<typeof useDatabasesObservability>['charts'];
  loading: boolean;
  live: boolean;
  surface: DatabasesSurface;
}) {
  const [key, setKey] = useState<LatencyKey>('p50');
  const C = chartColors(surface);
  const series =
    key === 'p95' ? charts?.latencyP95 : key === 'p99' ? charts?.latencyP99 : charts?.latencyP50;
  const data = useMemo(() => {
    if (!charts?.labels?.length || !series?.length) return [];
    return charts.labels.map((h, i) => ({ h, ms: series[i] ?? 0 }));
  }, [charts, series]);
  const headline = charts?.headlineMs?.[key] ?? 0;
  const hasData = data.some(d => d.ms > 0);
  const tooltipStyle = {
    contentStyle: { background: C.tooltip.bg, border: `1px solid ${C.tooltip.border}`, borderRadius: 8, fontSize: 11 },
    labelStyle: { color: C.tooltip.title, fontSize: 10 },
    itemStyle: { color: C.tooltip.body },
  };
  return (
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}><Activity size={14} /> Query latency</div>
        <CtrlGroup options={['p50', 'p95', 'p99'] as LatencyKey[]} value={key} onChange={v => setKey(v)} />
      </div>
      <div className={styles.chartBody}>
        <div className={styles.latencyHero}>
          {loading ? '…' : live && hasData ? formatQueryMs(headline) : '—'}
          <span className={styles.latencyHeroLabel}>{key.toUpperCase()}</span>
        </div>
        {!loading && !hasData ? (
          <div className={styles.chartEmpty} style={{ minHeight: 130 }}>No latency samples in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={data.length ? data : [{ h: '—', ms: 0 }]} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke={C.grid} vertical={false} />
              <XAxis dataKey="h" tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} width={40} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [formatQueryMs(v), key.toUpperCase()]} />
              <Line type="monotone" dataKey="ms" stroke={C.primary} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function QueryTable({
  rows, wired, loading, onRefresh, surface, exploreHrefForQuery,
}: {
  rows: DatabasesQueryRow[];
  wired: boolean;
  loading: boolean;
  onRefresh?: () => void;
  surface: DatabasesSurface;
  exploreHrefForQuery?: (fingerprint: string) => string;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(
    () => rows.filter(r => r.fingerprint.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );
  const emptyMsg = surface === 'cloudflare'
    ? 'No query insights in this window yet.'
    : 'No Hyperdrive agent activity in this window yet.';

  return (
    <div className={styles.queryWrap}>
      <div className={styles.queryTableHeader}>
        <div className={styles.chartTitle}><ListFilter size={14} /> Queries</div>
        <div className={styles.queryTableActions}>
          <div className={styles.searchWrap}>
            <Search size={13} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search queries (case sensitive)…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search queries"
            />
          </div>
          <IconBtn onClick={onRefresh} title="Refresh"><RefreshCw size={13} /></IconBtn>
        </div>
      </div>
      {!wired && !loading ? (
        <div className={styles.emptyState}>{emptyMsg}</div>
      ) : (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.queryTable}>
              <thead>
                <tr>
                  <th>Query</th>
                  <th>% runtime</th>
                  <th>Count</th>
                  <th>Total</th>
                  <th>P50</th>
                  <th>P99</th>
                  <th>Rows read</th>
                  <th>Rows written</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 20).map(row => {
                  const totalMs = row.avg_ms * row.call_count;
                  return (
                    <React.Fragment key={row.fingerprint}>
                      <tr className={styles.queryRow} onClick={() => setExpanded(expanded === row.fingerprint ? null : row.fingerprint)}>
                        <td>
                          <div className={styles.queryFp}>
                            <ChevronRight size={12} className={`${styles.expandIcon} ${expanded === row.fingerprint ? styles.expandIconOpen : ''}`} />
                            {row.fingerprint}
                          </div>
                        </td>
                        <td className={styles.mono}>{row.runtime_pct}%</td>
                        <td className={styles.mono}>{row.call_count.toLocaleString()}</td>
                        <td className={styles.mono}>{formatQueryMs(totalMs)}</td>
                        <td className={styles.mono}>{formatQueryMs(row.p50_ms)}</td>
                        <td className={styles.mono}>{formatQueryMs(row.p99_ms)}</td>
                        <td className={styles.mono}>{formatCompact(row.rows_read)}</td>
                        <td className={styles.mono}>{formatCompact(row.rows_written ?? 0)}</td>
                      </tr>
                      {expanded === row.fingerprint ? (
                        <tr>
                          <td colSpan={8} className={styles.expandedTd}>
                            <pre className={styles.expandedSql}>{row.fingerprint}</pre>
                            <a href={exploreHrefForQuery ? exploreHrefForQuery(row.fingerprint) : '/dashboard/database?studio=1'} className={styles.actionBtn}>
                              <ExternalLink size={11} /> Explore Data
                            </a>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 ? (
            <div className={styles.tableFoot}>
              <span>Showing 1–{Math.min(20, filtered.length)} of {filtered.length}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function HotTablesPanel({ hotTables, surface }: { hotTables: { largest?: HotTable[]; mostRead?: HotTable[]; mostWritten?: HotTable[] }; surface: DatabasesSurface }) {
  const cols = [
    { title: 'Largest', rows: hotTables.largest ?? [] },
    { title: surface === 'cloudflare' ? 'Most read' : 'Most read · cumulative', rows: hotTables.mostRead ?? [] },
    { title: surface === 'cloudflare' ? 'Most written' : 'Most written · cumulative', rows: hotTables.mostWritten ?? [] },
  ];
  if (!cols.some(c => c.rows.length > 0)) return null;
  return (
    <div className={styles.hotGrid}>
      {cols.map(col => (
        <div key={col.title} className={styles.tableList}>
          <div className={styles.tableListHeader}><Layers size={12} /> {col.title}</div>
          {col.rows.slice(0, 5).map(row => (
            <div key={row.name} className={styles.tableRow}>
              <span className={styles.tableRowName}>{row.name}</span>
              <span className={styles.tableRowVal}>{row.val}</span>
            </div>
          ))}
          {!col.rows.length ? <div className={styles.emptyState}>—</div> : null}
        </div>
      ))}
    </div>
  );
}

function SchemaWatchPanel({ schema }: { schema: SchemaHealthPayload }) {
  const issues = [
    ...(schema.noPrimaryKey ?? []).map(i => ({ kind: 'No primary key', name: i.name })),
    ...(schema.missingIndexes ?? []).map(i => ({ kind: 'Index watch', name: i.name })),
    ...(schema.fkIssues ?? []).map(i => ({ kind: 'Invalid FK', name: i.table_name || i.conname || i.name || '—' })),
  ];
  if (!schema.wired && !issues.length) return null;
  return (
    <div className={styles.tableList}>
      <div className={styles.tableListHeader}><ShieldAlert size={12} /> Schema watch</div>
      {!issues.length ? (
        <div className={styles.emptyState}>No schema issues flagged.</div>
      ) : (
        issues.slice(0, 8).map(issue => (
          <div key={`${issue.kind}-${issue.name}`} className={styles.tableRow}>
            <span className={styles.tableRowName}>{issue.name}</span>
            <span className={styles.healthBadgeWarn}>{issue.kind}</span>
          </div>
        ))
      )}
    </div>
  );
}

function LargeObjectsPanel({ objects }: { objects: Array<{ name: string; size: string; pct: string }> }) {
  if (!objects?.length) return null;
  return (
    <div className={styles.tableList}>
      <div className={styles.tableListHeader}><Database size={12} /> Largest relations</div>
      {objects.map(obj => (
        <div key={obj.name} className={styles.tableRow}>
          <span className={styles.tableRowName}>{obj.name}</span>
          <span className={styles.tableRowVal}>{obj.size}</span>
          <span className={styles.monoMuted}>{obj.pct}</span>
        </div>
      ))}
    </div>
  );
}

const LS_ANALYTICS_D1 = 'iam.database.analytics.database_id';

function readStoredAnalyticsD1(): string {
  try {
    return localStorage.getItem(LS_ANALYTICS_D1) || '';
  } catch {
    return '';
  }
}

export default function DatabasesTab() {
  const { workspaceId } = useWorkspace();
  const [surface, setSurface] = useState<DatabasesSurface>('cloudflare');
  const [range, setRange] = useState<DatabasesRange>('24h');
  const [spinning, setSpinning] = useState(false);
  const [d1Resources, setD1Resources] = useState<DatabaseD1Resource[]>([]);
  const [selectedD1Id, setSelectedD1Id] = useState(readStoredAnalyticsD1);

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (workspaceId?.trim()) headers['X-IAM-Workspace-Id'] = workspaceId.trim();
    void fetch('/api/d1/context', { credentials: 'include', headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { databases?: DatabaseD1Resource[] } | null) => {
        if (cancelled) return;
        const resources = Array.isArray(payload?.databases)
          ? payload.databases.filter((row) => String(row?.database_name || '').trim())
          : [];
        setD1Resources(resources);
        setSelectedD1Id((current) => {
          const preferred = pickPreferredD1Resource(resources, { currentId: current });
          return preferred?.database_id || preferred?.database_name || '';
        });
      })
      .catch(() => {
        if (!cancelled) setD1Resources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedD1Id) return;
    try {
      localStorage.setItem(LS_ANALYTICS_D1, selectedD1Id);
    } catch {
      /* ignore */
    }
  }, [selectedD1Id]);

  const selectedD1 = d1Resources.find(
    (row) => row.database_id === selectedD1Id || row.database_name === selectedD1Id,
  );
  const selectedD1Scope: 'platform' | 'connected' = isPlatformD1Source(selectedD1?.source)
    ? 'platform'
    : 'connected';
  const d1Options = useMemo(() => d1ResourceOptions(d1Resources), [d1Resources]);
  const explorePath = databaseStudioExplorePath({
    source: surface === 'supabase' ? 'supabase' : 'd1',
    resourceRef: surface === 'cloudflare' ? selectedD1Id : '',
    resourceScope: surface === 'cloudflare' ? selectedD1Scope : undefined,
  });

  const obs = useDatabasesObservability(surface, range, surface === 'cloudflare' ? selectedD1Id : '');
  const kpiDefs = surface === 'cloudflare' ? CF_KPIS : SB_KPIS;

  useEffect(() => {
    const other: DatabasesSurface = surface === 'cloudflare' ? 'supabase' : 'cloudflare';
    prefetchDatabasesOverview(other, range, other === 'cloudflare' ? selectedD1Id : '');
  }, [surface, range, selectedD1Id]);

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    void obs.refresh().finally(() => setSpinning(false));
  }, [obs]);

  const chartData = useMemo(() => {
    const c = obs.charts;
    if (!c?.labels?.length) return { total: [], read: [], write: [], rowsRead: [], rowsWritten: [] };
    return {
      total: c.labels.map((h, i) => ({ h, v: c.totalQueries[i] ?? 0 })),
      read: c.labels.map((h, i) => ({ h, v: c.readQueries[i] ?? 0 })),
      write: c.labels.map((h, i) => ({ h, v: c.writeQueries[i] ?? 0 })),
      rowsRead: c.labels.map((h, i) => ({ h, v: c.rowsRead[i] ?? 0 })),
      rowsWritten: c.labels.map((h, i) => ({ h, v: c.rowsWritten[i] ?? 0 })),
    };
  }, [obs.charts]);

  const totalQueryLegend = useMemo(() => {
    const sum = chartData.total.reduce((a, b) => a + b.v, 0);
    if (!sum) return undefined;
    return `${formatCompact(sum)} queries`;
  }, [chartData.total]);

  const chartEmpty = surface === 'supabase'
    ? 'No Hyperdrive agent activity in this window yet.'
    : undefined;

  return (
    <div className={styles['analytics-databases']} data-surface={surface}>
      {obs.error ? (
        <div className={styles.alertBanner} role="alert">
          <AlertCircle size={13} />
          <span><strong>{obs.error}</strong></span>
        </div>
      ) : null}

      {obs.alertWarnings.length > 0 ? (
        <div className={styles.alertBanner} role="alert">
          <AlertTriangle size={13} />
          <span>
            <strong>Telemetry degraded.</strong>{' '}
            {obs.alertWarnings.slice(0, 2).map(w => w.message).join(' ')}
          </span>
        </div>
      ) : null}

      <div className={styles.filterBar}>
        <CtrlGroup
          options={['cloudflare', 'supabase'] as DatabasesSurface[]}
          labels={{ cloudflare: 'Cloudflare', supabase: 'Supabase' }}
          value={surface}
          onChange={v => setSurface(v)}
        />
        <CtrlGroup
          options={['1h', '24h', '7d', '30d'] as DatabasesRange[]}
          value={range}
          onChange={v => setRange(v)}
        />
        {surface === 'cloudflare' && d1Options.length ? (
          <DatabaseResourcePicker
            ariaLabel="Analytics D1 database"
            value={selectedD1Id}
            options={d1Options}
            onChange={setSelectedD1Id}
            placeholder="Select database"
          />
        ) : null}
        <IconBtn onClick={handleRefresh} title="Refresh data">
          <RefreshCw
            size={13}
            style={{
              transform: spinning ? 'rotate(360deg)' : 'none',
              transition: spinning ? 'transform 0.8s linear' : 'none',
            }}
          />
        </IconBtn>
        <Link to={explorePath} className={styles.ctaBtn}>
          <Table2 size={13} /> Explore Data
        </Link>
      </div>

      {obs.database?.name && surface === 'cloudflare' ? (
        <div className={styles.surfaceMeta}>
          {obs.database.name}
          <span className={styles.dbIdChip}>{obs.database.id.slice(0, 8)}…</span>
          <span className={styles.monoMuted}> · Cloudflare GraphQL</span>
        </div>
      ) : null}

      {surface === 'supabase' && obs.health?.hyperdrive ? (
        <div className={styles.opsStrip} data-status={obs.health.hyperdrive}>
          Hyperdrive {obs.health.hyperdrive}
          {obs.health.latencyMs != null ? ` · ${obs.health.latencyMs}ms probe` : ''}
        </div>
      ) : null}

      <div className={styles.kpiGrid}>
        <CapacityRing capacity={obs.capacity} loading={obs.loading} surface={surface} />
        <KpiCards
          defs={kpiDefs}
          kpis={obs.overview?.kpis}
          sparks={obs.sparks}
          loading={obs.loading}
          surface={surface}
        />
      </div>

      <BarPanel
        title="Total queries"
        data={chartData.total}
        loading={obs.loading}
        surface={surface}
        height={240}
        legendTotal={totalQueryLegend}
        empty={chartEmpty ?? (obs.overview?.kpis?.queries?.wired ? undefined : 'No query volume in this window yet.')}
      />

      <div className={styles.chartGrid2}>
        <BarPanel title="Read queries" data={chartData.read} loading={obs.loading} surface={surface} height={180} />
        <BarPanel title="Write queries" data={chartData.write} loading={obs.loading} surface={surface} height={180} />
      </div>

      <div className={styles.chartGrid2}>
        <LatencyPanel charts={obs.charts} loading={obs.loading} live={obs.live.charts} surface={surface} />
        <BarPanel title="Rows read" data={chartData.rowsRead} loading={obs.loading} surface={surface} height={180} />
      </div>

      <QueryTable
        rows={obs.queryPerformance.rows}
        wired={obs.queryPerformance.wired}
        loading={obs.loading || obs.queriesLoading}
        onRefresh={handleRefresh}
        surface={surface}
        exploreHrefForQuery={(fingerprint) =>
          databaseStudioExplorePath({
            source: 'd1',
            resourceRef: selectedD1Id,
            resourceScope: selectedD1Scope,
            query: fingerprint,
          })
        }
      />

      <div className={styles.chartGrid2}>
        <BarPanel title="Rows written" data={chartData.rowsWritten} loading={obs.loading} surface={surface} height={180} />
        <LargeObjectsPanel objects={obs.storage.largeObjects ?? []} />
      </div>

      <div className={styles.chartGrid2}>
        <HotTablesPanel hotTables={obs.hotTables} surface={surface} />
        <SchemaWatchPanel schema={obs.schemaHealth} />
      </div>
    </div>
  );
}
