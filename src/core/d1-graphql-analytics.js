/**
 * Cloudflare D1 GraphQL Analytics — mirrors CF dashboard metrics.
 * @see https://developers.cloudflare.com/d1/observability/metrics-analytics/
 */
import { DB } from './worker-bindings.js';

/** @deprecated Use DB.database_id */
export const IAM_D1_DATABASE_ID = DB.database_id;
/** @deprecated Use DB.database_name */
export const IAM_D1_DATABASE_NAME = DB.database_name;

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const CACHE_TTL_SEC = 600;

/** @param {string} range */
export function rangeSecondsForAnalytics(range) {
  if (range === '1h') return 3600;
  if (range === '24h') return 86400;
  if (range === '7d') return 7 * 86400;
  if (range === '30d') return 30 * 86400;
  return 86400;
}

/** @param {string} range */
function rangeWindow(range) {
  const endMs = Date.now();
  const sec = rangeSecondsForAnalytics(range);
  const useCalendarDays = range === '7d' || range === '30d';
  const dayCount = range === '7d' ? 7 : range === '30d' ? 30 : 0;

  if (useCalendarDays) {
    const endDay = new Date(endMs);
    endDay.setUTCHours(0, 0, 0, 0);
    const startDay = new Date(endDay);
    startDay.setUTCDate(startDay.getUTCDate() - (dayCount - 1));
    const prevEndDay = new Date(startDay);
    prevEndDay.setUTCDate(prevEndDay.getUTCDate() - 1);
    const prevStartDay = new Date(prevEndDay);
    prevStartDay.setUTCDate(prevStartDay.getUTCDate() - (dayCount - 1));
    return {
      start: startDay.toISOString(),
      end: new Date(endMs).toISOString(),
      prevStart: prevStartDay.toISOString(),
      startDate: startDay.toISOString().slice(0, 10),
      endDate: endDay.toISOString().slice(0, 10),
      prevStartDate: prevStartDay.toISOString().slice(0, 10),
      prevEndDate: prevEndDay.toISOString().slice(0, 10),
    };
  }

  const startMs = endMs - sec * 1000;
  const prevStartMs = startMs - sec * 1000;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    prevStart: new Date(prevStartMs).toISOString(),
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(endMs).toISOString().slice(0, 10),
    prevStartDate: new Date(prevStartMs).toISOString().slice(0, 10),
    prevEndDate: new Date(startMs).toISOString().slice(0, 10),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {string} range */
function bucketMsForRange(range) {
  if (range === '1h') return 5 * 60 * 1000;
  if (range === '24h') return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/**
 * @param {number} tsMs
 * @param {string} range
 */
function formatBucketLabel(tsMs, range) {
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getUTCDate();
  const mon = MONTHS[d.getUTCMonth()];
  if (range === '1h') {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (range === '24h') {
    return `${mon} ${day}, ${String(d.getUTCHours()).padStart(2, '0')}:00`;
  }
  return `${mon} ${day}`;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} range
 * @param {string} filterKey
 */
function aggregateChartBuckets(rows, range, filterKey) {
  const bucketMs = bucketMsForRange(range);
  /** @type {Map<number, { readQueries: number, writeQueries: number, rowsRead: number, rowsWritten: number, latW: number, p50: number, p95: number, p99: number }>} */
  const buckets = new Map();

  for (const row of rows) {
    const dim = row?.dimensions ?? {};
    const raw = dim[filterKey] ?? dim.datetime ?? dim.date ?? '';
    const ts = new Date(String(raw)).getTime();
    if (Number.isNaN(ts)) continue;
    const key = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets.has(key)) {
      buckets.set(key, {
        readQueries: 0,
        writeQueries: 0,
        rowsRead: 0,
        rowsWritten: 0,
        latW: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      });
    }
    const b = buckets.get(key);
    const rq = Number(row?.sum?.readQueries) || 0;
    const wq = Number(row?.sum?.writeQueries) || 0;
    const vol = rq + wq;
    b.readQueries += rq;
    b.writeQueries += wq;
    b.rowsRead += Number(row?.sum?.rowsRead) || 0;
    b.rowsWritten += Number(row?.sum?.rowsWritten) || 0;
    const p50 = Number(row?.quantiles?.queryBatchTimeMsP50) || 0;
    const p95 = Number(row?.quantiles?.queryBatchTimeMsP90) || 0;
    const p99 = Number(row?.quantiles?.queryBatchTimeMsP99) || 0;
    if (vol > 0 && p50 > 0) {
      b.p50 = (b.p50 * b.latW + p50 * vol) / (b.latW + vol);
      b.p95 = (b.p95 * b.latW + p95 * vol) / (b.latW + vol);
      b.p99 = (b.p99 * b.latW + p99 * vol) / (b.latW + vol);
      b.latW += vol;
    }
  }

  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const labels = [];
  const readQueries = [];
  const writeQueries = [];
  const totalQueries = [];
  const rowsReadSeries = [];
  const rowsWrittenSeries = [];
  const latencyP50 = [];
  const latencyP95 = [];
  const latencyP99 = [];

  for (const [ts, b] of sorted) {
    labels.push(formatBucketLabel(ts, range));
    readQueries.push(b.readQueries);
    writeQueries.push(b.writeQueries);
    totalQueries.push(b.readQueries + b.writeQueries);
    rowsReadSeries.push(b.rowsRead);
    rowsWrittenSeries.push(b.rowsWritten);
    latencyP50.push(Math.round(b.p50 * 100) / 100);
    latencyP95.push(Math.round(b.p95 * 100) / 100);
    latencyP99.push(Math.round(b.p99 * 100) / 100);
  }

  return {
    labels,
    totalQueries,
    readQueries,
    writeQueries,
    rowsRead: rowsReadSeries,
    rowsWritten: rowsWrittenSeries,
    latencyP50,
    latencyP95,
    latencyP99,
  };
}

/**
 * @param {any} env
 * @param {string} accountId
 * @param {string} token
 * @param {string} query
 * @param {Record<string, unknown>} variables
 */
async function cloudflareGraphql(env, accountId, token, query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { accountTag: accountId, ...variables } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.errors?.[0]?.message || json?.message || `GraphQL HTTP ${res.status}`);
  }
  if (json?.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json?.data ?? null;
}

/**
 * @param {any} kv
 * @param {string} key
 * @param {() => Promise<T>} fetchFn
 * @template T
 */
async function cachedFetch(kv, key, fetchFn) {
  if (kv) {
    try {
      const raw = await kv.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.cachedAt && Date.now() - parsed.cachedAt < CACHE_TTL_SEC * 1000) {
          return /** @type {T} */ (parsed.data);
        }
      }
    } catch {
      /* ignore cache read errors */
    }
  }
  const data = await fetchFn();
  if (kv) {
    try {
      await kv.put(key, JSON.stringify({ cachedAt: Date.now(), data }), {
        expirationTtl: CACHE_TTL_SEC,
      });
    } catch {
      /* ignore cache write errors */
    }
  }
  return data;
}

