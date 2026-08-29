import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  Cloud,
  HardDrive,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
} from 'lucide-react';

type NavKey = 'files' | 'analytics' | 'vectors' | 's3' | 'policies' | 'cleanup' | 'activity' | 'providers';
type Row = Record<string, any>;

const COLORS = ['var(--solar-cyan)', 'var(--solar-blue)', 'var(--solar-violet)', 'var(--solar-magenta)', 'var(--solar-green)', 'var(--solar-yellow)', 'var(--solar-orange)'];

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function mb(v: any) {
  return `${n(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

function bytes(v: any) {
  const x = n(v);
  if (x < 1024) return `${Math.round(x)} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  if (x < 1024 * 1024 * 1024) return `${(x / 1048576).toFixed(1)} MB`;
  return `${(x / 1073741824).toFixed(2)} GB`;
}

function fmtTs(v: string | number | null | undefined) {
  if (!v && v !== 0) return '—';
  const ms = typeof v === 'number' && v < 1e12 ? v * 1000 : Number(v);
  return Number.isNaN(ms) ? String(v) : new Date(ms).toLocaleString();
}

function isR2BucketRow(b: Row) {
  const t = String(b.storage_type || 'r2_bucket').toLowerCase();
  return t === 'r2_bucket' || t === 'r2' || !t || t === 'bucket';
}

function formatObjectCount(b: Row) {
  if (!isR2BucketRow(b)) return '—';
  return n(b.object_count).toLocaleString();
}

function formatSizeMb(b: Row) {
  if (!isR2BucketRow(b)) return '—';
  return mb(b.total_mb);
}

function driftTone(status: string | undefined): 'ok' | 'warn' | 'bad' | 'muted' {
  if (!status || status === 'aligned' || status === 'empty') return 'ok';
  if (status === 'cf_behind' || status === 'pg_empty') return 'warn';
  return 'bad';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    return await res.json();
  } catch {
    return null;
  }
}

function Badge({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }) {
  const color = tone === 'ok' ? 'var(--solar-green)' : tone === 'warn' ? 'var(--solar-yellow)' : tone === 'bad' ? 'var(--solar-red)' : tone === 'muted' ? 'var(--text-muted)' : 'var(--solar-cyan)';
  return <span className="storage-badge" style={{ color }}>{children}</span>;
}

function Dot({ ok }: { ok: boolean }) {
  return <span className="storage-dot" style={{ background: ok ? 'var(--solar-green)' : 'var(--solar-red)' }} />;
}

function DataQuality({ data }: { data?: Row | null }) {
  if (!data) return null;
  const warn = data.data_quality === 'fallback_live_scan' || data.data_quality === 'partial';
  return <div className="storage-quality"><Badge tone={warn ? 'warn' : 'ok'}>{data.source || 'd1_registry'}</Badge><Badge tone={warn ? 'warn' : 'ok'}>{data.data_quality || 'healthy'}</Badge><span>{data.last_synced_at ? fmtTs(data.last_synced_at) : 'not synced'}</span></div>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="storage-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Tip(props: any) {
  return <Tooltip {...props} contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-main)', fontSize: 11 }} />;
}

export type StoragePageProps = { embeddedInSettings?: boolean };

