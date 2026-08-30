import { isHyperdriveUsable, runHyperdriveQuery } from '../../services/database/hyperdrive.js';
import { resolveSupabaseWorkspaceId } from '../scope/workspace.js';

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Retrieval observations are control/evaluation telemetry. Raw query text is
 * deliberately not stored; only a SHA-256 query hash and bounded metrics JSON.
 */
export async function recordRetrievalObservation(env, observation) {
  if (!env?.DB) return { recorded: false, error: 'db_unavailable' };
  try {
    const id = observation?.id || `ret_${crypto.randomUUID().replace(/-/g, '')}`;
    const queryHash = await sha256Hex(observation?.query || '');
    const metrics = observation?.metrics && typeof observation.metrics === 'object'
      ? observation.metrics
      : {};
    const metricsJson = JSON.stringify(metrics);
    if (metricsJson.length > 48_000) return { recorded: false, error: 'retrieval_metrics_too_large' };

    await env.DB.prepare(
      `INSERT INTO agentsam_retrieval_observations (
         id, workspace_id, tenant_id, user_id, run_id, query_hash,
         task_type, scope_type, scope_id, retrieval_policy_version,
         dense_route_key, embedding_space_key, ann_k,
         dense_candidates, lexical_candidates, ast_candidates, fused_candidates,
         reranked_candidates, selected_chunks, selected_tokens, metrics_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    ).bind(
      id,
      trim(observation?.workspaceId),
      trim(observation?.tenantId) || null,
      trim(observation?.userId) || null,
      trim(observation?.runId) || null,
      queryHash,
      trim(observation?.taskType) || 'retrieval',
      trim(observation?.scopeType) || 'workspace',
      trim(observation?.scopeId) || null,
      trim(observation?.policyVersion) || 'retrieval-v1',
      trim(observation?.denseRouteKey) || null,
      trim(observation?.embeddingSpaceKey) || null,
      Number(observation?.annK) || 0,
      Number(metrics.denseCandidates) || 0,
      Number(metrics.lexicalCandidates) || 0,
      Number(metrics.astCandidates) || 0,
      Number(metrics.fusedCandidates) || 0,
      Number(metrics.rerankedCandidates) || 0,
      Number(metrics.selectedChunks) || 0,
      Number(metrics.selectedTokens) || 0,
      metricsJson,
    ).run();
    return { recorded: true, id };
  } catch (error) {
    const message = String(error?.message || error);
    return {
      recorded: false,
      error: message.includes('no such table')
        ? 'retrieval_observation_table_missing'
        : `retrieval_observation_write_failed:${message.slice(0, 160)}`,
    };
  }
}


/** Legacy search-log receipt retained as retrieval telemetry, not HTTP behavior. */
export async function logSemanticSearch(env, args) {
  const workspaceIdD1 =
    args?.workspaceId != null && String(args.workspaceId).trim() !== ''
      ? String(args.workspaceId).trim()
      : args?.metadata?.workspace_id != null
        ? String(args.metadata.workspace_id).trim()
        : '';
  if (!workspaceIdD1 || !isHyperdriveUsable(env)) return;

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceIdD1).catch(() => null);
  if (!workspaceUuid) return;

  const metaObj = {
    ...(args?.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
      ? args.metadata
      : {}),
    search_fn: String(args?.searchFn || 'unknown').slice(0, 200),
    tenant_id: args?.tenantId != null ? String(args.tenantId).trim() : null,
    session_id:
      args?.sessionId != null && String(args.sessionId).trim() !== ''
        ? String(args.sessionId).trim().slice(0, 500)
        : null,
    match_threshold: args?.matchThreshold,
    match_count_requested: args?.matchCountRequested,
    top_similarity: args?.topSimilarity ?? null,
    avg_similarity: args?.avgSimilarity ?? null,
    sources_hit: Array.isArray(args?.sourcesHit) ? args.sourcesHit : [],
  };

  const result = await runHyperdriveQuery(
    env,
    `INSERT INTO agentsam.agentsam_search_log (
       workspace_id, user_id, query_text, result_count, duration_ms, search_type, metadata
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)`,
    [
      workspaceUuid,
      null,
      String(args?.queryPreview ?? '').slice(0, 4000),
      Number(args?.matchCountReturned) || 0,
      Math.max(0, Math.floor(args?.latencyMs ?? 0)),
      String(args?.searchFn || 'unified_search').slice(0, 120),
      JSON.stringify(metaObj),
    ],
  );
  if (!result?.ok) console.warn('[rag] agentsam_search_log insert:', result?.error ?? 'query_failed');
}
