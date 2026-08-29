import { parseRange, analyticsResponse } from './sources/normalize.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../../backend/services/database/hyperdrive.js';

function safeTableIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error('invalid identifier');
  return `"${s.replace(/"/g, '""')}"`;
}

async function hyperdriveQuery(env, sql, params = []) {
  if (!isHyperdriveUsable(env)) return { ok: false, rows: [], warning: 'hyperdrive_missing' };
  const r = await runHyperdriveQuery(env, sql, params);
  if (!r.ok) return { ok: false, rows: [], warning: r.error || 'query_failed' };
  return { ok: true, rows: r.rows ?? [] };
}

async function hasColumn(env, tableName, colName) {
  const out = await hyperdriveQuery(
    env,
    `SELECT 1 AS ok
     FROM information_schema.columns
     WHERE table_schema = 'agentsam' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [String(tableName), String(colName)],
  );
  return out.ok && (out.rows || []).length > 0;
}

function intervalForRange(range) {
  if (range === '24h') return `interval '24 hours'`;
  if (range === '30d') return `interval '30 days'`;
  if (range === 'all') return null;
  return `interval '7 days'`;
}

function safePct(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / d) * 1000) / 10));
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || '').trim(),
  );
}

export async function handleAnalyticsRag(_request, url, env, { tenantId, workspaceId }) {
  const range = parseRange(url);
  const warnings = [];
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid =
    workspaceId && isUuid(workspaceId) ? String(workspaceId).trim() : null;

  if (!isHyperdriveUsable(env)) {
    return analyticsResponse({
      ok: true,
      backend: 'supabase',
      range,
      summary: {},
      rows: [],
      breakdowns: [],
      series: [],
      warnings: [
        {
          code: 'HYPERDRIVE_BINDING_MISSING',
          message:
            'Hyperdrive is not usable (binding missing or no .query / connectionString); Supabase-backed RAG analytics are unavailable.',
          backend: 'supabase',
          severity: 'critical',
        },
      ],
    });
  }

  // public.* RAG tables were never cut over — live tables are agentsam.*
  const docsTable = 'agentsam_documents_oai3large_1536';
  const logTable = 'agentsam_search_log';
  const memoryTable = 'agentsam_memory';

  const [
    docsHasTenant,
    docsHasWorkspace,
    logHasTenant,
    logHasWorkspace,
    memoryHasTenant,
    memoryHasWorkspace,
    docsHasEmbedding,
    docsHasCreatedAt,
    logHasCreatedAt,
    docsHasMetadata,
    docsHasSourceType,
  ] = await Promise.all([
    hasColumn(env, docsTable, 'tenant_id'),
    hasColumn(env, docsTable, 'workspace_id'),
    hasColumn(env, logTable, 'tenant_id'),
    hasColumn(env, logTable, 'workspace_id'),
    hasColumn(env, memoryTable, 'tenant_id'),
    hasColumn(env, memoryTable, 'workspace_id'),
    hasColumn(env, docsTable, 'embedding'),
    hasColumn(env, docsTable, 'created_at'),
    hasColumn(env, logTable, 'created_at'),
    hasColumn(env, docsTable, 'metadata'),
    hasColumn(env, docsTable, 'source_type'),
  ]);

  const rangeInterval = intervalForRange(range);

  const docsWhere = [];
  const docsParams = [];
  if (docsHasWorkspace && wid) {
    docsParams.push(wid);
    docsWhere.push(`workspace_id = $${docsParams.length}::uuid`);
  } else if (docsHasTenant && tid) {
    docsParams.push(tid);
    docsWhere.push(`tenant_id = $${docsParams.length}`);
  }
  if (rangeInterval && docsHasCreatedAt) {
    docsWhere.push(`created_at >= now() - ${rangeInterval}`);
  }
  const docsWhereSql = docsWhere.length ? `WHERE ${docsWhere.join(' AND ')}` : '';

  const logWhere = [];
  const logParams = [];
  if (logHasWorkspace && wid) {
    logParams.push(wid);
    logWhere.push(`workspace_id = $${logParams.length}::uuid`);
  } else if (logHasTenant && tid) {
    logParams.push(tid);
    logWhere.push(`tenant_id = $${logParams.length}`);
  }
  if (rangeInterval && logHasCreatedAt) {
    logWhere.push(`created_at >= now() - ${rangeInterval}`);
  }
  const logWhereSql = logWhere.length ? `WHERE ${logWhere.join(' AND ')}` : '';

  const memoryWhere = [];
  const memoryParams = [];
  if (memoryHasWorkspace && wid) {
    memoryParams.push(wid);
    memoryWhere.push(`workspace_id = $${memoryParams.length}::uuid`);
  } else if (memoryHasTenant && tid) {
    memoryParams.push(tid);
    memoryWhere.push(`tenant_id = $${memoryParams.length}`);
  }
  const memoryWhereSql = memoryWhere.length ? `WHERE ${memoryWhere.join(' AND ')}` : '';

  const docsIdent = safeTableIdent(docsTable);
  const logIdent = safeTableIdent(logTable);
  const memoryIdent = safeTableIdent(memoryTable);

  const docsCountP = hyperdriveQuery(
    env,
    `SELECT COUNT(*)::int AS c FROM agentsam.${docsIdent} ${docsWhereSql}`,
    docsParams,
  );

  const embeddedCountP = docsHasEmbedding
    ? hyperdriveQuery(
        env,
        `SELECT COUNT(*)::int AS c FROM agentsam.${docsIdent} ${docsWhereSql}${
          docsWhereSql ? ' AND' : 'WHERE'
        } embedding IS NOT NULL`,
        docsParams,
      )
    : Promise.resolve({ ok: true, rows: [{ c: null }] });

  const sourceCol = docsHasSourceType ? 'source_type' : 'NULL';
  const sourcesP = docsHasSourceType
    ? hyperdriveQuery(
        env,
        `SELECT ${sourceCol} AS key, COUNT(*)::int AS count
         FROM agentsam.${docsIdent}
         ${docsWhereSql}
         GROUP BY source_type
         ORDER BY COUNT(*) DESC
         LIMIT 20`,
        docsParams,
      )
    : Promise.resolve({ ok: true, rows: [] });

  const logAggP = hyperdriveQuery(
    env,
    `SELECT
       COUNT(*)::int AS c,
       ROUND(AVG(duration_ms))::int AS avg_latency_ms,
       ROUND(AVG(result_count))::int AS avg_result_count
     FROM agentsam.${logIdent}
     ${logWhereSql}`,
    logParams,
  );

  const recentDocsP = hyperdriveQuery(
    env,
    `SELECT id, source_type AS source, title,
       ${docsHasCreatedAt ? 'created_at,' : 'NULL AS created_at,'}
       ${
         docsHasEmbedding
           ? 'CASE WHEN embedding IS NULL THEN false ELSE true END AS has_embedding,'
           : 'NULL AS has_embedding,'
       }
       ${docsHasMetadata ? 'metadata' : 'NULL AS metadata'}
     FROM agentsam.${docsIdent}
     ${docsWhereSql}
     ORDER BY ${docsHasCreatedAt ? 'created_at DESC' : 'id DESC'}
     LIMIT 10`,
    docsParams,
  );

  const recentLogP = hyperdriveQuery(
    env,
    `SELECT created_at, search_type, query_text AS query_preview,
       duration_ms AS latency_ms, result_count AS match_count_returned
     FROM agentsam.${logIdent}
     ${logWhereSql}
     ORDER BY ${logHasCreatedAt ? 'created_at DESC' : 'id DESC'}
     LIMIT 10`,
    logParams,
  );

  const memoryCountP = hyperdriveQuery(
    env,
    `SELECT COUNT(*)::int AS c FROM agentsam.${memoryIdent} ${memoryWhereSql}`,
    memoryParams,
  );

  const [docsCount, embeddedCount, sources, logAgg, recentDocs, recentLog, memoryCount] =
    await Promise.all([
      docsCountP,
      embeddedCountP,
      sourcesP,
      logAggP,
      recentDocsP,
      recentLogP,
      memoryCountP,
    ]);

  if (!wid && !tid) {
    warnings.push({
      code: 'TENANT_ID_MISSING',
      message: 'No workspace_id/tenant_id resolved; RAG metrics may be unscoped.',
      backend: 'supabase',
      severity: 'warn',
    });
  }

  const documentCount = Number(docsCount?.rows?.[0]?.c ?? 0) || 0;
  const embeddedDocumentCountRaw = embeddedCount?.rows?.[0]?.c;
  const embeddedDocumentCount =
    embeddedDocumentCountRaw == null ? null : Number(embeddedDocumentCountRaw ?? 0) || 0;

  const embeddingCoveragePercent =
    embeddedDocumentCount == null ? null : safePct(embeddedDocumentCount, documentCount);

  const logRow = logAgg?.rows?.[0] || {};
  const searchLogCount = Number(logRow.c ?? 0) || 0;

  if (documentCount > 100 && searchLogCount < 10) {
    warnings.push({
      code: 'RAG_QUERY_LOG_LOW',
      message:
        'Documents exist, but semantic search logging volume is low. Confirm the RAG query path writes to agentsam_search_log.',
      backend: 'supabase',
      data_source_key: 'supabaseSemanticSearch',
      severity: 'warn',
    });
  }

  const sourceBreakdown = (sources?.rows || [])
    .map((r) => ({
      key: r.key != null ? String(r.key) : 'unknown',
      count: Number(r.count ?? 0) || 0,
      backend: 'supabase',
      table: docsTable,
    }))
    .filter((r) => r.key && r.key !== 'null');

  const sourceCount = sourceBreakdown.length;

  const avgSearchLatencyMs = Number(logRow.avg_latency_ms);
  const avgSearchLatencyMsOut = Number.isFinite(avgSearchLatencyMs) ? avgSearchLatencyMs : null;

  return analyticsResponse({
    ok: true,
    backend: 'supabase',
    range,
    summary: {
      document_count: documentCount,
      embedded_document_count: embeddedDocumentCount,
      embedding_coverage_percent: embeddingCoveragePercent,
      source_count: sourceCount,
      search_log_count: searchLogCount,
      avg_search_latency_ms: avgSearchLatencyMsOut,
      avg_result_count: Number.isFinite(Number(logRow.avg_result_count))
        ? Number(logRow.avg_result_count)
        : null,
      // Retired public tables — keep keys stable for UI, report zero.
      top_similarity: null,
      avg_similarity: null,
      knowledge_edge_count: 0,
      memory_count: Number(memoryCount?.rows?.[0]?.c ?? 0) || 0,
      context_row_count: 0,
      session_summary_count: 0,
    },
    breakdowns: [
      {
        key: 'sources',
        backend: 'supabase',
        rows: sourceBreakdown,
      },
    ],
    rows: [
      ...(recentLog?.rows || []).map((r) => ({ kind: 'search_log', backend: 'supabase', ...r })),
      ...(recentDocs?.rows || []).map((r) => ({ kind: 'document', backend: 'supabase', ...r })),
    ],
    warnings,
  });
}