export const StoragePage: React.FC<StoragePageProps> = ({ embeddedInSettings = false }) => {
  const [nav, setNav] = useState<NavKey>('files');
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<Row | null>(null);
  const [analytics, setAnalytics] = useState<Row | null>(null);
  const [vectors, setVectors] = useState<Row | null>(null);
  const [s3, setS3] = useState<Row | null>(null);
  const [policies, setPolicies] = useState<Row | null>(null);
  const [activity, setActivity] = useState<Row | null>(null);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [selectedIndex, setSelectedIndex] = useState('');
  const [filters, setFilters] = useState({ worker_name: '', outcome: '', start: '', end: '' });
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [providerExpanded, setProviderExpanded] = useState<Record<string, boolean>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, Row>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);
  const [vectorConnSaving, setVectorConnSaving] = useState(false);
  const [reindexQueued, setReindexQueued] = useState<string | null>(null);
  const [registrySyncing, setRegistrySyncing] = useState(false);
  const [vectorConnDraft, setVectorConnDraft] = useState({
    display_name: '',
    provider: 'cloudflare_vectorize',
    index_name: '',
    table_name: '',
    dimensions: '1536',
    description: '',
  });

  const loadBuckets = useCallback(async () => setBuckets(await fetchJson<Row>('/api/storage/buckets')), []);
  const loadAnalytics = useCallback(async () => setAnalytics(await fetchJson<Row>('/api/storage/analytics')), []);
  const loadVectors = useCallback(async () => setVectors(await fetchJson<Row>('/api/storage/vectors')), []);
  const loadS3 = useCallback(async () => setS3(await fetchJson<Row>('/api/storage/s3')), []);
  const loadPolicies = useCallback(async () => setPolicies(await fetchJson<Row>('/api/storage/policies')), []);
  const loadActivity = useCallback(async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, v]));
    setActivity(await fetchJson<Row>(`/api/storage/activity${qs.toString() ? `?${qs}` : ''}`));
  }, [filters]);

  const loadStoragePreferences = useCallback(async () => {
    const j = await fetchJson<{ preferences?: Row[]; oauth_providers?: string[] }>('/api/settings/storage-preferences');
    setOauthProviders(Array.isArray(j?.oauth_providers) ? j.oauth_providers : []);
    const ids = ['r2', 'github', 'google_drive', 'supabase', 's3'];
    const drafts: Record<string, Row> = {};
    for (const p of ids) drafts[p] = {};
    for (const row of j?.preferences || []) {
      const prov = String(row.provider || '').toLowerCase();
      if (!ids.includes(prov)) continue;
      const pj = row.preferences_json;
      let parsed: Row = {};
      if (pj && typeof pj === 'object' && !Array.isArray(pj)) parsed = { ...pj };
      else if (typeof pj === 'string') {
        try {
          const x = JSON.parse(pj);
          if (x && typeof x === 'object' && !Array.isArray(x)) parsed = x;
        } catch {
          parsed = {};
        }
      }
      drafts[prov] = parsed;
    }
    setProviderDrafts(drafts);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    if (nav === 'files' || nav === 'cleanup') await loadBuckets();
    if (nav === 'analytics') await loadAnalytics();
    if (nav === 'vectors') await loadVectors();
    if (nav === 's3') await Promise.all([loadS3(), loadBuckets()]);
    if (nav === 'policies') await Promise.all([loadPolicies(), loadBuckets()]);
    if (nav === 'activity') await loadActivity();
    if (nav === 'providers') await loadStoragePreferences();
    setLoading(false);
  }, [nav, loadBuckets, loadAnalytics, loadVectors, loadS3, loadPolicies, loadActivity, loadStoragePreferences]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (nav !== 'analytics' || !analytics) return;
    const check = (label: string, arr: unknown) => {
      if (!Array.isArray(arr) || arr.length === 0) console.warn(`[StoragePage] analytics chart data empty: ${label}`, analytics);
    };
    check('storage_inventory.storage_by_bucket', analytics?.storage_inventory?.storage_by_bucket);
    check('contentTypes (from by_content_type)', Object.keys(analytics?.storage_inventory?.by_content_type || {}));
    check('request_trends', analytics?.request_trends);
    check('workspace_usage', analytics?.workspace_usage);
  }, [nav, analytics]);

  const bucketRows = buckets?.buckets || [];
  const r2BucketRows = bucketRows.filter((b: Row) => isR2BucketRow(b));
  const missingRegistry = buckets?.missing_registry_rows || [];

  const syncProjectStorage = async () => {
    setRegistrySyncing(true);
    try {
      await fetchJson('/api/storage/jobs/sync-project-storage', { method: 'POST' });
      await loadBuckets();
    } finally {
      setRegistrySyncing(false);
    }
  };
  const platformIndexes = vectors?.platform_cf_indexes || vectors?.indexes || [];
  const selectedVector =
    platformIndexes.find((x: Row) => x.id === selectedIndex) || platformIndexes[0];
  useEffect(() => {
    if (!selectedIndex && platformIndexes[0]?.id) setSelectedIndex(platformIndexes[0].id);
  }, [vectors, selectedIndex, platformIndexes]);

  const saveVectorConnection = async () => {
    setVectorConnSaving(true);
    try {
      const dims = Number(vectorConnDraft.dimensions);
      await fetchJson('/api/storage/vector-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: vectorConnDraft.display_name.trim(),
          provider: vectorConnDraft.provider,
          index_name:
            vectorConnDraft.provider === 'cloudflare_vectorize'
              ? vectorConnDraft.index_name.trim()
              : undefined,
          table_name:
            vectorConnDraft.provider === 'supabase_pgvector'
              ? vectorConnDraft.table_name.trim()
              : undefined,
          dimensions: Number.isFinite(dims) ? dims : undefined,
          config: vectorConnDraft.description.trim()
            ? { description: vectorConnDraft.description.trim() }
            : {},
          connection_status: 'pending',
        }),
      });
      setVectorConnDraft({
        display_name: '',
        provider: 'cloudflare_vectorize',
        index_name: '',
        table_name: '',
        dimensions: '1536',
        description: '',
      });
      await loadVectors();
    } finally {
      setVectorConnSaving(false);
    }
  };

  const removeVectorConnection = async (id: string) => {
    await fetchJson(`/api/storage/vector-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadVectors();
  };

  const queueVectorReindex = async (bindingName: string) => {
    const key = bindingName || 'default';
    setReindexQueued(key);
    try {
      await fetchJson('/api/storage/code-index/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: vectors?.workspace_id || undefined,
          binding_name: bindingName || undefined,
        }),
      });
    } finally {
      window.setTimeout(() => setReindexQueued((cur) => (cur === key ? null : cur)), 3000);
    }
  };

  const contentTypes = useMemo(() => Object.entries(analytics?.storage_inventory?.by_content_type || {}).map(([name, value]) => ({ name, value: n(value) })), [analytics]);
  const cleanup = analytics?.storage_inventory?.cleanup_breakdown || {};

  const markCleanup = async (bucket: string, status: string) => {
    await fetchJson(`/api/storage/buckets/${encodeURIComponent(bucket)}/cleanup`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    await Promise.all([loadBuckets(), loadAnalytics()]);
  };

  const markResolved = async (eventId: string) => {
    await fetchJson(`/api/storage/errors/${encodeURIComponent(eventId)}`, { method: 'PATCH' });
    await loadAnalytics();
  };

  const NavBtn = ({ k, icon, label }: { k: NavKey; icon: React.ReactNode; label: string }) => (
    <button type="button" onClick={() => setNav(k)} className={`storage-nav ${nav === k ? 'active' : ''}`}>{icon}{label}</button>
  );

  const saveProvider = async (pid: string) => {
    setProviderSaving(pid);
    try {
      const draft = providerDrafts[pid] || {};
      const r = await fetch('/api/settings/storage-preferences', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: pid, ...draft }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.warn('[StoragePage] storage-preferences PATCH failed', j);
      }
      await loadStoragePreferences();
    } finally {
      setProviderSaving(null);
    }
  };

  const providerSpecs: Array<{
    id: string;
    title: string;
    oauthKey: string | null;
    fields: string[];
  }> = [
    { id: 'r2', title: 'R2 (Cloudflare)', oauthKey: null, fields: ['bucket_name', 'public_base_url', 'r2_prefix'] },
    { id: 'github', title: 'GitHub', oauthKey: 'github', fields: ['repo', 'branch', 'base_path'] },
    { id: 'google_drive', title: 'Google Drive', oauthKey: 'google_drive', fields: ['folder_id', 'folder_name'] },
    { id: 'supabase', title: 'Supabase', oauthKey: null, fields: ['project_url', 'bucket_name', 'schema'] },
    { id: 's3', title: 'Local / Custom S3', oauthKey: null, fields: ['endpoint_url', 'access_key_id', 'secret_access_key', 'bucket', 'region'] },
  ];

  const fieldLabel = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const shellClass = embeddedInSettings ? 'storage-root storage-root--embedded' : 'storage-root';

  const qualitySource =
    nav === 'providers'
      ? { source: 'settings_api', data_quality: 'healthy', last_synced_at: null }
      : nav === 'analytics'
        ? analytics
        : nav === 'vectors'
          ? vectors
          : nav === 'activity'
            ? activity
            : buckets;

  return (
    <div className={shellClass}>
      <style>{`
        .storage-root{height:100%;min-height:0;display:flex;background:var(--bg-app);color:var(--text-main)}.storage-root--embedded{height:auto;min-height:0;flex:1}.storage-side{width:210px;flex-shrink:0;border-right:1px solid var(--border-subtle);background:var(--bg-panel);padding:12px}.storage-brand{display:flex;gap:9px;align-items:center;margin:4px 4px 14px}.storage-brand h1{font-size:13px;margin:0}.storage-brand p{font-size:10px;color:var(--text-muted);margin:0}.storage-nav{width:100%;display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--text-muted);font-size:12px;text-align:left;padding:9px;border-radius:8px}.storage-nav:hover,.storage-nav.active{background:var(--bg-hover);color:var(--solar-cyan)}.storage-main{flex:1;min-width:0;overflow:auto;padding:18px}.storage-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.storage-top h2{font-size:16px;margin:0}.storage-btn{border:1px solid var(--border-subtle);background:var(--bg-panel);color:var(--text-main);border-radius:8px;padding:7px 10px;font-size:12px;display:inline-flex;gap:6px;align-items:center}.storage-card{background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:10px;overflow:hidden}.storage-pad{padding:14px}.storage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.storage-stat{background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:10px;padding:13px}.storage-stat span{display:block;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.14em;font-weight:700}.storage-stat strong{display:block;font-size:22px;margin-top:6px}.storage-table{width:100%;border-collapse:collapse;font-size:12px}.storage-table th{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);text-align:left}.storage-table th,.storage-table td{padding:8px;border-bottom:1px solid var(--border-subtle);vertical-align:top}.storage-table tr:hover{background:var(--bg-hover)}.storage-badge{border:1px solid currentColor;border-radius:999px;padding:2px 7px;font-size:10px;text-transform:uppercase;white-space:nowrap}.storage-dot{display:inline-block;width:8px;height:8px;border-radius:999px}.storage-quality{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-muted)}.storage-chart{height:260px}.storage-half{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.storage-field{background:var(--bg-app);border:1px solid var(--border-subtle);border-radius:7px;color:var(--text-main);padding:7px;font-size:12px;width:100%;box-sizing:border-box}.storage-banner{border:1px solid var(--solar-yellow);background:color-mix(in srgb,var(--solar-yellow),transparent 88%);border-radius:9px;padding:10px;font-size:12px;color:var(--text-main);margin-bottom:12px}.storage-row-actions{display:flex;gap:6px;flex-wrap:wrap}.storage-muted{color:var(--text-muted)}.storage-provider-head{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:transparent;border:0;color:var(--text-main);font-size:13px;cursor:pointer;text-align:left}.storage-provider-body{padding:0 14px 14px;display:flex;flex-direction:column;gap:10px}@media(max-width:768px){.storage-root,.storage-root--embedded{flex-direction:column}.storage-side{width:auto;display:flex;overflow:auto}.storage-brand{display:none}.storage-nav{white-space:nowrap}.storage-grid,.storage-half{grid-template-columns:1fr}.storage-main{padding:12px}}
      `}</style>
      <aside className="storage-side">
        <div className="storage-brand"><HardDrive size={22} color="var(--solar-cyan)" /><div><h1>Storage</h1><p>D1 registry backed</p></div></div>
        <NavBtn k="files" icon={<HardDrive size={15} />} label="Files" />
        <NavBtn k="analytics" icon={<BarChart3 size={15} />} label="Analytics" />
        <NavBtn k="vectors" icon={<Boxes size={15} />} label="Vectors" />
        <NavBtn k="s3" icon={<Cloud size={15} />} label="S3" />
        <NavBtn k="policies" icon={<Shield size={15} />} label="Policies" />
        <NavBtn k="cleanup" icon={<Trash2 size={15} />} label="Cleanup" />
        <NavBtn k="activity" icon={<History size={15} />} label="Activity" />
        <NavBtn k="providers" icon={<Settings size={15} />} label="Providers" />
      </aside>

      <main className="storage-main">
        <div className="storage-top">
          <h2>{nav === 'providers' ? 'Provider Settings' : nav[0].toUpperCase() + nav.slice(1)}</h2>
          <div className="storage-quality">
            <DataQuality data={qualitySource} />
            <button className="storage-btn" onClick={refresh}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh</button>
          </div>
        </div>

        {nav === 'files' && (
          <>
            <div className="storage-top">
              <select className="storage-field" value={selectedBucket} onChange={(e) => setSelectedBucket(e.target.value)}>
                <option value="">All buckets</option>
                {bucketRows.map((b: Row) => <option key={b.storage_name || b.bucket_name} value={b.storage_name || b.bucket_name}>{b.storage_name || b.bucket_name}</option>)}
              </select>
            </div>
            <div className="storage-grid">
              <Stat label="R2 Objects" value={n(buckets?.total_objects).toLocaleString()} />
              <Stat label="R2 Size" value={mb(buckets?.total_mb)} />
              <Stat label="Registry Rows" value={bucketRows.length} />
              <Stat label="Last Inventoried" value={fmtTs(buckets?.last_synced_at)} />
            </div>
            {!!missingRegistry.length && (
              <div className="storage-banner">
                {missingRegistry.length} live R2 binding(s) missing <code>project_storage</code> rows — inventory may be incomplete.
                <button type="button" className="storage-btn" style={{ marginLeft: 10 }} disabled={registrySyncing} onClick={() => void syncProjectStorage()}>
                  {registrySyncing ? 'Syncing…' : 'Sync registry'}
                </button>
              </div>
            )}
            <div className="storage-card"><table className="storage-table"><thead><tr><th>Name</th><th>Type</th><th>Objects</th><th>Size</th><th>Status</th><th>Cleanup</th><th>Owner</th><th>Last Inventoried</th><th>Live</th><th>Registry</th></tr></thead><tbody>{bucketRows.filter((b: Row) => !selectedBucket || (b.storage_name || b.bucket_name) === selectedBucket).map((b: Row) => <tr key={b.storage_name || b.bucket_name}><td>{b.storage_name || b.bucket_name}</td><td>{b.storage_type || 'r2_bucket'}</td><td>{formatObjectCount(b)}</td><td>{formatSizeMb(b)}</td><td><Badge tone={b.status === 'active' ? 'ok' : 'muted'}>{b.status || 'active'}</Badge></td><td><Badge tone={b.cleanup_status === 'reviewed' ? 'ok' : b.cleanup_status === 'archived' ? 'muted' : 'warn'}>{isR2BucketRow(b) ? (b.cleanup_status || 'unreviewed') : 'n/a'}</Badge></td><td>{b.owner || 'n/a'}</td><td>{isR2BucketRow(b) ? fmtTs(b.last_inventoried_at) : '—'}</td><td><Dot ok={!!b.is_live_connected} /></td><td><Badge tone={b.registry_status === 'registered' ? 'ok' : 'warn'}>{b.registry_status || 'registered'}</Badge></td></tr>)}</tbody></table></div>
          </>
        )}

        {nav === 'analytics' && (
          <>
            <div className="storage-grid">
              <Stat label="Total Objects" value={n(analytics?.storage_inventory?.total_objects).toLocaleString()} />
              <Stat label="Total Storage" value={mb(analytics?.storage_inventory?.total_mb)} />
              <Stat label="Unresolved Errors" value={analytics?.recent_errors?.length || 0} />
              <Stat label="Requests Today" value={(analytics?.request_trends || []).reduce((s: number, r: Row) => s + n(r.total_requests), 0).toLocaleString()} />
            </div>
            <div className="storage-half">
              <div className="storage-card storage-pad"><div className="storage-chart"><ResponsiveContainer><BarChart data={analytics?.storage_inventory?.storage_by_bucket || []}><XAxis dataKey="bucket_name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><Tip /><Bar dataKey="total_mb" fill="var(--solar-cyan)" /></BarChart></ResponsiveContainer></div></div>
              <div className="storage-card storage-pad"><div className="storage-chart"><ResponsiveContainer><PieChart><Pie data={contentTypes} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90}>{contentTypes.map((_r, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tip /></PieChart></ResponsiveContainer></div></div>
            </div>
            <div className="storage-card storage-pad" style={{ marginBottom: 14 }}><div className="storage-chart"><ResponsiveContainer><AreaChart data={analytics?.request_trends || []}><CartesianGrid stroke="var(--border-subtle)" vertical={false} /><XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><Tip /><Area dataKey="total_requests" stroke="var(--solar-green)" fill="var(--solar-green)" fillOpacity={0.16} /><Area dataKey="failed_requests" stroke="var(--solar-red)" fill="var(--solar-red)" fillOpacity={0.22} /></AreaChart></ResponsiveContainer></div></div>
            <div className="storage-card" style={{ marginBottom: 14 }}><table className="storage-table"><thead><tr><th>Timestamp</th><th>Worker</th><th>Path</th><th>Method</th><th>Status</th><th>Error</th><th>Resolved</th><th>Action</th></tr></thead><tbody>{(analytics?.recent_errors || []).map((e: Row) => <tr key={e.event_id}><td>{fmtTs(e.timestamp)}</td><td>{e.worker_name}</td><td>{e.path}</td><td>{e.method}</td><td>{e.status_code}</td><td>{String(e.error_message || '').slice(0, 120)}</td><td><Badge tone={e.resolved ? 'muted' : 'bad'}>{e.resolved ? 'yes' : 'no'}</Badge></td><td>{!e.resolved && <button className="storage-btn" onClick={() => markResolved(e.event_id)}>Mark Resolved</button>}</td></tr>)}</tbody></table></div>
            <div className="storage-card storage-pad"><div className="storage-chart"><ResponsiveContainer><LineChart data={analytics?.workspace_usage || []}><XAxis dataKey="metric_date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><Tip /><Line dataKey="storage_used_mb" stroke="var(--solar-cyan)" dot={false} /><Line dataKey="mcp_calls" stroke="var(--solar-violet)" dot={false} /><Line dataKey="deployments_count" stroke="var(--solar-green)" dot={false} /></LineChart></ResponsiveContainer></div></div>
          </>
        )}

        {nav === 'vectors' && (
          <>
            <p className="storage-muted" style={{ marginBottom: 12 }}>
              {vectors?.can_view_platform
                ? 'Platform operator view — Cloudflare Vectorize bindings and Supabase pgvector lane catalog.'
                : `Shared platform vector catalog plus workspace lanes for ${vectors?.workspace_id || 'active workspace'}.`}
            </p>
            <div className="storage-grid">
              <Stat label="CF Live Vectors" value={n(vectors?.total_stored_vectors).toLocaleString()} />
              <Stat label="Supabase Embedded" value={n(vectors?.total_supabase_embedded).toLocaleString()} />
              <Stat label="Lane Drift" value={n(vectors?.lane_drift_summary?.drifted)} />
              <Stat label="CF Indexes" value={platformIndexes.length} />
            </div>
            {!!vectors?.lane_drift_summary?.drifted && (
              <div className="storage-banner">
                {vectors.lane_drift_summary.drifted} lane(s) out of sync between Cloudflare Vectorize and Supabase pgvector mirrors.
              </div>
            )}
            <h3 className="storage-muted" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', margin: '0 0 8px' }}>
              Cloudflare Vectorize
            </h3>
            <div className="storage-half">
              {platformIndexes.map((idx: Row) => {
                const bindingKey = String(idx.binding_name || idx.id || 'default');
                const queued = reindexQueued === bindingKey;
                return (
                  <div
                    className="storage-card storage-pad"
                    key={idx.id || idx.binding_name}
                    onClick={() => setSelectedIndex(idx.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="storage-top">
                      <strong>{idx.display_name || idx.index_name || idx.binding_name}</strong>
                      <span>
                        <Dot ok={!!idx.is_live_connected} />{' '}
                        {idx.is_preferred ? <Badge tone="ok">preferred</Badge> : null}
                      </span>
                    </div>
                    <p className="storage-muted">
                      {idx.binding_name} / {idx.source_type}
                    </p>
                    <div className="storage-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                      <Stat label="CF live" value={n(idx.cf_live_vectors ?? idx.stored_vectors).toLocaleString()} />
                      <Stat label="Supabase" value={idx.supabase_embedded_rows != null ? n(idx.supabase_embedded_rows).toLocaleString() : '—'} />
                      <Stat label="Drift" value={<Badge tone={driftTone(idx.drift_status)}>{idx.drift_status || 'unknown'}</Badge>} />
                      <Stat label="Last sync" value={fmtTs(idx.last_sync_receipt_at || idx.last_indexed_at)} />
                    </div>
                    <p className="storage-muted" style={{ fontSize: 10 }}>
                      Registry: {n(idx.registry_stored_vectors).toLocaleString()} · source: {idx.cf_count_source || 'd1_registry'}
                      {idx.supabase_table ? ` · pg: agentsam.${idx.supabase_table}` : ''}
                    </p>
                    <p className="storage-muted">{idx.description}</p>
                    <div className="storage-row-actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="storage-btn"
                        disabled={queued}
                        onClick={(e) => {
                          e.stopPropagation();
                          void queueVectorReindex(bindingKey);
                        }}
                      >
                        {queued ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {queued ? 'Queued' : 'Re-index'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!platformIndexes.length && (
                <p className="storage-muted">No Cloudflare Vectorize indexes in the platform catalog.</p>
              )}
            </div>
            {vectors?.can_view_platform && selectedVector?.stale_doc_count > 0 && (
              <div className="storage-banner">
                {selectedVector.stale_doc_count} stale chunks detected on {selectedVector.display_name}.
              </div>
            )}
            {vectors?.can_view_platform && !!selectedVector?.recent_docs?.length && (
              <div className="storage-card" style={{ marginBottom: 14 }}>
                <table className="storage-table">
                  <thead>
                    <tr>
                      <th>R2 Key</th>
                      <th>Preview</th>
                      <th>Chunk</th>
                      <th>Tokens</th>
                      <th>Indexed</th>
                      <th>Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedVector.recent_docs || []).map((d: Row, i: number) => (
                      <tr key={i}>
                        <td>{d.source_r2_key}</td>
                        <td>{String(d.content_preview || '').slice(0, 80)}</td>
                        <td>{d.chunk_index}</td>
                        <td>{d.token_count}</td>
                        <td>{fmtTs(d.indexed_at)}</td>
                        <td>
                          <Badge tone={d.is_current ? 'ok' : 'warn'}>
                            {d.is_current ? 'current' : 'stale'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="storage-muted" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', margin: '0 0 8px' }}>
              Supabase pgvector
            </h3>
            <div className="storage-card" style={{ marginBottom: 14 }}>
              <table className="storage-table">
                <thead>
                  <tr>
                    <th>Purpose</th>
                    <th>Table</th>
                    <th>Dims</th>
                    <th>Model</th>
                    <th>Archive</th>
                    <th>Live</th>
                  </tr>
                </thead>
                <tbody>
                  {(vectors?.platform_pgvector_lanes || []).map((lane: Row) => (
                    <tr key={lane.id || lane.table_name}>
                      <td>{lane.purpose}</td>
                      <td>
                        {lane.schema_name}.{lane.table_name}
                      </td>
                      <td>{lane.dimensions}</td>
                      <td>{lane.embedding_model}</td>
                      <td>
                        <Badge tone={lane.is_archive ? 'warn' : 'muted'}>
                          {lane.is_archive ? 'yes' : 'no'}
                        </Badge>
                      </td>
                      <td>
                        <Dot ok={!!lane.is_live_connected} />
                      </td>
                    </tr>
                  ))}
                  {!(vectors?.platform_pgvector_lanes || []).length && (
                    <tr>
                      <td colSpan={6} className="storage-muted">
                        No active pgvector lanes in the global catalog.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <h3 className="storage-muted" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', margin: '0 0 8px' }}>
              Supabase pgvector (live workspace mirror)
            </h3>
            <div className="storage-card" style={{ marginBottom: 14 }}>
              <table className="storage-table">
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th>Table</th>
                    <th>Dims</th>
                    <th>Rows</th>
                    <th>Embedded</th>
                  </tr>
                </thead>
                <tbody>
                  {(vectors?.workspace_pgvector_lanes || []).map((lane: Row) => (
                    <tr key={lane.purpose}>
                      <td>{lane.purpose}</td>
                      <td>
                        {lane.schema_name}.{lane.table_name}
                      </td>
                      <td>{lane.dimensions}</td>
                      <td>
                        {lane.query_ok === false ? (
                          <Badge tone="warn">unavailable</Badge>
                        ) : (
                          n(lane.workspace_row_count).toLocaleString()
                        )}
                      </td>
                      <td>
                        {lane.query_ok === false ? (
                          <Badge tone="warn">—</Badge>
                        ) : (
                          n(lane.workspace_embedded_count).toLocaleString()
                        )}
                      </td>
                    </tr>
                  ))}
                  {!(vectors?.workspace_pgvector_lanes || []).length && (
                    <tr>
                      <td colSpan={5} className="storage-muted">
                        Hyperdrive unavailable or workspace not resolved — cannot read Supabase lane counts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="storage-muted" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', margin: '16px 0 8px' }}>
              Your vector connections
            </h3>
            <div className="storage-card storage-pad" style={{ marginBottom: 14 }}>
              <p className="storage-muted" style={{ marginTop: 0 }}>
                Register external Cloudflare Vectorize indexes or Supabase tables for this workspace. API tokens stay in
                BYOK secrets — only metadata is stored here.
              </p>
              <div className="storage-half">
                <label className="storage-muted" style={{ fontSize: 11 }}>
                  Display name
                  <input
                    className="storage-field"
                    style={{ marginTop: 4 }}
                    value={vectorConnDraft.display_name}
                    onChange={(e) => setVectorConnDraft((d) => ({ ...d, display_name: e.target.value }))}
                  />
                </label>
                <label className="storage-muted" style={{ fontSize: 11 }}>
                  Provider
                  <select
                    className="storage-field"
                    style={{ marginTop: 4 }}
                    value={vectorConnDraft.provider}
                    onChange={(e) => setVectorConnDraft((d) => ({ ...d, provider: e.target.value }))}
                  >
                    <option value="cloudflare_vectorize">Cloudflare Vectorize</option>
                    <option value="supabase_pgvector">Supabase pgvector</option>
                    <option value="external">External</option>
                  </select>
                </label>
                {vectorConnDraft.provider === 'cloudflare_vectorize' ? (
                  <label className="storage-muted" style={{ fontSize: 11 }}>
                    Index name
                    <input
                      className="storage-field"
                      style={{ marginTop: 4 }}
                      value={vectorConnDraft.index_name}
                      onChange={(e) => setVectorConnDraft((d) => ({ ...d, index_name: e.target.value }))}
                      placeholder="my-index-1536"
                    />
                  </label>
                ) : (
                  <label className="storage-muted" style={{ fontSize: 11 }}>
                    Table name
                    <input
                      className="storage-field"
                      style={{ marginTop: 4 }}
                      value={vectorConnDraft.table_name}
                      onChange={(e) => setVectorConnDraft((d) => ({ ...d, table_name: e.target.value }))}
                      placeholder="agentsam_my_table_1536"
                    />
                  </label>
                )}
                <label className="storage-muted" style={{ fontSize: 11 }}>
                  Dimensions
                  <input
                    className="storage-field"
                    style={{ marginTop: 4 }}
                    value={vectorConnDraft.dimensions}
                    onChange={(e) => setVectorConnDraft((d) => ({ ...d, dimensions: e.target.value }))}
                  />
                </label>
              </div>
              <label className="storage-muted" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                Notes
                <input
                  className="storage-field"
                  style={{ marginTop: 4 }}
                  value={vectorConnDraft.description}
                  onChange={(e) => setVectorConnDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>
              <div className="storage-row-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="storage-btn"
                  disabled={vectorConnSaving || !vectorConnDraft.display_name.trim()}
                  onClick={() => void saveVectorConnection()}
                >
                  {vectorConnSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Connect dataset
                </button>
              </div>
            </div>
            <div className="storage-card">
              <table className="storage-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Target</th>
                    <th>Dims</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(vectors?.tenant_connections || []).map((c: Row) => (
                    <tr key={c.id}>
                      <td>{c.display_name}</td>
                      <td>{c.provider}</td>
                      <td>{c.index_name || c.table_name || '—'}</td>
                      <td>{c.dimensions || '—'}</td>
                      <td>
                        <Badge tone={c.connection_status === 'connected' ? 'ok' : 'warn'}>
                          {c.connection_status || 'pending'}
                        </Badge>
                      </td>
                      <td>{fmtTs(c.updated_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="storage-btn"
                          onClick={() => void removeVectorConnection(String(c.id))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!(vectors?.tenant_connections || []).length && (
                    <tr>
                      <td colSpan={7} className="storage-muted">
                        No connections yet — add a Cloudflare index or Supabase table above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {nav === 'cleanup' && (
          <>
            <div className="storage-grid"><Stat label="Unreviewed" value={n(cleanup.unreviewed)} /><Stat label="Reviewed" value={n(cleanup.reviewed)} /><Stat label="Archived" value={n(cleanup.archived)} /><Stat label="R2 Buckets" value={r2BucketRows.length} /></div>
            <div className="storage-card"><table className="storage-table"><thead><tr><th>Bucket</th><th>Objects</th><th>Size</th><th>Project</th><th>Owner</th><th>Last Inventoried</th><th>Actions</th></tr></thead><tbody>{r2BucketRows.filter((b: Row) => isR2BucketRow(b) && (b.cleanup_status || 'unreviewed') === 'unreviewed').map((b: Row) => <tr key={b.bucket_name || b.storage_name}><td>{b.bucket_name || b.storage_name}</td><td>{formatObjectCount(b)}</td><td>{formatSizeMb(b)}</td><td>{b.project_ref || '—'}</td><td>{b.owner || '—'}</td><td>{fmtTs(b.last_inventoried_at)}</td><td><div className="storage-row-actions"><button className="storage-btn" onClick={() => markCleanup(b.bucket_name || b.storage_name, 'reviewed')}>Mark Reviewed</button><button className="storage-btn" onClick={() => markCleanup(b.bucket_name || b.storage_name, 'archived')}>Archive</button></div></td></tr>)}</tbody></table></div>
          </>
        )}

        {nav === 'activity' && (
          <>
            <div className="storage-top"><input className="storage-field" placeholder="worker_name" value={filters.worker_name} onChange={(e) => setFilters({ ...filters, worker_name: e.target.value })} /><input className="storage-field" placeholder="outcome" value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })} /><input className="storage-field" type="date" value={filters.start} onChange={(e) => setFilters({ ...filters, start: e.target.value })} /><input className="storage-field" type="date" value={filters.end} onChange={(e) => setFilters({ ...filters, end: e.target.value })} /><button className="storage-btn" onClick={loadActivity}>Apply</button></div>
            <div className="storage-card"><table className="storage-table"><thead><tr><th>Timestamp</th><th>Worker</th><th>Method</th><th>URL</th><th>Status</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>{(activity?.events || []).map((e: Row) => <tr key={e.id || e.event_id}><td>{fmtTs(e.timestamp)}</td><td>{e.worker_name}</td><td>{e.method}</td><td>{String(e.url || '').slice(0, 70)}</td><td>{e.status}</td><td>{n(e.duration_ms)}ms</td><td><Badge tone={e.outcome === 'ok' ? 'ok' : e.outcome === 'exception' ? 'warn' : 'bad'}>{e.outcome || 'unknown'}</Badge></td></tr>)}</tbody></table></div>
          </>
        )}

        {nav === 'policies' && (
          <div className="storage-card"><table className="storage-table"><thead><tr><th>Bucket</th><th>Resource</th><th>Effect</th><th>Actions</th><th>Storage Status</th><th>Updated</th></tr></thead><tbody>{(policies?.policies || []).map((p: Row) => <tr key={p.id}><td>{p.bucket_name}</td><td>{p.resource}</td><td><Badge tone={p.effect === 'allow' ? 'ok' : 'bad'}>{p.effect}</Badge></td><td>{p.actions}</td><td>{p.storage_status || 'n/a'}</td><td>{fmtTs(p.updated_at || p.created_at)}</td></tr>)}</tbody></table></div>
        )}

        {nav === 's3' && (
          <>
            <div className="storage-grid"><Stat label="Endpoint" value={<span style={{ fontSize: 12 }}>{s3?.endpoint || 'n/a'}</span>} /><Stat label="Region" value={s3?.region || 'auto'} /><Stat label="Access Keys" value={(s3?.accessKeys || s3?.keys || []).length} /><Stat label="Buckets" value={(s3?.source_buckets || []).length} /></div>
            <div className="storage-card storage-pad" style={{ marginBottom: 14 }}><label className="storage-muted">Source bucket</label><br /><select className="storage-field">{(s3?.source_buckets || bucketRows).map((b: Row) => <option key={b.storage_name || b.bucket_name}>{b.storage_name || b.bucket_name}</option>)}</select><p className="storage-muted">Allowed buckets: {s3?.allowed_buckets_json || '[]'}</p></div>
            <div className="storage-card"><table className="storage-table"><thead><tr><th>Access Key</th><th>Created</th><th>Status</th></tr></thead><tbody>{(s3?.accessKeys || s3?.keys || []).map((k: Row) => <tr key={k.id || k.accessKeyId}><td>{k.accessKeyId || k.id}</td><td>{fmtTs(k.created_at || k.createdAt)}</td><td>{k.status}</td></tr>)}</tbody></table></div>
          </>
        )}

        {nav === 'providers' && (
          <>
            <p className="storage-muted" style={{ marginBottom: 14 }}>
              One row per provider in <code className="storage-muted">user_storage_provider_preferences</code>. OAuth status reflects{' '}
              <code className="storage-muted">user_oauth_tokens</code>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {providerSpecs.map((spec) => {
                const open = !!providerExpanded[spec.id];
                const connected =
                  spec.oauthKey != null && oauthProviders.includes(String(spec.oauthKey).toLowerCase());
                const draft = providerDrafts[spec.id] || {};
                return (
                  <div className="storage-card" key={spec.id}>
                    <button
                      type="button"
                      className="storage-provider-head"
                      onClick={() => setProviderExpanded((p) => ({ ...p, [spec.id]: !open }))}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <strong>{spec.title}</strong>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {spec.oauthKey != null && (
                          <Badge tone={connected ? 'ok' : 'muted'}>{connected ? 'Connected' : 'Not connected'}</Badge>
                        )}
                      </span>
                    </button>
                    {open && (
                      <div className="storage-provider-body">
                        {spec.fields.map((f) => {
                          const readOnlyGoogle =
                            spec.id === 'google_drive' &&
                            f === 'folder_name' &&
                            oauthProviders.includes('google_drive');
                          const masked = f === 'secret_access_key' && draft[f] === '********';
                          return (
                            <label key={f} className="storage-muted" style={{ fontSize: 11 }}>
                              {fieldLabel(f)}
                              <input
                                className="storage-field"
                                style={{ marginTop: 4 }}
                                value={masked ? '' : draft[f] != null ? String(draft[f]) : ''}
                                placeholder={masked ? '•••••••• (saved)' : ''}
                                readOnly={readOnlyGoogle}
                                type={f === 'secret_access_key' ? 'password' : 'text'}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setProviderDrafts((prev) => ({
                                    ...prev,
                                    [spec.id]: { ...(prev[spec.id] || {}), [f]: v },
                                  }));
                                }}
                              />
                            </label>
                          );
                        })}
                        <div className="storage-row-actions">
                          <button
                            type="button"
                            className="storage-btn"
                            disabled={providerSaving === spec.id}
                            onClick={() => void saveProvider(spec.id)}
                          >
                            {providerSaving === spec.id ? <Loader2 size={13} className="animate-spin" /> : null}
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {loading && <div className="storage-muted" style={{ marginTop: 12 }}><Loader2 size={14} className="animate-spin" /> Loading</div>}
      </main>
    </div>
  );
};
