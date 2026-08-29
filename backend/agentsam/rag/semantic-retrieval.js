import { queryPgvectorLane, queryVectorizeLane } from './retriever.js';
import { laneNamesForRoute, resolveRagLane } from './lane-registry.js';
import { contentHash } from './vector-utils.js';

export const SEMANTIC_LANE_KEYS = Object.freeze([
  'code',
  'schema',
  'memory',
  'docs',
  'client_project',
  'media',
  'archive',
]);

export const SEMANTIC_LANE_REGISTRY = Object.freeze({
  code: Object.freeze({ laneKey: 'code', ragLane: 'code', binding: null }),
  schema: Object.freeze({ laneKey: 'schema', ragLane: 'schema', binding: null }),
  memory: Object.freeze({ laneKey: 'memory', ragLane: 'memory', binding: null }),
  docs: Object.freeze({ laneKey: 'docs', ragLane: 'docs', binding: null }),
  client_project: Object.freeze({
    laneKey: 'client_project',
    ragLane: null,
    binding: null,
    composite: Object.freeze(['docs', 'memory']),
  }),
  media: Object.freeze({ laneKey: 'media', ragLane: 'media', binding: null }),
  archive: Object.freeze({ laneKey: 'archive', ragLane: 'archive', binding: null }),
});

export async function semanticQueryHash(text) {
  return (await contentHash(text)).slice(0, 32);
}

/**
 * Runtime callers should use resolveEmbeddingSpec() because dimensions are
 * D1-owned. This compatibility-shaped helper only identifies the lane family.
 */
export function embeddingSpecForSemanticLane(laneKey) {
  if (!SEMANTIC_LANE_REGISTRY[laneKey]) throw new Error(`unknown semantic lane: ${laneKey}`);
  return { provider: 'd1', model: null, dimensions: null };
}

function normalizeLimit(value) {
  return Math.min(20, Math.max(1, Number(value) || 6));
}

function mapHit(lane, hit) {
  return {
    lane,
    id: String(hit.id ?? ''),
    title: String(hit.title ?? hit.file_path ?? lane).trim(),
    content: String(hit.content ?? '').trim(),
    source_ref: hit.source_ref != null ? String(hit.source_ref) : null,
    file_path: hit.file_path != null ? String(hit.file_path) : null,
    score: Number(hit.similarity ?? hit.score ?? 0),
    metadata: hit.metadata && typeof hit.metadata === 'object' ? hit.metadata : {},
  };
}

export async function dispatchSemanticRetrieval(env, opts = {}) {
  const laneKey = String(opts.lane ?? '').trim().toLowerCase();
  const query = String(opts.query ?? '').trim();
  const workspaceId = String(opts.workspace_id ?? opts.workspaceId ?? '').trim();
  const topK = normalizeLimit(opts.top_k ?? opts.topK);
  const queryHash = await semanticQueryHash(query);
  const reg = SEMANTIC_LANE_REGISTRY[laneKey];

  if (!reg || !query || !workspaceId) {
    return {
      ok: false,
      lane: laneKey,
      backend: 'none',
      binding: null,
      table: null,
      query_hash: queryHash,
      results: [],
      result_count: 0,
      fallback_used: false,
      degraded_reason: !reg ? 'unknown_lane' : 'missing_query_or_workspace',
      error: 'invalid_dispatch_input',
    };
  }

  const laneNames = reg.composite || [reg.ragLane];
  const results = [];
  for (const lane of laneNames) {
    if (lane === 'code' && opts.allow_codebase !== true) continue;
    try {
      const vectorHits = await queryVectorizeLane(env, lane, {
        workspaceId,
        query,
        limit: topK,
        userId: opts.user_id ?? opts.userId ?? null,
        embedding: opts.embedding,
      });
      const hits = vectorHits.length
        ? vectorHits
        : await queryPgvectorLane(env, lane, {
        workspaceId,
        query,
        limit: topK,
        userId: opts.user_id ?? opts.userId ?? null,
        embedding: opts.embedding,
          });
      results.push(...hits.map((hit) => mapHit(lane, hit)));
    } catch (error) {
      if (opts.fail_fast) throw error;
      if (!results.length) {
        return {
          ok: false,
          lane: laneKey,
          backend: 'pgvector',
          binding: null,
          table: null,
          query_hash: queryHash,
          results: [],
          result_count: 0,
          fallback_used: false,
          degraded_reason: 'retrieval_failed',
          error: String(error?.message || error),
        };
      }
    }
  }

  const seen = new Set();
  const deduped = results
    .sort((a, b) => b.score - a.score)
    .filter((row) => {
      const key = row.id || row.source_ref || `${row.lane}:${row.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, topK);
  const firstLane = laneNames[0];
  const lane = await resolveRagLane(env, firstLane).catch(() => null);
  return {
    ok: true,
    lane: laneKey,
    backend: 'pgvector',
    binding: lane?.vectorizeBinding?.bindingName ?? null,
    table: lane?.tableName ?? null,
    query_hash: queryHash,
    results: deduped,
    result_count: deduped.length,
    fallback_used: false,
    degraded_reason: deduped.length ? null : 'no_hits',
    error: null,
  };
}

export { laneNamesForRoute };
