const CACHE_TTL_MS = 30_000;
const cache = new WeakMap();
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeProvider(value) {
  const provider = trim(value).toLowerCase().replace(/-/g, '_');
  return provider === 'workersai' ? 'workers_ai' : provider;
}

function normalizeModel(value) {
  return trim(value).replace(/^models\//i, '');
}

function assertIdentifier(value, label) {
  const text = trim(value);
  if (!IDENTIFIER_RE.test(text)) throw new Error(`${label}_invalid`);
  return text;
}

function normalizeMetric(value) {
  const metric = trim(value).toLowerCase() || 'cosine';
  if (!['cosine', 'euclidean', 'dot'].includes(metric)) throw new Error(`embedding_metric_invalid:${metric}`);
  return metric;
}

function validateRoute(route) {
  if (!route?.routeKey) throw new Error('embedding_route_key_required');
  if (route.purpose !== 'codebase') throw new Error('embedding_route_purpose_mismatch');
  if (!route.provider) throw new Error('embedding_route_provider_required');
  if (!route.model) throw new Error('embedding_route_model_required');
  if (!Number.isInteger(route.dimensions) || route.dimensions <= 0) throw new Error('embedding_route_dimensions_invalid');
  if (!route.embeddingSpaceKey) throw new Error('embedding_space_key_required');
  assertIdentifier(route.schemaName, 'embedding_route_schema');
  assertIdentifier(route.tableName, 'embedding_route_table');
  return Object.freeze(route);
}

async function routeFromNewRegistry(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT route_key, purpose, provider, model_key, dimensions, metric, pooling,
              embedding_space_key, embedding_version, vector_store,
              schema_name, table_name
         FROM agentsam_embedding_routes
        WHERE purpose = 'codebase'
          AND COALESCE(is_active, 1) = 1
        ORDER BY COALESCE(is_preferred, 0) DESC, COALESCE(priority, 100) ASC, updated_at DESC
        LIMIT 1`,
    ).first();
    if (!row?.route_key) return null;
    if (trim(row.vector_store) && !['pgvector', 'supabase_pgvector', 'hybrid'].includes(trim(row.vector_store))) {
      throw new Error(`embedding_route_vector_store_unsupported:${trim(row.vector_store)}`);
    }
    return validateRoute({
      routeKey: trim(row.route_key),
      purpose: 'codebase',
      provider: normalizeProvider(row.provider),
      model: normalizeModel(row.model_key),
      dimensions: Number(row.dimensions),
      metric: normalizeMetric(row.metric),
      pooling: trim(row.pooling) || 'mean',
      embeddingVersion: trim(row.embedding_version) || 'v1',
      embeddingSpaceKey: trim(row.embedding_space_key),
      vectorStore: trim(row.vector_store) || 'pgvector',
      schemaName: trim(row.schema_name) || 'agentsam',
      tableName: trim(row.table_name),
      source: 'agentsam_embedding_routes',
    });
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return null;
    throw error;
  }
}

async function routeFromLegacyRegistries(env) {
  const lane = await env.DB.prepare(
    `SELECT id, schema_name, table_name, dimensions, embedding_model, metric
       FROM agentsam_pgvector_lane_registry
      WHERE purpose = 'codebase'
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_archive, 0) = 0
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  ).first();
  if (!lane?.table_name) throw new Error('code_embedding_lane_missing');

  const arm = await env.DB.prepare(
    `SELECT id, provider, model_key, model_catalog_id
       FROM agentsam_routing_arms
      WHERE task_type = 'code_index_embed'
        AND COALESCE(TRIM(workspace_id), '') = ''
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_eligible, 1) = 1
        AND COALESCE(is_paused, 0) = 0
        AND COALESCE(budget_exhausted, 0) = 0
      ORDER BY COALESCE(priority, 0) DESC, updated_at DESC
      LIMIT 1`,
  ).first();
  if (!arm?.model_key) throw new Error('code_embedding_arm_missing');

  let provider = normalizeProvider(arm.provider);
  let model = normalizeModel(arm.model_key);
  if (arm.model_catalog_id) {
    const catalog = await env.DB.prepare(
      `SELECT provider, provider_model_id, model_key
         FROM agentsam_model_catalog
        WHERE id = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(budget_exhausted, 0) = 0
        LIMIT 1`,
    ).bind(String(arm.model_catalog_id)).first();
    if (!catalog) throw new Error('code_embedding_catalog_missing');
    provider = normalizeProvider(catalog.provider || provider);
    model = normalizeModel(catalog.provider_model_id || catalog.model_key || model);
  }

  const registryModel = normalizeModel(lane.embedding_model).toLowerCase();
  const selectedModel = normalizeModel(model).toLowerCase();
  if (!registryModel || registryModel !== selectedModel) {
    throw new Error(`code_embedding_model_drift:registry=${registryModel || 'missing'}:route=${selectedModel || 'missing'}`);
  }
  if (!provider) throw new Error('code_embedding_provider_missing');
  const dimensions = Number(lane.dimensions);
  const pooling = 'mean';
  const version = 'v1';
  return validateRoute({
    routeKey: `codebase:${trim(lane.id)}:${trim(arm.id)}`,
    purpose: 'codebase',
    provider,
    model: normalizeModel(model),
    dimensions,
    metric: normalizeMetric(lane.metric),
    pooling,
    embeddingVersion: version,
    embeddingSpaceKey: `${provider}:${normalizeModel(model)}:${dimensions}:${pooling}:${version}`,
    vectorStore: 'supabase_pgvector',
    schemaName: trim(lane.schema_name) || 'agentsam',
    tableName: trim(lane.table_name),
    source: 'legacy_code_index_registries',
  });
}

/** Resolve code semantic space from D1 only. No hardcoded provider/model/table fallback. */
export async function resolveCodeEmbeddingRoute(env) {
  if (!env?.DB) throw new Error('embedding_route_db_required');
  const hit = cache.get(env);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.route;
  const route = (await routeFromNewRegistry(env)) || (await routeFromLegacyRegistries(env));
  cache.set(env, { at: Date.now(), route });
  return route;
}
