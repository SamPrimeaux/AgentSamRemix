/**
 * agentsam_cf_vectorize — query | upsert | delete against AGENTSAM_VECTORIZE_* bindings.
 */
import { embedTextForLane } from '../../../backend/rag/embeddings/lane-router.js';
import { resolveRagLane } from '../../../backend/rag/lanes/registry.js';
import { embedMultimodalContent } from '../../core/multimodal-embedding.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

async function listVectorizeRegistry(env) {
  if (!env?.DB) return [];
  const result = await env.DB.prepare(
    `SELECT binding_name, index_name, dimensions, metric
       FROM vectorize_index_registry
      WHERE COALESCE(is_active, 1) = 1
      ORDER BY index_name`,
  ).all().catch(() => ({ results: [] }));
  return (result?.results || []).filter((row) => row?.binding_name && row?.index_name);
}

async function resolveVectorizeBinding(env, requested) {
  const raw = trim(requested);
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/_/g, '-');
  const rows = await listVectorizeRegistry(env);
  const aliases = {
    code: 'AGENTSAM_VECTORIZE_CODE',
    courses: 'AGENTSAM_VECTORIZE_COURSES',
    memory: 'AGENTSAM_VECTORIZE_MEMORY',
    schema: 'AGENTSAM_VECTORIZE_SCHEMA',
    documents: 'AGENTSAM_VECTORIZE_DOCUMENTS',
    docs: 'AGENTSAM_VECTORIZE_DOCUMENTS',
    media: 'AGENTSAM_VECTORIZE_MEDIA',
    moviemode: 'AGENTSAM_VECTORIZE_MEDIA',
  };
  const aliasBinding = aliases[normalized] || null;
  const row = rows.find((candidate) =>
    String(candidate.index_name).toLowerCase() === normalized ||
    String(candidate.binding_name).toLowerCase() === raw.toLowerCase() ||
    (aliasBinding && candidate.binding_name === aliasBinding),
  );
  if (!row || !env?.[row.binding_name]) return null;
  return {
    bindingName: String(row.binding_name),
    indexName: String(row.index_name),
    dimensions: Number(row.dimensions) || null,
    metric: String(row.metric || 'cosine'),
  };
}

async function resolveEmbeddingLaneForBinding(env, bindingName, indexName) {
  for (const laneName of ['memory', 'docs', 'schema', 'media']) {
    const lane = await resolveRagLane(env, laneName).catch(() => null);
    if (!lane?.vectorizeBinding) continue;
    if (
      lane.vectorizeBinding.bindingName === bindingName ||
      (lane.vectorizeBinding.indexName && lane.vectorizeBinding.indexName === indexName)
    ) return lane;
  }
  return null;
}

async function embedForIndex(env, bindingName, indexName, queryText, scope = {}, input = {}) {
  const lane = await resolveEmbeddingLaneForBinding(env, bindingName, indexName);
  if (!lane) throw new Error(`embedding_lane_unregistered:${indexName}`);
  if (lane.name === 'media') {
    if (lane.provider !== 'google') throw new Error(`media_embedding_provider_unsupported:${lane.provider}`);
    const parts = Array.isArray(input?.parts) ? input.parts : [];
    const out = await embedMultimodalContent(env, {
      text: queryText,
      parts,
      modelKey: lane.modelKey,
      dimensions: lane.dimensions,
    });
    return { embedding: out.embedding, dimensions: lane.dimensions, lane };
  }
  const out = await embedTextForLane(env, lane.name, queryText, {
    userId: scope.userId ?? null,
    tenantId: scope.tenantId ?? null,
  });
  return { embedding: out.embedding, dimensions: lane.dimensions, lane };
}

async function expectedDimensions(env, binding, bindingName, indexName, registeredDimensions = null) {
  if (Number.isInteger(Number(registeredDimensions)) && Number(registeredDimensions) > 0) return Number(registeredDimensions);
  const lane = await resolveEmbeddingLaneForBinding(env, bindingName, indexName);
  if (lane?.dimensions) return Number(lane.dimensions);
  if (typeof binding?.describe === 'function') {
    const described = await binding.describe().catch(() => null);
    const dimensions = Number(described?.dimensions ?? described?.config?.dimensions);
    if (Number.isInteger(dimensions) && dimensions > 0) return dimensions;
  }
  return null;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null) out[k] = null;
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = JSON.stringify(v).slice(0, 2000);
  }
  return out;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} input
 * @param {{ workspaceId?: string|null, tenantId?: string|null, userId?: string|null }} [scope]
 */
