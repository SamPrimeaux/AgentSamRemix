/**
 * Canonical semantic RAG lane resolution.
 *
 * Lane names are stable API aliases. Physical tables, dimensions, models, and
 * bindings come from D1 registries at runtime.
 */
import { resolveCodeIndexLaneConfig } from '../../agentsam/codebase/code-index-lane-resolve.js';

const PURPOSE_BY_LANE = Object.freeze({
  memory: 'memory',
  docs: 'documents',
  schema: 'database_schema',
  archive: 'deep_archive',
  media: 'media',
});

const VECTORIZE_BINDING_BY_LANE = Object.freeze({
  memory: 'AGENTSAM_VECTORIZE_MEMORY',
  docs: 'AGENTSAM_VECTORIZE_DOCUMENTS',
  schema: 'AGENTSAM_VECTORIZE_SCHEMA',
  media: 'AGENTSAM_VECTORIZE_MEDIA',
});

const LANE_NAMES = Object.freeze(['memory', 'code', 'docs', 'schema', 'archive', 'media']);

export const LANES = Object.freeze(
  Object.fromEntries(LANE_NAMES.map((name) => [name, Object.freeze({ name })])),
);

const ROUTE_LANE_MAP = Object.freeze({
  db_write: Object.freeze(['schema', 'code', 'memory']),
  db_read: Object.freeze(['schema', 'code', 'memory']),
  debug: Object.freeze(['schema', 'code', 'memory']),
  cf_ops: Object.freeze(['schema', 'docs', 'memory']),
  ask: Object.freeze(['docs', 'code', 'memory']),
  agent_spawn: Object.freeze(['docs', 'code', 'memory']),
  research: Object.freeze(['docs', 'code', 'memory']),
});

export function normalizeLaneName(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return key === 'documents' ? 'docs' : key === 'database_schema' ? 'schema' : key;
}

export function laneNamesForRoute(routeKey) {
  const key = String(routeKey ?? '').trim().toLowerCase();
  return [...(ROUTE_LANE_MAP[key] || ['memory'])];
}

export function isKnownLane(value) {
  return LANE_NAMES.includes(normalizeLaneName(value));
}

async function resolvePgLane(env, laneName) {
  const purpose = PURPOSE_BY_LANE[laneName];
  const result = await env.DB.prepare(
    `SELECT id, schema_name, table_name, purpose, dimensions, embedding_model, metric
       FROM agentsam_pgvector_lane_registry
      WHERE purpose = ?
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_archive, 0) = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(purpose, laneName === 'archive' ? 1 : 0)
    .all();
  const row = result?.results?.[0];
  if (!row?.table_name) {
    throw new Error(`rag_lane_registry_missing:${laneName}`);
  }
  const dimensions = Number(row.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`rag_lane_registry_invalid_dimensions:${laneName}`);
  }
  return {
    id: String(row.id || ''),
    name: laneName,
    purpose,
    ssot: 'pgvector',
    schemaName: String(row.schema_name || 'agentsam').trim(),
    tableName: String(row.table_name).trim(),
    dimensions,
    embeddingModel: String(row.embedding_model || '').trim(),
    metric: String(row.metric || 'cosine').trim(),
    vectorizeBinding: null,
  };
}

async function resolveVectorizeBinding(env, laneName) {
  const bindingName = VECTORIZE_BINDING_BY_LANE[laneName];
  if (!bindingName) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT binding_name, index_name, dimensions, metric
         FROM vectorize_index_registry
        WHERE binding_name = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(bindingName)
      .first();
    if (!row?.binding_name) return null;
    return {
      bindingName,
      indexName: String(row.index_name || '').trim(),
      dimensions: Number(row.dimensions) || null,
      metric: String(row.metric || 'cosine').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve one lane. The code lane delegates to its stricter code-index D1
 * resolver; all other lanes use the shared pgvector registry.
 */
export async function resolveRagLane(env, laneName) {
  const name = normalizeLaneName(laneName);
  if (!isKnownLane(name)) throw new Error(`unknown_rag_lane:${name || '(empty)'}`);
  if (!env?.DB) throw new Error('rag_lane_registry_db_required');

  if (name === 'code') {
    const code = await resolveCodeIndexLaneConfig(env);
    return {
      name,
      purpose: 'codebase',
      ssot: 'pgvector',
      schemaName: 'agentsam',
      tableName: code.tables.chunks,
      dimensions: code.dimensions,
      embeddingModel: code.embed.model,
      metric: 'cosine',
      vectorizeBinding: null,
      codeIndex: code,
    };
  }

  const lane = await resolvePgLane(env, name);
  lane.vectorizeBinding = await resolveVectorizeBinding(env, name);
  return lane;
}

export async function resolveVectorizeBindingForTable(env, tableName) {
  const statement = env?.DB?.prepare?.(
    `SELECT purpose FROM agentsam_pgvector_lane_registry
      WHERE table_name = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1`,
  );
  const row = statement
    ? await statement.bind(String(tableName || '')).first().catch(() => null)
    : null;
  const laneByPurpose = {
    memory: 'memory',
    documents: 'docs',
    database_schema: 'schema',
    media: 'media',
  };
  const laneName = laneByPurpose[String(row?.purpose || '').trim()];
  if (!laneName) return null;
  const lane = await resolveRagLane(env, laneName).catch(() => null);
  return lane?.vectorizeBinding?.bindingName || null;
}
