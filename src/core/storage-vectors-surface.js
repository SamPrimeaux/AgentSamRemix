/**
 * Storage → Vectors API surface: platform operator CF/pgvector registry vs tenant workspace lanes.
 */
import { resolveSupabaseWorkspaceId } from '../../backend/agentsam/rag/index.js';
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';
import { CODE_INDEX_LANE_FIXTURE_TABLES } from '../../backend/agentsam/codebase/code-index-lane-resolve.js';

const PGVECTOR_LANE_PURPOSES = [
  { purpose: 'memory', table: 'agentsam_memory_oai3large_1536', dimensions: 1536 },
  { purpose: 'codebase_chunks', table: CODE_INDEX_LANE_FIXTURE_TABLES.chunks, dimensions: 1536 },
  { purpose: 'documents', table: 'agentsam_documents_oai3large_1536', dimensions: 1536 },
  { purpose: 'database_schema', table: 'agentsam_database_schema_oai3large_1536', dimensions: 1536 },
  { purpose: 'deep_archive', table: 'agentsam_deep_archive_oai3large_3072', dimensions: 3072, is_archive: true },
  { purpose: 'media', table: 'agentsam_media_gemini2_1536', dimensions: 1536 },
];

/** CF binding → Supabase lane purpose for drift comparison. */
const BINDING_PG_PURPOSE = Object.freeze({
  AGENTSAM_VECTORIZE_CODE: 'codebase_chunks',
  AGENTSAM_VECTORIZE_DOCUMENTS: 'documents',
  AGENTSAM_VECTORIZE_MEMORY: 'memory',
  AGENTSAM_VECTORIZE_SCHEMA: 'database_schema',
  AGENTSAM_VECTORIZE_MEDIA: 'media',
  AGENTSAM_VECTORIZE_COURSES: 'documents',
});

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Platform Vectorize registry visible only to platform operators on the platform tenant.
 * @param {any} env
 * @param {any} authUser
 * @param {string} tenantId
 * @param {string|null} workspaceId
 */
export async function canViewPlatformVectorRegistry(env, authUser, tenantId, workspaceId = null) {
  const { userMayUseWorkspaceCredentials } = await import('../../backend/identity/workspace/grants.js');
  if (await userMayUseWorkspaceCredentials(env, authUser, workspaceId)) return true;
  const uid = String(authUser?.id || '').trim();
  if (!uid.startsWith('au_')) return false;
  try {
    const platformTenantId = await resolveCronTenantId(env);
    if (!platformTenantId) return false;
    return String(tenantId || '').trim() === platformTenantId;
  } catch {
    return false;
  }
}

