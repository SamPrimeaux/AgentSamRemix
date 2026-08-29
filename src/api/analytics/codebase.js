import { parseRange, analyticsResponse } from './sources/normalize.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../../backend/services/database/hyperdrive.js';
import { resolveCodeIndexLaneConfig } from '../../../backend/agentsam/codebase/code-index-lane-resolve.js';

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

function coerceIsoOrNull(v) {
  if (v == null) return null;
  const s = String(v);
  if (!s.trim()) return null;
  return s;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || '').trim(),
  );
}

export async function handleAnalyticsCodebase(_request, url, env, { tenantId, workspaceId }) {
  const range = parseRange(url);
  const warnings = [];
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && isUuid(workspaceId) ? String(workspaceId).trim() : null;

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
            'Hyperdrive is not usable (binding missing or no .query / connectionString); Supabase-backed codebase analytics are unavailable.',
          backend: 'supabase',
          severity: 'critical',
        },
      ],
    });
  }

  // Live AST-RAG tables from D1 agentsam_pgvector_lane_registry (Gemini twins).
  let filesTable;
  let chunksTable;
  let symbolsTable;
  try {
    const lane = await resolveCodeIndexLaneConfig(env);
    filesTable = lane.tables.files;
    chunksTable = lane.tables.chunks;
    symbolsTable = lane.tables.symbols;
  } catch (e) {
    return analyticsResponse({
      ok: false,
      backend: 'supabase',
      range,
      summary: {},
      rows: [],
      breakdowns: [],
      series: [],
      warnings: [
        {
          code: 'CODE_INDEX_LANE_RESOLVE_FAILED',
          message: String(e?.message || e),
          backend: 'd1',
          severity: 'critical',
        },
      ],
    });
  }
  const snapshotsTable = null; // no snapshot table in agentsam cutover schema

  const rangeInterval = intervalForRange(range);

  const [fileHasTenant, chunkHasTenant, symHasTenant, fileHasWorkspace, chunkHasWorkspace, symHasWorkspace] =
    await Promise.all([
      hasColumn(env, filesTable, 'tenant_id'),
      hasColumn(env, chunksTable, 'tenant_id'),
      hasColumn(env, symbolsTable, 'tenant_id'),
      hasColumn(env, filesTable, 'workspace_id'),
      hasColumn(env, chunksTable, 'workspace_id'),
      hasColumn(env, symbolsTable, 'workspace_id'),
    ]);

  const [fileHasCreatedAt, chunkHasCreatedAt, symHasCreatedAt] = await Promise.all([
    hasColumn(env, filesTable, 'created_at'),
    hasColumn(env, chunksTable, 'created_at'),
    hasColumn(env, symbolsTable, 'created_at'),
  ]);

  const [fileHasContent, fileHasBytes, fileHasLineCount, fileHasMetadata, fileHasLanguage] = await Promise.all([
    hasColumn(env, filesTable, 'content'),
    hasColumn(env, filesTable, 'size_bytes'),
    hasColumn(env, filesTable, 'line_count'),
    hasColumn(env, filesTable, 'metadata'),
    hasColumn(env, filesTable, 'language'),
  ]);
  const chunkHasLanguage = fileHasLanguage; // language lives on files in agentsam schema

  const symCols = await (async () => {
    const out = await hyperdriveQuery(
      env,
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='agentsam' AND table_name=$1`,
      [symbolsTable],
    );
    return new Set((out.rows || []).map((r) => String(r.column_name || '').trim()).filter(Boolean));
  })();

  const fileWhere = [];
  const fileParams = [];
  if (fileHasWorkspace && wid) {
    fileParams.push(wid);
    fileWhere.push(`workspace_id = $${fileParams.length}::uuid`);
  } else if (fileHasTenant && tid) {
    fileParams.push(tid);
    fileWhere.push(`tenant_id = $${fileParams.length}`);
  }
  if (rangeInterval && fileHasCreatedAt) fileWhere.push(`created_at >= now() - ${rangeInterval}`);
  const fileWhereSql = fileWhere.length ? `WHERE ${fileWhere.join(' AND ')}` : '';

  const chunkWhere = [];
  const chunkParams = [];
  if (chunkHasWorkspace && wid) {
    chunkParams.push(wid);
    chunkWhere.push(`workspace_id = $${chunkParams.length}::uuid`);
  } else if (chunkHasTenant && tid) {
    chunkParams.push(tid);
    chunkWhere.push(`tenant_id = $${chunkParams.length}`);
  }
  if (rangeInterval && chunkHasCreatedAt) chunkWhere.push(`created_at >= now() - ${rangeInterval}`);
  const chunkWhereSql = chunkWhere.length ? `WHERE ${chunkWhere.join(' AND ')}` : '';

  const symWhere = [];
  const symParams = [];
  if (symHasWorkspace && wid) {
    symParams.push(wid);
    symWhere.push(`workspace_id = $${symParams.length}::uuid`);
  } else if (symHasTenant && tid) {
    symParams.push(tid);
    symWhere.push(`tenant_id = $${symParams.length}`);
  }
  if (rangeInterval && symHasCreatedAt) symWhere.push(`created_at >= now() - ${rangeInterval}`);
  const symWhereSql = symWhere.length ? `WHERE ${symWhere.join(' AND ')}` : '';

  void snapshotsTable;

  const filesIdent = safeTableIdent(filesTable);
  const chunksIdent = safeTableIdent(chunksTable);
  const symIdent = safeTableIdent(symbolsTable);

  const snapshotAggP = Promise.resolve({
    ok: true,
    rows: [{ snapshot_count: 0, latest_snapshot_at: null }],
  });
  const snapshotsP = Promise.resolve({ ok: true, rows: [] });

  const fileCountP = hyperdriveQuery(env, `SELECT COUNT(*)::int AS c FROM agentsam.${filesIdent} ${fileWhereSql}`, fileParams);
  const chunkCountP = hyperdriveQuery(env, `SELECT COUNT(*)::int AS c FROM agentsam.${chunksIdent} ${chunkWhereSql}`, chunkParams);
  const symbolCountP = hyperdriveQuery(env, `SELECT COUNT(*)::int AS c FROM agentsam.${symIdent} ${symWhereSql}`, symParams);

  const totalBytesP = fileHasBytes
    ? hyperdriveQuery(
        env,
        `SELECT COALESCE(SUM(size_bytes),0)::bigint AS total_bytes FROM agentsam.${filesIdent} ${fileWhereSql}`,
        fileParams,
      )
    : fileHasContent
      ? hyperdriveQuery(
          env,
          `SELECT COALESCE(SUM(OCTET_LENGTH(content)),0)::bigint AS total_bytes FROM agentsam.${filesIdent} ${fileWhereSql}`,
          fileParams,
        )
      : Promise.resolve({ ok: true, rows: [{ total_bytes: null }] });

  const totalLinesP = fileHasLineCount
    ? hyperdriveQuery(env, `SELECT COALESCE(SUM(line_count),0)::bigint AS total_lines FROM agentsam.${filesIdent} ${fileWhereSql}`, fileParams)
    : fileHasContent
      ? hyperdriveQuery(
          env,
          `SELECT COALESCE(SUM(1 + LENGTH(content) - LENGTH(REPLACE(content, E'\\n', ''))),0)::bigint AS total_lines
           FROM agentsam.${filesIdent} ${fileWhereSql}`,
          fileParams,
        )
      : Promise.resolve({ ok: true, rows: [{ total_lines: null }] });

  const languageDistP = chunkHasLanguage
    ? hyperdriveQuery(
        env,
        `SELECT COALESCE(NULLIF(language,''),'unknown') AS language, COUNT(*)::int AS count
         FROM agentsam.${filesIdent}
         ${fileWhereSql}
         GROUP BY COALESCE(NULLIF(language,''),'unknown')
         ORDER BY COUNT(*) DESC
         LIMIT 12`,
        fileParams,
      )
    : Promise.resolve({ ok: true, rows: [] });

  const largestFilesP = hyperdriveQuery(
    env,
    `SELECT file_path,
            ${fileHasLineCount ? 'line_count' : 'NULL AS line_count'},
            ${fileHasBytes ? 'size_bytes AS bytes' : 'NULL AS bytes'}
     FROM agentsam.${filesIdent}
     ${fileWhereSql}
     ORDER BY COALESCE(${fileHasBytes ? 'size_bytes' : '0'},0) DESC
     LIMIT 10`,
    fileParams,
  );

  const priorityFilesP = fileHasMetadata
    ? hyperdriveQuery(
        env,
        `SELECT file_path,
                ${fileHasLineCount ? 'line_count' : 'NULL AS line_count'},
                ${fileHasBytes ? 'size_bytes AS bytes' : 'NULL AS bytes'},
                metadata AS metadata_jsonb
         FROM agentsam.${filesIdent}
         ${fileWhereSql}${fileWhereSql ? ' AND' : 'WHERE'} (metadata->>'kind') IN ('priority_file','route_map')
         ORDER BY file_path ASC
         LIMIT 25`,
        fileParams,
      )
    : Promise.resolve({ ok: true, rows: [] });

  const symNameCol = symCols.has('node_name')
    ? 'node_name'
    : symCols.has('name')
      ? 'name'
      : symCols.has('symbol_name')
        ? 'symbol_name'
        : null;
  const symTypeCol = symCols.has('node_type')
    ? 'node_type'
    : symCols.has('symbol_type')
      ? 'symbol_type'
      : symCols.has('type')
        ? 'type'
        : symCols.has('kind')
          ? 'kind'
          : null;
  const symFileCol = symCols.has('file_path') ? 'file_path' : symCols.has('path') ? 'path' : null;
  const symLineCol = symCols.has('line_start') ? 'line_start' : symCols.has('line') ? 'line' : null;
  const symOrderCol = symNameCol || (symCols.has('node_id') ? 'node_id' : 'file_path');

  const selectCols = [
    symNameCol ? `${symNameCol} AS name` : `NULL AS name`,
    symTypeCol ? `${symTypeCol} AS symbol_type` : `NULL AS symbol_type`,
    symFileCol ? `${symFileCol} AS file_path` : `NULL AS file_path`,
    symLineCol ? `${symLineCol} AS line` : `NULL AS line`,
  ].join(', ');

  const functionSymbolsP = hyperdriveQuery(
    env,
    `SELECT ${selectCols}
     FROM agentsam.${symIdent}
     ${symWhereSql}
     ${
       symTypeCol
         ? `${symWhereSql ? 'AND' : 'WHERE'} LOWER(COALESCE(${symTypeCol}::text,'')) IN ('function','fn','method','function_declaration','method_definition')`
         : ''
     }
     ORDER BY ${symOrderCol} ASC
     LIMIT 25`,
    symParams,
  );

  const routeSymbolsP = hyperdriveQuery(
    env,
    `SELECT ${selectCols}
     FROM agentsam.${symIdent}
     ${symWhereSql}
     ${
       symTypeCol
         ? `${symWhereSql ? 'AND' : 'WHERE'} (LOWER(COALESCE(${symTypeCol}::text,'')) IN ('route','router','endpoint') OR LOWER(COALESCE(${symTypeCol}::text,'')) LIKE '%route%')`
         : ''
     }
     ORDER BY ${symOrderCol} ASC
     LIMIT 25`,
    symParams,
  );

  const [
    snapAgg,
    snaps,
    fileCount,
    totalBytes,
    totalLines,
    chunkCount,
    symbolCount,
    langDist,
    largestFiles,
    priorityFiles,
    fnSymbols,
    rtSymbols,
  ] = await Promise.all([
    snapshotAggP,
    snapshotsP,
    fileCountP,
    totalBytesP,
    totalLinesP,
    chunkCountP,
    symbolCountP,
    languageDistP,
    largestFilesP,
    priorityFilesP,
    functionSymbolsP,
    routeSymbolsP,
  ]);

  if (!tid) {
    warnings.push({
      code: 'TENANT_ID_MISSING',
      message: 'No tenant_id resolved; codebase metrics may be unscoped.',
      backend: 'supabase',
      severity: 'warn',
    });
  }

  const snapRow = snapAgg?.rows?.[0] || {};
  const snapshotCount = Number(snapRow.snapshot_count ?? 0) || 0;
  const latestSnapshotAt = coerceIsoOrNull(snapRow.latest_snapshot_at);

  const fileCountN = Number(fileCount?.rows?.[0]?.c ?? 0) || 0;
  const chunkCountN = Number(chunkCount?.rows?.[0]?.c ?? 0) || 0;
  const symbolCountN = Number(symbolCount?.rows?.[0]?.c ?? 0) || 0;

  const totalBytesN = totalBytes?.rows?.[0]?.total_bytes;
  const totalLinesN = totalLines?.rows?.[0]?.total_lines;

  const langRows = (langDist?.rows || []).map((r) => ({
    language: String(r.language || 'unknown'),
    count: Number(r.count ?? 0) || 0,
  }));

  return analyticsResponse({
    ok: true,
    backend: 'supabase',
    range,
    summary: {
      snapshot_count: snapshotCount,
      latest_snapshot_at: latestSnapshotAt,
      file_count: fileCountN,
      total_lines: totalLinesN != null ? Number(totalLinesN) : null,
      total_bytes: totalBytesN != null ? Number(totalBytesN) : null,
      chunk_count: chunkCountN,
      symbol_count: symbolCountN,
      language_distribution: langRows,
      largest_files: (largestFiles?.rows || []).map((r) => ({
        file_path: r.file_path != null ? String(r.file_path) : null,
        line_count: r.line_count != null ? Number(r.line_count) : null,
        bytes: r.bytes != null ? Number(r.bytes) : null,
      })),
      priority_files: (priorityFiles?.rows || []).map((r) => ({
        file_path: r.file_path != null ? String(r.file_path) : null,
        line_count: r.line_count != null ? Number(r.line_count) : null,
        bytes: r.bytes != null ? Number(r.bytes) : null,
        kind:
          r.metadata_jsonb && typeof r.metadata_jsonb === 'object'
            ? r.metadata_jsonb.kind ?? null
            : null,
      })),
      route_symbols: (rtSymbols?.rows || []).map((r) => ({
        name: r.name != null ? String(r.name) : null,
        symbol_type: r.symbol_type != null ? String(r.symbol_type) : null,
        file_path: r.file_path != null ? String(r.file_path) : null,
        line: r.line != null ? Number(r.line) : null,
      })),
      function_symbols: (fnSymbols?.rows || []).map((r) => ({
        name: r.name != null ? String(r.name) : null,
        symbol_type: r.symbol_type != null ? String(r.symbol_type) : null,
        file_path: r.file_path != null ? String(r.file_path) : null,
        line: r.line != null ? Number(r.line) : null,
      })),
    },
    breakdowns: [
      {
        key: 'languages',
        backend: 'supabase',
        rows: langRows,
      },
    ],
    rows: [
      ...(snaps?.rows || []).map((r) => ({ kind: 'snapshot', backend: 'supabase', ...r })),
      ...(largestFiles?.rows || []).map((r) => ({ kind: 'largest_file', backend: 'supabase', ...r })),
      ...(priorityFiles?.rows || []).map((r) => ({ kind: 'priority_file', backend: 'supabase', ...r })),
      ...(rtSymbols?.rows || []).map((r) => ({ kind: 'route_symbol', backend: 'supabase', ...r })),
      ...(fnSymbols?.rows || []).map((r) => ({ kind: 'function_symbol', backend: 'supabase', ...r })),
    ],
    warnings,
  });
}

