/**
 * Codebase semantic search — Hyperdrive pgvector only (no CF Vectorize).
 * Query embed must match indexer: resolveCodeIndexLaneConfig → embedSpecFromCodeIndexLaneConfig.
 */
import { createAgentsamEmbedding } from './agentsam-vectorize.js';
import { assertAgentsamEmbeddingDimensions } from './agentsam-vectorize-index.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { resolveSupabaseWorkspaceId } from '../../backend/agentsam/rag/index.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
  embedSpecFromCodeIndexLaneConfig,
} from '../../backend/agentsam/codebase/code-index-lane-resolve.js';

/**
 * Embed a codebase search query — same Gemini lane as the indexer.
 * @param {any} env
 * @param {string} query
 * @param {{
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   taskType?: string,
 * }} [opts]
 */
export async function embedCodebaseSearchQuery(env, query, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const lane = requireCodeIndexLaneConfig(env);
  const spec = embedSpecFromCodeIndexLaneConfig(lane);
  const chunksTable = lane.tables.chunks;
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const { embedding, model, provider, tokens_in } = await createAgentsamEmbedding(env, query, {
    spec,
    userId: opts.userId ?? null,
    workspaceId: ws || null,
    taskType: 'RETRIEVAL_QUERY',
    usage: ws
      ? {
          workspace_id: ws,
          tenant_id: opts.tenantId || undefined,
          user_id: opts.userId ?? null,
          task_type: opts.taskType || 'code_retrieve',
          tool_name: 'codebase_search',
          ref_table: chunksTable,
        }
      : false,
  });
  assertAgentsamEmbeddingDimensions(embedding, spec.dimensions);
  return { embedding, model, provider, dimensions: spec.dimensions, tokens_in };
}

/**
 * @deprecated CF Vectorize is not part of code index — always empty.
 */
export async function searchCodebaseVectorize(_env, _query, _opts = {}) {
  return { hits: [], skipped: 'code_index_no_cf_vectorize', model: null, dimensions: 1536 };
}

/**
 * pgvector ANN on the live code-index table.
 * Do not call public.semantic_code_search — that RPC was never applied here
 * (42883) and targeted dropped public.code_chunks, not agentsam chunks.
 *
 * @param {any} env
 * @param {string} query
 * @param {{ workspaceId: string, matchCount?: number, matchThreshold?: number, userId?: string|null, tenantId?: string|null }} opts
 */
export async function searchCodebasePg(env, query, opts) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = requireCodeIndexLaneConfig(env).tables.chunks;
  const workspaceId = String(opts.workspaceId || '').trim();
  if (!workspaceId) throw new Error('workspaceId required');
  if (!isHyperdriveUsable(env)) return { rows: [], skipped: 'hyperdrive_unavailable' };

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceId);
  if (!workspaceUuid) {
    return { rows: [], error: 'workspace_uuid_required' };
  }

  const { embedding, model, dimensions } = await embedCodebaseSearchQuery(env, query, {
    workspaceId,
    userId: opts.userId,
    tenantId: opts.tenantId,
    taskType: 'code_retrieve',
  });
  const matchCount = Math.min(Math.max(1, Number(opts.matchCount) || 8), 50);
  const matchThreshold = Number(opts.matchThreshold);
  const threshold = Number.isFinite(matchThreshold) ? matchThreshold : 0.5;

  const vecLit = `[${embedding.join(',')}]`;
  const sql = `
    SELECT id::text AS chunk_id,
           file_path,
           content,
           chunk_index,
           node_id,
           1 - (embedding <=> $1::vector) AS similarity
      FROM agentsam.${chunksTable}
     WHERE workspace_id = $2::uuid
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) > $4::float
     ORDER BY embedding <=> $1::vector
     LIMIT $3::int`;
  const r = await runHyperdriveQuery(env, sql, [
    vecLit,
    workspaceUuid,
    matchCount,
    threshold,
  ]);
  if (!r.ok) {
    return { rows: [], model, dimensions, error: r.error || 'hyperdrive_query_failed' };
  }
  return { rows: r.rows || [], model, dimensions, backend: 'pgvector_chunks' };
}

/**
 * Code retrieve: Hyperdrive pgvector only (no Cloudflare Vectorize).
 * @param {any} env
 * @param {string} query
 * @param {{ workspaceId: string, topK?: number, userId?: string|null, tenantId?: string|null }} opts
 */
export async function searchCodebase(env, query, opts) {
  const workspaceId = String(opts.workspaceId || '').trim();
  if (!workspaceId) throw new Error('workspaceId required');

  let pg = { rows: [], skipped: 'not_requested' };
  try {
    pg = await searchCodebasePg(env, query, {
      workspaceId,
      matchCount: opts.topK,
      userId: opts.userId,
      tenantId: opts.tenantId,
    });
  } catch (e) {
    pg = { rows: [], error: String(e?.message || e) };
  }

  return { vectorize: { hits: [], skipped: 'code_index_no_cf_vectorize' }, pg };
}
