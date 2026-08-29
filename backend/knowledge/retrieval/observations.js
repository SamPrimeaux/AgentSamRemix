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
