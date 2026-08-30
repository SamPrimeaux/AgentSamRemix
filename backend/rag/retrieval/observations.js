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

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Retrieval observations are policy/evaluation telemetry, not identity state.
 * Raw query text is deliberately not stored. Workspace/user/tenant may be used
 * upstream to authorize or physically partition a corpus, but they are never
 * persisted as learning dimensions here.
 */
export async function recordRetrievalObservation(env, observation) {
  if (!env?.DB) return { recorded: false, error: 'db_unavailable' };
  try {
    const id = trim(observation?.id) || `ret_${crypto.randomUUID().replace(/-/g, '')}`;
    const decisionId = trim(observation?.decisionId) || `rdec_${crypto.randomUUID().replace(/-/g, '')}`;
    const queryHash = await sha256Hex(observation?.query || '');
    const corpusKey = trim(observation?.corpusKey);
    if (!corpusKey) return { recorded: false, error: 'retrieval_corpus_key_required' };

    const metrics = observation?.metrics && typeof observation.metrics === 'object'
      ? observation.metrics
      : {};
    const metricsJson = JSON.stringify(metrics);
    if (metricsJson.length > 48_000) return { recorded: false, error: 'retrieval_metrics_too_large' };

    const values = [
      id,
      trim(observation?.runId) || null,
      decisionId,
      queryHash,
      trim(observation?.taskType) || 'retrieval',
      trim(observation?.corpusType) || 'code_index',
      corpusKey,
      trim(observation?.repoFullName) || null,
      trim(observation?.indexGenerationKey) || null,
      trim(observation?.revisionSha) || null,
      trim(observation?.policyVersion) || 'retrieval-v1',
      trim(observation?.denseRouteKey) || null,
      trim(observation?.embeddingSpaceKey) || null,
      Number(metrics.annK ?? observation?.annK) || 0,
      Number(metrics.denseCandidates) || 0,
      Number(metrics.lexicalCandidates) || 0,
      Number(metrics.astCandidates) || 0,
      Number(metrics.graphCandidates) || 0,
      Number(metrics.fusedCandidates) || 0,
      Number(metrics.rerankedCandidates) || 0,
      Number(metrics.selectedChunks) || 0,
      Number(metrics.selectedTokens) || 0,
      finiteOrNull(metrics.totalRetrievalMs),
      finiteOrNull(metrics?.stages?.rerankMs),
      finiteOrNull(metrics?.stages?.packingMs),
      finiteOrNull(metrics.fusionScoreMargin),
      finiteOrNull(metrics.fusionScoreEntropy),
      finiteOrNull(metrics.redundantTokenRatio),
      finiteOrNull(metrics.budgetUtilization),
      metricsJson,
    ];
    const placeholders = values.map(() => '?').join(', ');

    await env.DB.prepare(
      `INSERT INTO agentsam_retrieval_observations (
         id, run_id, decision_id, query_hash, task_type,
         corpus_type, corpus_key, repo_full_name, index_generation_key, revision_sha,
         retrieval_policy_version, dense_route_key, embedding_space_key, ann_k,
         dense_candidates, lexical_candidates, ast_candidates, graph_candidates,
         fused_candidates, reranked_candidates, selected_chunks, selected_tokens,
         total_retrieval_ms, rerank_ms, packing_ms,
         fusion_score_margin, fusion_score_entropy, redundant_token_ratio,
         budget_utilization, metrics_json, created_at
       ) VALUES (${placeholders}, unixepoch())`,
    ).bind(...values).run();
    return { recorded: true, id, decisionId };
  } catch (error) {
    const message = String(error?.message || error);
    return {
      recorded: false,
      error: message.includes('no such table')
        ? 'retrieval_observation_table_missing'
        : message.includes('no column named')
          ? 'retrieval_observation_schema_outdated'
          : `retrieval_observation_write_failed:${message.slice(0, 160)}`,
    };
  }
}

/**
 * Legacy Supabase search-log receipt retained for existing non-code lane
 * compatibility. workspace_id is the physical pgvector corpus partition only;
 * tenant/session/user identity is intentionally not duplicated into metadata.
 */
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

  const metadata = args?.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
    ? { ...args.metadata }
    : {};
  delete metadata.workspace_id;
  delete metadata.tenant_id;
  delete metadata.user_id;
  delete metadata.session_id;

  const metaObj = {
    ...metadata,
    search_fn: String(args?.searchFn || 'unknown').slice(0, 200),
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
