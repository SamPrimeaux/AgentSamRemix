/**
 * Pure helpers + thin D1 query wrappers for analytics/databases dual-lane peel.
 * No Hyperdrive / fetch — only formatters, parsers, SQL clause builders, d1All/d1First.
 */

export const SQL_DB_TOOL_D1 = `(
  tool_name IN ('d1_query','d1_schema','d1_explain','d1_write','d1_batch_write')
  OR tool_name LIKE 'd1_%'
  OR tool_name LIKE 'agentsam_d1_%'
  OR COALESCE(tool_category,'') LIKE 'database.d1%'
)`;

export const SQL_DB_TOOL_SUPABASE = `(
  tool_name IN ('hyperdrive_query','hyperdrive_schema','hyperdrive_explain')
  OR tool_name LIKE 'hyperdrive_%'
  OR tool_name LIKE 'agentsam_supabase_%'
  OR COALESCE(tool_category,'') LIKE 'database.hyperdrive%'
  OR COALESCE(tool_category,'') LIKE 'database.supabase%'
)`;

export const D1_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Supabase provisioned disk display when tier metadata is unavailable. */
export const SUPABASE_PROVISIONED_BYTES = 8 * 1024 * 1024 * 1024;

export function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function d1All(db, label, sql, binds, warnings) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch (e) {
    warnings.push({
      code: 'D1_QUERY_ERROR',
      message: `${label}: ${String(e?.message || e)}`,
      severity: 'warn',
    });
    return [];
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function d1First(db, label, sql, binds, warnings) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch (e) {
    warnings.push({
      code: 'D1_QUERY_ERROR',
      message: `${label}: ${String(e?.message || e)}`,
      severity: 'warn',
    });
    return null;
  }
}

export function parseDatabasesRange(url) {
  const raw = String(url?.searchParams?.get('range') || '24h').toLowerCase();
  if (raw === '1h') return '1h';
  if (raw === '24h') return '24h';
  if (raw === '30d') return '30d';
  if (raw === '7d') return '7d';
  return '24h';
}

export function parseDatabasesDs(url) {
  const surface = parseDatabasesSurface(url);
  if (surface === 'cloudflare') return 'd1';
  if (surface === 'supabase') return 'supabase';
  const raw = String(url?.searchParams?.get('ds') || 'all').toLowerCase();
  if (raw === 'd1' || raw === 'supabase') return raw;
  return 'all';
}

/** @param {URL} url */
export function parseDatabasesSurface(url) {
  const surface = String(url?.searchParams?.get('surface') || '').toLowerCase();
  if (surface === 'cloudflare' || surface === 'supabase') return surface;
  const ds = String(url?.searchParams?.get('ds') || '').toLowerCase();
  if (ds === 'd1') return 'cloudflare';
  if (ds === 'supabase') return 'supabase';
  return 'cloudflare';
}

export function rangeSeconds(range) {
  if (range === '1h') return 3600;
  if (range === '24h') return 86400;
  if (range === '7d') return 7 * 86400;
  if (range === '30d') return 30 * 86400;
  return 86400;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function rangeStartSec(range) {
  return nowSec() - rangeSeconds(range);
}

export function rangeStartNano(range) {
  return rangeStartSec(range) * 1_000_000_000;
}

/** @param {{ tenantId: string|null, workspaceId: string|null, tableCols: Set<string> }} scope */
export function tenantWorkspaceClause(scope, binds) {
  const parts = [];
  if (scope.tenantId && scope.tableCols.has('tenant_id')) {
    parts.push('tenant_id = ?');
    binds.push(scope.tenantId);
  }
  if (scope.workspaceId && scope.tableCols.has('workspace_id')) {
    parts.push('workspace_id = ?');
    binds.push(scope.workspaceId);
  }
  return parts;
}

export function dbToolClause(ds) {
  if (ds === 'd1') return SQL_DB_TOOL_D1;
  if (ds === 'supabase') return SQL_DB_TOOL_SUPABASE;
  return `(${SQL_DB_TOOL_D1} OR ${SQL_DB_TOOL_SUPABASE})`;
}

export function pctTrend(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p <= 0) return { pct: c > 0 ? 100 : 0, dir: c > 0 ? 'up' : 'neutral' };
  const pct = ((c - p) / p) * 100;
  return {
    pct: Math.round(pct * 10) / 10,
    dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'neutral',
  };
}

export function bucketExpr(range, timeColUnixSec) {
  if (range === '1h') {
    return `CAST((${timeColUnixSec}) / 300 AS INTEGER)`;
  }
  if (range === '24h') {
    return `strftime('%H:00', datetime(${timeColUnixSec}, 'unixepoch'))`;
  }
  return `strftime('%Y-%m-%d', datetime(${timeColUnixSec}, 'unixepoch'))`;
}