/**
 * @param {any} env
 * @param {{ accountId: string, token: string, databaseId: string, range: string }} opts
 */
export async function fetchD1AnalyticsOverview(env, opts) {
  const { accountId, token, databaseId, range } = opts;
  const win = rangeWindow(range);
  const kv = env?.SESSION_CACHE || env?.KV || null;
  const cacheKey = `d1_gql:v4:${databaseId}:${range}`;

  return cachedFetch(kv, cacheKey, async () => {
    const useDatetime = range === '1h' || range === '24h';
    const filterKey = useDatetime ? 'datetime' : 'date';
    const startKey = useDatetime ? 'datetime_geq' : 'date_geq';
    const endKey = useDatetime ? 'datetime_leq' : 'date_leq';
    const orderBy = useDatetime ? 'datetime_ASC' : 'date_ASC';
    const dimKey = useDatetime ? 'datetime' : 'date';
    const startVal = useDatetime ? win.start : win.startDate;
    const endVal = useDatetime ? win.end : win.endDate;
    const prevStartVal = useDatetime ? win.prevStart : win.prevStartDate;

    const prevEndVal = useDatetime ? win.start : (win.prevEndDate ?? win.startDate);

    const analyticsQuery = `
      query D1AnalyticsOverview($accountTag: string!, $databaseId: string!, $start: ${useDatetime ? 'DateTime' : 'Date'}!, $end: ${useDatetime ? 'DateTime' : 'Date'}!, $prevStart: ${useDatetime ? 'DateTime' : 'Date'}!, $prevEnd: ${useDatetime ? 'DateTime' : 'Date'}!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            current: d1AnalyticsAdaptiveGroups(
              limit: 10000
              filter: { databaseId: $databaseId, ${startKey}: $start, ${endKey}: $end }
              orderBy: [${orderBy}]
            ) {
              sum { readQueries writeQueries rowsRead rowsWritten }
              quantiles { queryBatchTimeMsP50 queryBatchTimeMsP90 queryBatchTimeMsP99 }
              dimensions { ${dimKey} }
            }
            previous: d1AnalyticsAdaptiveGroups(
              limit: 10000
              filter: { databaseId: $databaseId, ${startKey}: $prevStart, ${endKey}: $prevEnd }
            ) {
              sum { readQueries writeQueries rowsRead rowsWritten }
            }
            storage: d1StorageAdaptiveGroups(
              limit: 1
              filter: { databaseId: $databaseId, ${startKey}: $start, ${endKey}: $end }
              orderBy: [max_databaseSizeBytes_DESC]
            ) {
              max { databaseSizeBytes }
            }
          }
        }
      }`;

    const vars = {
      databaseId,
      start: startVal,
      end: endVal,
      prevStart: prevStartVal,
      prevEnd: prevEndVal,
    };

    const insightsQuery = `
        query D1QueryInsights($accountTag: string!, $databaseId: string!, $start: ${useDatetime ? 'DateTime' : 'Date'}!, $end: ${useDatetime ? 'DateTime' : 'Date'}!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              topQueries: d1QueriesAdaptiveGroups(
                limit: 20
                filter: { databaseId: $databaseId, ${startKey}: $start, ${endKey}: $end }
                orderBy: [sum_queryDurationMs_DESC]
              ) {
                count
                dimensions { query }
                sum { rowsRead rowsWritten queryDurationMs }
                quantiles { queryDurationMsP50 queryDurationMsP99 }
              }
            }
          }
        }`;

    let data;
    let queryRows = [];
    try {
      const [analyticsData, insightsData] = await Promise.all([
        cloudflareGraphql(env, accountId, token, analyticsQuery, vars),
        cloudflareGraphql(env, accountId, token, insightsQuery, {
          databaseId,
          start: startVal,
          end: endVal,
        }).catch(() => null),
      ]);
      data = analyticsData;
      queryRows = insightsData?.viewer?.accounts?.[0]?.topQueries ?? [];
    } catch (e) {
      throw e;
    }

    const account = data?.viewer?.accounts?.[0] ?? {};
    const currentRows = account.current ?? [];
    const previousRows = account.previous ?? [];
    const storageRows = account.storage ?? [];

    const sumRows = (rows, pick) =>
      rows.reduce(
        (acc, row) => {
          const s = row?.sum ?? {};
          for (const k of pick) acc[k] += Number(s[k]) || 0;
          return acc;
        },
        { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 },
      );

    const currentSum = sumRows(currentRows, ['readQueries', 'writeQueries', 'rowsRead', 'rowsWritten']);
    const previousSum = sumRows(previousRows, ['readQueries', 'writeQueries', 'rowsRead', 'rowsWritten']);

    const chartBuckets = aggregateChartBuckets(currentRows, range, filterKey);
    const {
      labels,
      totalQueries,
      readQueries,
      writeQueries,
      rowsRead: rowsReadSeries,
      rowsWritten: rowsWrittenSeries,
      latencyP50,
      latencyP95,
      latencyP99,
    } = chartBuckets;

    const storageBytes = Number(storageRows[0]?.max?.databaseSizeBytes) || 0;

    const totalRuntimeMs = queryRows.reduce(
      (s, r) => s + (Number(r?.sum?.queryDurationMs) || 0),
      0,
    );

    const queries = queryRows
      .map((row) => {
        const q = String(row?.dimensions?.query || '').trim();
        if (!q) return null;
        const count = Number(row?.count) || 0;
        const totalMs = Number(row?.sum?.queryDurationMs) || 0;
        const p50 = Number(row?.quantiles?.queryDurationMsP50) || 0;
        const p99 = Number(row?.quantiles?.queryDurationMsP99) || 0;
        const rowsRead = Number(row?.sum?.rowsRead) || 0;
        const rowsWritten = Number(row?.sum?.rowsWritten) || 0;
        return {
          fingerprint: q.slice(0, 240),
          tool_name: 'd1',
          datasource: 'd1',
          call_count: count,
          runtime_pct:
            totalRuntimeMs > 0
              ? Math.round((totalMs / totalRuntimeMs) * 1000) / 10
              : 0,
          avg_ms: count > 0 ? Math.round(totalMs / count) : 0,
          p50_ms: Math.round(p50),
          p99_ms: Math.round(p99),
          rows_read: rowsRead,
          rows_written: rowsWritten,
          rows_per_run: count > 0 ? Math.round(rowsRead / count) : 0,
          errors: 0,
          last_seen: null,
        };
      })
      .filter(Boolean);

    const latHeadline = {
      p50: latencyP50.filter((v) => v > 0).slice(-1)[0] ?? 0,
      p95: latencyP95.filter((v) => v > 0).slice(-1)[0] ?? 0,
      p99: latencyP99.filter((v) => v > 0).slice(-1)[0] ?? 0,
    };

    return {
      source: 'cloudflare_graphql',
      wired: currentSum.readQueries + currentSum.writeQueries > 0 || storageBytes > 0,
      window: {
        start: startVal,
        end: endVal,
        prevStart: prevStartVal,
        prevEnd: prevEndVal,
      },
      kpis: {
        queries: currentSum.readQueries + currentSum.writeQueries,
        queriesPrev: previousSum.readQueries + previousSum.writeQueries,
        rowsRead: currentSum.rowsRead,
        rowsReadPrev: previousSum.rowsRead,
        rowsWritten: currentSum.rowsWritten,
        rowsWrittenPrev: previousSum.rowsWritten,
        storageBytes,
        p95Ms: latHeadline.p95,
      },
      charts: {
        labels,
        totalQueries,
        readQueries,
        writeQueries,
        rowsRead: rowsReadSeries,
        rowsWritten: rowsWrittenSeries,
        latencyP50,
        latencyP95,
        latencyP99,
        headlineMs: latHeadline,
      },
      queries,
    };
  });
}

/**
 * Resolve platform Cloudflare credentials from env.
 * @param {any} env
 */
export function resolveCloudflareAnalyticsCreds(env) {
  const token = env?.CLOUDFLARE_API_TOKEN != null ? String(env.CLOUDFLARE_API_TOKEN).trim() : '';
  const accountId =
    env?.CLOUDFLARE_ACCOUNT_ID != null ? String(env.CLOUDFLARE_ACCOUNT_ID).trim() : '';
  if (!token || !accountId) {
    return null;
  }
  return { token, accountId };
}
