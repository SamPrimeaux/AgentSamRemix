/**
 * Workspace-scoped pgvector retrieval for semantic, non-code lanes.
 */
import { runHyperdriveQuery } from '../../services/database/hyperdrive.js';
import { embedTextForLane } from './embedding-router.js';
import { resolveRagLane } from './lane-registry.js';
import { resolveSupabaseWorkspaceId } from './workspace-resolver.js';
import { vectorLiteral } from './vector-utils.js';

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;

function qualifiedTable(schemaName, tableName) {
  if (!IDENTIFIER_RE.test(schemaName) || !IDENTIFIER_RE.test(tableName)) {
    throw new Error('rag_lane_registry_invalid_identifier');
  }
  return `"${schemaName}"."${tableName}"`;
}

function normalizeLimit(value, fallback = 8, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

export async function queryPgvectorLane(env, laneName, options = {}) {
  const lane = options.lane || (await resolveRagLane(env, laneName));
  const workspaceId = await resolveSupabaseWorkspaceId(
    env,
    options.workspaceId ?? options.workspace_id,
  );
  if (!workspaceId) throw new Error('rag_workspace_unresolved');
  const query = String(options.query ?? '').trim();
  if (!query) throw new Error('rag_query_required');
  const limit = normalizeLimit(options.limit ?? options.topK);
  const spec = options.embedding
    ? { embedding: options.embedding }
    : await embedTextForLane(env, lane.name, query, {
        taskType: 'RETRIEVAL_QUERY',
        userId: options.userId ?? null,
        workspaceId: options.workspaceId ?? options.workspace_id ?? null,
        spec: options.embeddingSpec,
      });
  const embedding = Array.isArray(spec) ? spec : spec.embedding;
  const vector = vectorLiteral(embedding);
  if (embedding.length !== lane.dimensions) {
    throw new Error(`rag_embedding_dimension_mismatch:expected=${lane.dimensions}:actual=${embedding.length}`);
  }

  const table = qualifiedTable(lane.schemaName, lane.tableName);
  const sql = `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
                 FROM ${table}
                WHERE workspace_id = $2::uuid
                ORDER BY embedding <=> $1::vector
                LIMIT $3`;
  const result = await runHyperdriveQuery(env, sql, [vector, workspaceId, limit]);
  if (!result?.ok) throw new Error(result?.error || 'rag_pgvector_query_failed');
  return (result.rows || []).map((row) => ({
    ...row,
    lane: lane.name,
    similarity: Number(row.similarity || 0),
  }));
}

export async function queryVectorizeLane(env, laneName, options = {}) {
  const lane = options.lane || (await resolveRagLane(env, laneName));
  const bindingName = lane.vectorizeBinding?.bindingName;
  const binding = bindingName ? env?.[bindingName] : null;
  if (typeof binding?.query !== 'function') return [];
  const workspaceId = String(options.workspaceId ?? options.workspace_id ?? '').trim();
  if (!workspaceId) throw new Error('rag_workspace_id_required');
  const query = String(options.query ?? '').trim();
  if (!query) throw new Error('rag_query_required');
  const spec = options.embedding
    ? { embedding: options.embedding }
    : await embedTextForLane(env, lane.name, query, {
        taskType: 'RETRIEVAL_QUERY',
        userId: options.userId ?? null,
        workspaceId: options.workspaceId ?? options.workspace_id ?? null,
        spec: options.embeddingSpec,
      });
  const embedding = Array.isArray(spec) ? spec : spec.embedding;
  if (embedding.length !== lane.vectorizeBinding.dimensions && lane.vectorizeBinding.dimensions) {
    throw new Error(
      `rag_embedding_dimension_mismatch:expected=${lane.vectorizeBinding.dimensions}:actual=${embedding.length}`,
    );
  }
  const result = await binding.query(embedding, {
    topK: normalizeLimit(options.limit ?? options.topK),
    filter: { workspace_id: { $eq: workspaceId } },
    returnMetadata: 'all',
  });
  return (result?.matches || result?.result?.matches || []).map((match) => ({
    id: String(match?.id ?? ''),
    lane: lane.name,
    title: String(match?.metadata?.title ?? lane.name),
    content: String(match?.metadata?.content ?? match?.metadata?.snippet ?? ''),
    source_ref: match?.metadata?.source_ref ?? null,
    file_path: match?.metadata?.path ?? match?.metadata?.source_path ?? null,
    similarity: Number(match?.score ?? 0),
    metadata: match?.metadata || {},
  }));
}

export async function queryRouteRagLanes(env, options = {}) {
  const lanes = options.lanes || ['docs', 'code', 'memory'];
  const results = [];
  for (const laneName of lanes) {
    if (laneName === 'code') continue;
    try {
      results.push(...(await queryPgvectorLane(env, laneName, options)));
    } catch (error) {
      if (options.failFast) throw error;
    }
  }
  return results
    .sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0))
    .slice(0, normalizeLimit(options.limit, 8, 50));
}

const LANES_BY_INTENT = Object.freeze({
  code: ['code', 'schema'],
  schema: ['schema', 'code'],
  courses: ['docs', 'code'],
  memory: ['memory'],
  architecture: ['memory', 'schema', 'archive'],
  mixed: ['memory', 'code', 'docs', 'schema'],
});

export async function retrieveContextPack(env, options = {}) {
  const query = String(options.query ?? '').trim();
  const workspaceId = String(options.workspaceId ?? options.workspace_id ?? '').trim();
  const intent = String(options.intent ?? 'mixed').trim().toLowerCase() || 'mixed';
  const maxChunks = normalizeLimit(options.maxChunks, 8, 20);
  if (!query || !workspaceId) {
    return {
      query,
      intent,
      chunks: [],
      diagnostics: { searchedLanes: [], resultCounts: {}, confidence: 'low' },
    };
  }

  const searchedLanes = [...(LANES_BY_INTENT[intent] || LANES_BY_INTENT.mixed)];
  const resultCounts = {};
  const combined = [];
  for (const lane of searchedLanes) {
    if (lane === 'code') continue;
    try {
      const hits = await queryPgvectorLane(env, lane, {
        workspaceId,
        query,
        limit: maxChunks,
        userId: options.userId ?? null,
      });
      resultCounts[lane] = hits.length;
      combined.push(...hits);
    } catch {
      resultCounts[lane] = 0;
    }
  }

  const seen = new Set();
  const chunks = combined
    .sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0))
    .filter((hit) => {
      const key = String(hit.content_hash || hit.sourceRef || hit.source_ref || hit.id || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxChunks)
    .map((hit) => ({
      lane: hit.lane,
      id: hit.id,
      title: hit.title,
      content: hit.content,
      sourcePath: hit.sourcePath || hit.file_path || null,
      sourceRef: hit.sourceRef || hit.source_ref || null,
      similarity: Number(hit.similarity || hit.score || 0),
      metadata: hit.metadata || {},
    }));
  return {
    query,
    intent,
    chunks,
    diagnostics: {
      searchedLanes,
      resultCounts,
      confidence: chunks.length && chunks[0].similarity > 0.72 ? 'medium' : chunks.length ? 'low' : 'low',
    },
  };
}