async function liveVectorizeVectorCount(env, bindingName) {
  const key = String(bindingName || '').trim();
  if (!key || !env?.[key]?.describe) return null;
  try {
    const described = await env[key].describe();
    const raw =
      described?.vectorsCount ??
      described?.vectorCount ??
      described?.count ??
      described?.vectors ??
      null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function loadSyncReceiptForIndex(q, indexName) {
  const name = String(indexName || '').trim();
  if (!name) return { last_synced_at: null, receipt_status: null };
  const row = await q(
    `SELECT status, synced_at, chunk_id
       FROM vectorize_sync_log
      WHERE vectorize_index = ?
      ORDER BY synced_at DESC
      LIMIT 1`,
    [name],
    'first',
  );
  if (!row) return { last_synced_at: null, receipt_status: null };
  return {
    last_synced_at: row.synced_at ?? null,
    receipt_status: row.status ?? null,
    last_receipt_id: row.chunk_id ?? null,
  };
}

function computeDrift(cfCount, pgCount) {
  const cf = num(cfCount);
  const pg = num(pgCount);
  if (pg <= 0 && cf <= 0) return { drift_status: 'empty', drift_delta: 0, drift_pct: 0 };
  if (pg <= 0) return { drift_status: 'pg_empty', drift_delta: cf, drift_pct: 100 };
  if (cf <= 0) return { drift_status: 'cf_empty', drift_delta: -pg, drift_pct: 100 };
  const delta = cf - pg;
  const pct = Math.round((Math.abs(delta) / Math.max(pg, 1)) * 100);
  if (Math.abs(delta) <= Math.max(5, Math.floor(pg * 0.02))) {
    return { drift_status: 'aligned', drift_delta: delta, drift_pct: pct };
  }
  return {
    drift_status: delta > 0 ? 'cf_ahead' : 'cf_behind',
    drift_delta: delta,
    drift_pct: pct,
  };
}

async function enrichCfIndex(env, idx, q, pgStatsByPurpose) {
  const [docRow, staleRow, recentDocs, syncReceipt, liveCfCount] = await Promise.all([
    q(
      `SELECT COUNT(*) AS doc_count FROM vectorize_indexed_docs WHERE index_id = ? AND COALESCE(is_current,1) = 1`,
      [idx.id],
      'first',
    ),
    q(
      `SELECT COUNT(*) AS stale_count FROM vectorize_indexed_docs WHERE index_id = ? AND COALESCE(is_current,1) = 0`,
      [idx.id],
      'first',
    ),
    q(
      `SELECT source_r2_key, content_preview, chunk_index, token_count, indexed_at, is_current
       FROM vectorize_indexed_docs WHERE index_id = ? ORDER BY indexed_at DESC LIMIT 5`,
      [idx.id],
    ),
    loadSyncReceiptForIndex(q, idx.index_name),
    liveVectorizeVectorCount(env, idx.binding_name),
  ]);
  const binding = idx.binding_name && env[idx.binding_name] ? env[idx.binding_name] : null;
  const registryStored = num(idx.stored_vectors);
  const cf_live_vectors = liveCfCount != null ? liveCfCount : registryStored;
  const pgPurpose = BINDING_PG_PURPOSE[String(idx.binding_name || '')] || null;
  const pgLane = pgPurpose ? pgStatsByPurpose.get(pgPurpose) : null;
  const supabase_embedded_rows = pgLane?.workspace_embedded_count ?? pgLane?.workspace_row_count ?? null;
  const drift = computeDrift(cf_live_vectors, supabase_embedded_rows);

  return {
    ...idx,
    provider: 'cloudflare_vectorize',
    doc_count: num(docRow?.doc_count),
    stale_doc_count: num(staleRow?.stale_count),
    recent_docs: recentDocs,
    is_live_connected: !!binding,
    registry_status: 'registered',
    registry_stored_vectors: registryStored,
    cf_live_vectors,
    cf_count_source: liveCfCount != null ? 'binding.describe' : 'd1_registry',
    supabase_purpose: pgPurpose,
    supabase_table: pgLane?.table_name ?? null,
    supabase_embedded_rows,
    ...drift,
    last_sync_receipt_at: syncReceipt.last_synced_at,
    last_sync_receipt_status: syncReceipt.receipt_status,
    last_sync_receipt_id: syncReceipt.last_receipt_id,
  };
}

async function loadCfIndexCatalog(env, q, tenantId, isPlatformOperator, pgStatsByPurpose) {
  let platformTenantId = null;
  if (!isPlatformOperator) {
    platformTenantId = await resolveCronTenantId(env);
  }
  const registrySql = isPlatformOperator
    ? `SELECT * FROM vectorize_index_registry
       WHERE COALESCE(is_active, 1) = 1
       ORDER BY COALESCE(is_preferred, 0) DESC, display_name`
    : platformTenantId
      ? `SELECT * FROM vectorize_index_registry
         WHERE (tenant_id = ? OR tenant_id IS NULL OR tenant_id = ?)
           AND COALESCE(is_active, 1) = 1
         ORDER BY COALESCE(is_preferred, 0) DESC, display_name`
      : `SELECT * FROM vectorize_index_registry
         WHERE (tenant_id = ? OR tenant_id IS NULL)
           AND COALESCE(is_active, 1) = 1
         ORDER BY COALESCE(is_preferred, 0) DESC, display_name`;
  const binds = isPlatformOperator ? [] : platformTenantId ? [tenantId, platformTenantId] : [tenantId];
  const registry = await q(registrySql, binds);
  return Promise.all(registry.map((idx) => enrichCfIndex(env, idx, q, pgStatsByPurpose)));
}

async function loadPlatformPgvectorLanes(env, q) {
  // Global lane catalog — no tenant_id on agentsam_pgvector_lane_registry.
  // Workspace isolation lives on workspace_id in the Supabase pgvector tables.
  const lanes = await q(
    `SELECT id, schema_name, table_name, purpose, dimensions, metric, embedding_model,
            size_label, is_active, is_archive, description, updated_at
     FROM agentsam_pgvector_lane_registry
     WHERE COALESCE(is_active, 1) = 1
     ORDER BY purpose`,
  );
  return lanes.map((lane) => ({
    ...lane,
    provider: 'supabase_pgvector',
    is_live_connected: isHyperdriveUsable(env),
  }));
}

async function workspacePgvectorStats(env, d1WorkspaceId) {
  if (!isHyperdriveUsable(env) || !d1WorkspaceId) return [];
  const pgWorkspaceId = await resolveSupabaseWorkspaceId(env, d1WorkspaceId);
  if (!pgWorkspaceId) return [];

  const out = [];
  for (const lane of PGVECTOR_LANE_PURPOSES) {
    const sql = `SELECT
        COUNT(*)::bigint AS row_count,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded_count
      FROM agentsam.${lane.table}
      WHERE workspace_id = $1::uuid`;
    const result = await runHyperdriveQuery(env, sql, [pgWorkspaceId]);
    const rowCount = result.ok ? num(result.rows?.[0]?.row_count) : null;
    const embeddedCount = result.ok ? num(result.rows?.[0]?.embedded_count) : null;
    out.push({
      provider: 'supabase_pgvector',
      purpose: lane.purpose,
      table_name: lane.table,
      schema_name: 'agentsam',
      dimensions: lane.dimensions,
      is_archive: !!lane.is_archive,
      workspace_id: d1WorkspaceId,
      workspace_row_count: rowCount,
      workspace_embedded_count: embeddedCount,
      query_ok: result.ok,
      query_error: result.ok ? null : result.error || 'query_failed',
    });
  }
  return out;
}

function pgStatsMap(lanes) {
  const map = new Map();
  for (const lane of lanes || []) {
    if (lane?.purpose) map.set(String(lane.purpose), lane);
  }
  return map;
}

async function loadTenantConnections(env, tenantId, userId, q) {
  return q(
    `SELECT id, tenant_id, user_id, workspace_id, provider, display_name, index_name, table_name,
            schema_name, binding_label, account_id, dimensions, metric, connection_status,
            config_json, is_active, created_at, updated_at
     FROM tenant_vector_connections
     WHERE tenant_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1
     ORDER BY updated_at DESC`,
    [tenantId, userId],
  );
}

/**
 * @param {any} env
 * @param {any} authUser
 * @param {URL} url
 * @param {string} tenantId
 * @param {string} userId
 * @param {(sql: string, binds?: unknown[], mode?: string) => Promise<any>} q
 * @param {string|null} workspaceId
 */
export async function buildStorageVectorsPayload(env, authUser, url, tenantId, userId, q, workspaceId = null) {
  const isPlatformOperator = await canViewPlatformVectorRegistry(env, authUser, tenantId, workspaceId);
  const canViewPlatform = isPlatformOperator;

  const workspacePgvector = await workspacePgvectorStats(env, workspaceId);
  const pgStatsByPurpose = pgStatsMap(workspacePgvector);
  const platformCfIndexes = await loadCfIndexCatalog(env, q, tenantId, isPlatformOperator, pgStatsByPurpose);
  const platformPgvectorLanes = await loadPlatformPgvectorLanes(env, q);
  const tenantConnections = await loadTenantConnections(env, tenantId, userId, q);

  const indexes = platformCfIndexes;
  const totalsFromCfLive = platformCfIndexes.reduce(
    (acc, x) => ({
      stored: acc.stored + num(x.cf_live_vectors),
      docs: acc.docs + num(x.doc_count),
      queries: acc.queries + num(x.queries_30d),
    }),
    { stored: 0, docs: 0, queries: 0 },
  );
  const totalsFromPg = workspacePgvector.reduce(
    (acc, x) => ({
      rows: acc.rows + num(x.workspace_row_count),
      embedded: acc.embedded + num(x.workspace_embedded_count),
    }),
    { rows: 0, embedded: 0 },
  );
  const driftLanes = platformCfIndexes.filter(
    (x) => x.drift_status && x.drift_status !== 'aligned' && x.drift_status !== 'empty',
  );
  const lastSyncFromReceipts = platformCfIndexes.reduce((m, x) => {
    const ts = x.last_sync_receipt_at;
    if (ts == null) return m;
    return !m || Number(ts) > Number(m) ? ts : m;
  }, null);
  const lastSyncFromRegistry = platformCfIndexes.reduce((m, x) => {
    const ts = x.last_indexed_at;
    if (!ts) return m;
    return !m || String(ts) > String(m) ? ts : m;
  }, null);

  return {
    can_view_platform: canViewPlatform,
    workspace_id: workspaceId,
    platform_cf_indexes: platformCfIndexes,
    platform_pgvector_lanes: platformPgvectorLanes,
    workspace_pgvector_lanes: workspacePgvector,
    lane_drift_summary: {
      aligned: platformCfIndexes.filter((x) => x.drift_status === 'aligned').length,
      drifted: driftLanes.length,
      lanes: driftLanes.map((x) => ({
        binding: x.binding_name,
        index: x.index_name,
        drift_status: x.drift_status,
        cf_live_vectors: x.cf_live_vectors,
        supabase_embedded_rows: x.supabase_embedded_rows,
      })),
    },
    tenant_connections: tenantConnections.map((row) => ({
      ...row,
      config: parseJsonObject(row.config_json),
    })),
    indexes,
    total_stored_vectors: totalsFromCfLive.stored,
    total_supabase_embedded: totalsFromPg.embedded,
    total_supabase_rows: totalsFromPg.rows,
    total_indexed_docs: totalsFromCfLive.docs,
    total_queries_30d: totalsFromCfLive.queries,
    last_synced_at: lastSyncFromReceipts ?? lastSyncFromRegistry,
    data_quality:
      driftLanes.length === 0 && totalsFromPg.embedded > 0 ? 'healthy' : driftLanes.length ? 'drift' : 'partial',
  };
}

function newConnectionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tvc_${hex}`;
}

const ALLOWED_PROVIDERS = new Set(['cloudflare_vectorize', 'supabase_pgvector', 'external']);

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} userId
 * @param {Record<string, unknown>} body
 * @param {string|null} workspaceId
 */
export async function upsertTenantVectorConnection(env, tenantId, userId, body, workspaceId) {
  if (!env?.DB) throw new Error('database_not_configured');
  const provider = String(body.provider || '').trim().toLowerCase();
  if (!ALLOWED_PROVIDERS.has(provider)) throw new Error('invalid_provider');
  const displayName = String(body.display_name || '').trim();
  if (!displayName) throw new Error('display_name_required');

  const id = String(body.id || '').trim() || newConnectionId();
  const existing = await env.DB.prepare(
    `SELECT id FROM tenant_vector_connections WHERE id = ? AND tenant_id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(id, tenantId, userId)
    .first();
  if (body.id && !existing) throw new Error('connection_not_found');

  const fields = {
    workspace_id: workspaceId || (body.workspace_id != null ? String(body.workspace_id).trim() : null),
    provider,
    display_name: displayName.slice(0, 200),
    index_name: body.index_name != null ? String(body.index_name).trim().slice(0, 200) : null,
    table_name: body.table_name != null ? String(body.table_name).trim().slice(0, 200) : null,
    schema_name:
      body.schema_name != null ? String(body.schema_name).trim().slice(0, 64) : 'agentsam',
    binding_label: body.binding_label != null ? String(body.binding_label).trim().slice(0, 120) : null,
    account_id: body.account_id != null ? String(body.account_id).trim().slice(0, 64) : null,
    dimensions: body.dimensions != null ? num(body.dimensions, null) : null,
    metric: body.metric != null ? String(body.metric).trim().slice(0, 32) : 'cosine',
    connection_status: String(body.connection_status || 'pending').trim().slice(0, 32),
    config_json: JSON.stringify(
      body.config && typeof body.config === 'object' ? body.config : parseJsonObject(body.config_json),
    ).slice(0, 4000),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
  };

  if (existing) {
    await env.DB.prepare(
      `UPDATE tenant_vector_connections SET
         workspace_id = ?, provider = ?, display_name = ?, index_name = ?, table_name = ?,
         schema_name = ?, binding_label = ?, account_id = ?, dimensions = ?, metric = ?,
         connection_status = ?, config_json = ?, is_active = ?, updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    )
      .bind(
        fields.workspace_id,
        fields.provider,
        fields.display_name,
        fields.index_name,
        fields.table_name,
        fields.schema_name,
        fields.binding_label,
        fields.account_id,
        fields.dimensions,
        fields.metric,
        fields.connection_status,
        fields.config_json,
        fields.is_active,
        id,
        tenantId,
        userId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tenant_vector_connections (
         id, tenant_id, user_id, workspace_id, provider, display_name, index_name, table_name,
         schema_name, binding_label, account_id, dimensions, metric, connection_status,
         config_json, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        tenantId,
        userId,
        fields.workspace_id,
        fields.provider,
        fields.display_name,
        fields.index_name,
        fields.table_name,
        fields.schema_name,
        fields.binding_label,
        fields.account_id,
        fields.dimensions,
        fields.metric,
        fields.connection_status,
        fields.config_json,
        fields.is_active,
      )
      .run();
  }
  return id;
}

export async function deactivateTenantVectorConnection(env, tenantId, userId, connectionId) {
  if (!env?.DB) throw new Error('database_not_configured');
  const id = String(connectionId || '').trim();
  if (!id) throw new Error('id_required');
  const result = await env.DB.prepare(
    `UPDATE tenant_vector_connections
     SET is_active = 0, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ? AND user_id = ?`,
  )
    .bind(id, tenantId, userId)
    .run();
  if (!(result.meta?.changes ?? 0)) throw new Error('connection_not_found');
}