export async function handleCfVectorizeManage(env, input, scope = {}) {
  const indexNameRaw = trim(input?.index_name || input?.indexName || input?.index);
  const registry = await listVectorizeRegistry(env);
  const validIndexes = registry.filter((row) => env?.[row.binding_name]).map((row) => row.index_name);

  if (!indexNameRaw) {
    return { ok: false, error: 'index_name required', valid_indexes: validIndexes };
  }

  const resolved = await resolveVectorizeBinding(env, indexNameRaw);
  if (!resolved) {
    return {
      ok: false,
      error: 'unknown_vectorize_index',
      index_name: indexNameRaw,
      valid_indexes: validIndexes,
      available_bindings: Object.keys(env || {}).filter((k) => k.startsWith('AGENTSAM_VECTORIZE_')),
    };
  }

  const { bindingName, indexName, dimensions: registeredDimensions } = resolved;
  const binding = env[bindingName];
  if (!binding) {
    return { ok: false, error: 'vectorize_binding_unavailable', binding: bindingName, index_name: indexName };
  }

  const op = trim(input?.operation || input?.op || input?.action).toLowerCase() || 'query';
  const workspaceId = trim(input?.workspace_id) || trim(scope?.workspaceId) || '';
  const tenantId = trim(input?.tenant_id) || trim(scope?.tenantId) || '';
  const userId = trim(input?.user_id) || trim(scope?.userId) || null;

  if (op === 'query') {
    let vector = Array.isArray(input?.vector) ? input.vector : null;
    const queryText = trim(input?.query || input?.q);

    if ((!vector || !vector.length) && queryText) {
      try {
        const embedded = await embedForIndex(env, bindingName, indexName, queryText, { userId, tenantId }, input);
        vector = embedded.embedding;
      } catch (e) {
        return { ok: false, error: 'embedding_failed', message: String(e?.message || e) };
      }
    }

    if (!Array.isArray(vector) || !vector.length) {
      return { ok: false, error: 'vector or query required for query operation' };
    }
    const expectedDim = await expectedDimensions(env, binding, bindingName, indexName, registeredDimensions);
    if (expectedDim && vector.length !== expectedDim) {
      return {
        ok: false,
        error: 'invalid_vector_dimensions',
        got: vector.length,
        expected: expectedDim,
      };
    }

    const topK = Math.min(Math.max(1, Number(input?.top_k ?? input?.topK ?? input?.limit) || 10), 100);
    const filter = { ...(input?.filter && typeof input.filter === 'object' ? input.filter : {}) };
    if (workspaceId && filter.workspace_id == null) filter.workspace_id = workspaceId;
    if (tenantId && filter.tenant_id == null) filter.tenant_id = tenantId;

    const results = await binding.query(vector, {
      topK,
      returnMetadata: 'all',
      ...(Object.keys(filter).length ? { filter } : {}),
    });
    const matches = results?.matches || results?.result?.matches || [];
    return {
      ok: true,
      operation: 'query',
      binding: bindingName,
      index_name: indexName,
      top_k: topK,
      match_count: matches.length,
      matches,
    };
  }

  if (op === 'upsert') {
    const id = trim(input?.id || input?.vector_id);
    if (!id) return { ok: false, error: 'id required for upsert' };

    let vector = Array.isArray(input?.vector) ? input.vector : null;
    const text = trim(input?.text || input?.content || input?.value);
    if ((!vector || !vector.length) && text) {
      try {
        const embedded = await embedForIndex(env, bindingName, indexName, text, { userId, tenantId }, input);
        vector = embedded.embedding;
      } catch (e) {
        return { ok: false, error: 'embedding_failed', message: String(e?.message || e) };
      }
    }

    if (!Array.isArray(vector) || !vector.length) {
      return { ok: false, error: 'vector or text required for upsert' };
    }
    const expectedDimUpsert = await expectedDimensions(env, binding, bindingName, indexName, registeredDimensions);
    if (expectedDimUpsert && vector.length !== expectedDimUpsert) {
      return {
        ok: false,
        error: 'invalid_vector_dimensions',
        got: vector.length,
        expected: expectedDimUpsert,
      };
    }

    const metadata = sanitizeMetadata(input?.metadata);
    if (workspaceId && metadata.workspace_id == null) metadata.workspace_id = workspaceId;
    if (tenantId && metadata.tenant_id == null) metadata.tenant_id = tenantId;

    await binding.upsert([{ id, values: vector, metadata }]);
    return { ok: true, operation: 'upsert', binding: bindingName, index_name: indexName, upserted: id };
  }

  if (op === 'delete') {
    const idList = Array.isArray(input?.ids)
      ? input.ids.map((x) => trim(x)).filter(Boolean)
      : trim(input?.id)
        ? [trim(input.id)]
        : [];
    if (!idList.length) return { ok: false, error: 'id or ids required for delete' };
    if (typeof binding.deleteByIds !== 'function') {
      return { ok: false, error: `${bindingName}.deleteByIds unavailable` };
    }
    await binding.deleteByIds(idList);
    return {
      ok: true,
      operation: 'delete',
      binding: bindingName,
      index_name: indexName,
      deleted: idList,
    };
  }

  return { ok: false, error: 'operation must be query | upsert | delete', valid_indexes: validIndexes };
}