export function buildBucketLabels(range) {
  const start = rangeStartSec(range);
  const end = nowSec();
  const labels = [];
  if (range === '1h') {
    const step = 300;
    for (let t = start; t < end; t += step) {
      labels.push(String(Math.floor(t / 300)));
    }
    return labels.length ? labels : [String(Math.floor(start / 300))];
  }
  if (range === '24h') {
    for (let i = 0; i < 24; i++) {
      const d = new Date((start + i * 3600) * 1000);
      labels.push(`${String(d.getUTCHours()).padStart(2, '0')}:00`);
    }
    return labels;
  }
  const daySec = 86400;
  const days = range === '30d' ? 30 : 7;
  for (let i = 0; i < days; i++) {
    const d = new Date((start + i * daySec) * 1000);
    labels.push(d.toISOString().slice(0, 10));
  }
  return labels;
}

export function seriesFromRows(labels, rows, key = 'bucket') {
  const map = new Map(rows.map((r) => [String(r[key]), Number(r.c ?? r.v ?? 0) || 0]));
  return labels.map((l) => map.get(l) ?? 0);
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

export function formatActivityCount(n, suffix) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B ${suffix}`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M ${suffix}`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k ${suffix}`;
  return `${v} ${suffix}`;
}

/** @param {string} sql */
export function extractTableNamesFromSql(sql) {
  if (!sql || typeof sql !== 'string') return [];
  const cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const found = new Set();
  const re =
    /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([a-zA-Z_][a-zA-Z0-9_]*))/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const name = (m[1] || m[2] || m[3] || m[4] || '').trim();
    const lower = name.toLowerCase();
    if (!name || lower === 'select' || lower === 'dual' || name.startsWith('sqlite_')) continue;
    found.add(name);
  }
  return [...found];
}

/**
 * @param {Array<{ name: string, val: string, ds: 'd1'|'supabase', sort: number }>} items
 * @param {'d1'|'supabase'|'all'} dsFilter
 */
export function topHotTables(items, dsFilter, limit = 5) {
  let list = items;
  if (dsFilter !== 'all') list = list.filter((x) => x.ds === dsFilter);
  return [...list]
    .sort((a, b) => b.sort - a.sort)
    .slice(0, limit)
    .map(({ name, val, ds }) => ({ name, val, ds }));
}

/** @param {number[]} durations @param {number} [maxMs] */
export function percentileMs(durations, pct, maxMs = 120_000) {
  const filtered = durations.filter((d) => Number.isFinite(d) && d >= 0 && d <= maxMs);
  if (!filtered.length) return 0;
  filtered.sort((a, b) => a - b);
  const idx = Math.min(filtered.length - 1, Math.floor(filtered.length * pct));
  return filtered[idx];
}

/** @param {number|null|undefined} pct */
export function capacityLevel(pct) {
  if (pct == null || Number.isNaN(pct)) return 'unknown';
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'action';
  if (pct >= 50) return 'watch';
  return 'ok';
}

/**
 * @param {number} epochSec
 */
export function formatRelativeEpoch(epochSec) {
  if (!epochSec) return null;
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - epochSec);
  if (delta < 3600) return `${Math.max(1, Math.floor(delta / 60))}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/**
 * @param {{ usedBytes?: number|null, limitBytes: number, usedLabel?: string|null, limitLabel: string, subtitle?: string|null, subtitleOk?: boolean, level?: string, retentionAt?: number|null, retentionOk?: boolean, connectionsUsed?: number|null, connectionsMax?: number|null, hyperdriveStatus?: string|null, hyperdriveLatencyMs?: number|null, autovacuumAt?: number|null }} opts
 */
export function buildCapacityPayload(opts) {
  const usedBytes = opts.usedBytes ?? null;
  const limitBytes = opts.limitBytes;
  const pctUsed =
    usedBytes != null && limitBytes > 0
      ? Math.round((usedBytes / limitBytes) * 1000) / 10
      : null;
  return {
    usedBytes,
    limitBytes,
    usedLabel: opts.usedLabel ?? (usedBytes != null ? formatBytes(usedBytes) : null),
    limitLabel: opts.limitLabel,
    pctUsed,
    level: opts.level ?? capacityLevel(pctUsed),
    subtitle: opts.subtitle ?? null,
    subtitleOk: opts.subtitleOk ?? true,
    retentionAt: opts.retentionAt ?? null,
    retentionOk: opts.retentionOk ?? null,
    autovacuumAt: opts.autovacuumAt ?? null,
    connectionsUsed: opts.connectionsUsed ?? null,
    connectionsMax: opts.connectionsMax ?? null,
    hyperdriveStatus: opts.hyperdriveStatus ?? null,
    hyperdriveLatencyMs: opts.hyperdriveLatencyMs ?? null,
    wired: usedBytes != null && usedBytes > 0,
  };
}

export function pgQualifiedName(schema, rel) {
  const s = String(schema || 'public');
  const r = String(rel || '');
  return s === 'public' ? r : `${s}.${r}`;
}

export function kpiFromValues(current, previous, wired, msField = false) {
  const trend = pctTrend(current, previous);
  return {
    value: current,
    ...(msField ? { valueMs: current } : {}),
    trendPct: trend.pct,
    dir: trend.dir,
    wired,
  };
}

