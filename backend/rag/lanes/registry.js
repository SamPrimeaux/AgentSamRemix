/**
 * Canonical semantic RAG lane resolution.
 *
 * Logical embedding operations resolve through agentsam_routing_arms first.
 * agentsam_pgvector_lane_registry only maps that resolved embedding space to
 * physical storage; it never chooses a model by row recency.
 */
import { resolveCodeIndexLaneConfig } from '../../agentsam/codebase/code-index-lane-resolve.js';

const PURPOSE_BY_LANE = Object.freeze({
  memory: 'memory',
  docs: 'documents',
  schema: 'database_schema',
  archive: 'deep_archive',
  media: 'media',
});

const TASK_TYPE_BY_LANE = Object.freeze({
  memory: 'memory_embed',
  docs: 'document_index_embed',
  schema: 'embeddings',
  archive: 'embeddings',
  media: 'embeddings_multimodal',
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

export function normalizeEmbeddingModelKey(value) {
  return String(value ?? '').trim().replace(/^models\//i, '').toLowerCase();
}

export function laneNamesForRoute(routeKey) {
  const key = String(routeKey ?? '').trim().toLowerCase();
  return [...(ROUTE_LANE_MAP[key] || ['memory'])];
}

export function isKnownLane(value) {
  return LANE_NAMES.includes(normalizeLaneName(value));
}

export async function resolveGlobalEmbeddingArm(env, taskType) {
  if (!env?.DB) throw new Error('rag_lane_registry_db_required');
  const task = String(taskType || '').trim();
  if (!task) throw new Error('routing_task_type_required');

  const arm = await env.DB.prepare(
    `SELECT id, task_type, provider, model_key, model_catalog_id, priority
       FROM agentsam_routing_arms
      WHERE task_type = ?
        AND COALESCE(TRIM(workspace_id), '') = ''
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_eligible, 1) = 1
        AND COALESCE(is_paused, 0) = 0
        AND COALESCE(budget_exhausted, 0) = 0
      ORDER BY COALESCE(priority, 0) DESC, updated_at DESC
      LIMIT 1`,
  ).bind(task).first();

  if (!arm?.model_key) throw new Error(`routing_arm_missing:${task}`);

  let modelKey = String(arm.model_key).trim();
  let provider = String(arm.provider || '').trim().toLowerCase();
  const catalogId = String(arm.model_catalog_id || '').trim() || null;

  if (catalogId) {
    const catalog = await env.DB.prepare(
      `SELECT id, model_key, provider
         FROM agentsam_model_catalog
        WHERE id = ? AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    ).bind(catalogId).first();
    if (!catalog?.model_key) throw new Error(`model_catalog_missing:${catalogId}`);
    const catalogProvider = String(catalog.provider || '').trim().toLowerCase();
    if (provider && catalogProvider && provider !== catalogProvider) {
      throw new Error(`routing_arm_catalog_provider_mismatch:${task}`);
    }
    if (
      normalizeEmbeddingModelKey(modelKey) !== normalizeEmbeddingModelKey(catalog.model_key)
    ) {
      throw new Error(`routing_arm_catalog_model_mismatch:${task}`);
    }
    modelKey = String(catalog.model_key).trim();
    provider = catalogProvider || provider;
  }

  if (!provider) throw new Error(`routing_arm_provider_missing:${task}`);

  return Object.freeze({
    id: String(arm.id || ''),
    taskType: task,
    provider,
    modelKey,
    modelCatalogId: catalogId,
    priority: Number(arm.priority) || 0,
  });
}

async function resolvePgLane(env, laneName, arm) {
  const purpose = PURPOSE_BY_LANE[laneName];
  const result = await env.DB.prepare(
    `SELECT id, schema_name, table_name, purpose, dimensions, embedding_model, metric
       FROM agentsam_pgvector_lane_registry
      WHERE purpose = ?
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_archive, 0) = ?`,
  )
    .bind(purpose, laneName === 'archive' ? 1 : 0)
    .all();

  const rows = (result?.results || []).filter((row) => row?.table_name);
  if (!rows.length) throw new Error(`rag_lane_registry_missing:${laneName}`);

  const wantedModel = normalizeEmbeddingModelKey(arm.modelKey);
  const matches = rows.filter(
    (row) => normalizeEmbeddingModelKey(row.embedding_model) === wantedModel,
  );
  if (!matches.length) {
    throw new Error(`rag_lane_registry_model_missing:${laneName}:${wantedModel}`);
  }
  if (matches.length > 1) {
    throw new Error(`rag_lane_registry_model_ambiguous:${laneName}:${wantedModel}`);
  }

  const row = matches[0];
  const dimensions = Number(row.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`rag_lane_registry_invalid_dimensions:${laneName}`);
  }

  const schemaName = String(row.schema_name || 'agentsam').trim();
  const tableName = String(row.table_name).trim();
  return {
    id: String(row.id || ''),
    name: laneName,
    purpose,
    ssot: 'pgvector',
    schemaName,
    tableName,
    qualifiedTable: `${schemaName}.${tableName}`,
    dimensions,
    embeddingModel: String(row.embedding_model || '').trim(),
    modelKey: arm.modelKey,
    provider: arm.provider,
    routingArmId: arm.id,
    modelCatalogId: arm.modelCatalogId,
    embeddingSpaceKey: `${normalizeEmbeddingModelKey(arm.modelKey)}:${dimensions}`,
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
      qualifiedTable: `agentsam.${code.tables.chunks}`,
      dimensions: code.dimensions,
      embeddingModel: code.embed.model,
      modelKey: code.embed.modelKey || code.embed.model,
      provider: code.embed.provider,
      routingArmId: code.embed.armId || null,
      modelCatalogId: code.embed.catalogId || null,
      embeddingSpaceKey: `${normalizeEmbeddingModelKey(code.embed.modelKey || code.embed.model)}:${code.dimensions}`,
      metric: 'cosine',
      vectorizeBinding: null,
      codeIndex: code,
    };
  }

  const taskType = TASK_TYPE_BY_LANE[name];
  const arm = await resolveGlobalEmbeddingArm(env, taskType);
  const lane = await resolvePgLane(env, name, arm);
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
