/**
 * GET /api/agentsam/spawn-tree — flat chain listing by chain_root_id (Sprint 2A).
 */
import { jsonResponse } from '../../core/responses.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {Record<string, unknown>} authUser
 */
export async function handleAgentsamSpawnTree(request, url, env, authUser) {
  void request;
  if (!env?.DB) return jsonResponse({ error: 'DB unavailable' }, 503);

  const runId = trim(url.searchParams.get('run_id'));
  const conversationId = trim(url.searchParams.get('conversation_id'));
  if (!runId && !conversationId) {
    return jsonResponse({ error: 'run_id or conversation_id required' }, 400);
  }

  const userId = trim(authUser?.id);
  let limit = Number(url.searchParams.get('limit') || 200) || 200;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  let anchor = null;
  if (runId) {
    anchor = await env.DB.prepare(
      `SELECT id, chain_root_id, parent_run_id, workspace_id, user_id, conversation_id
         FROM agentsam_agent_run
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
  } else {
    anchor = await env.DB.prepare(
      `SELECT id, chain_root_id, parent_run_id, workspace_id, user_id, conversation_id
         FROM agentsam_agent_run
        WHERE conversation_id = ?
        ORDER BY COALESCE(created_at_unix, 0) DESC, id DESC
        LIMIT 1`,
    )
      .bind(conversationId)
      .first()
      .catch(() => null);
  }

  if (!anchor?.id) {
    return jsonResponse({
      ok: true,
      chain_root_id: null,
      anchor_run_id: runId || null,
      conversation_id: conversationId || null,
      row_count: 0,
      rows: [],
    });
  }

  if (userId && anchor.user_id && trim(anchor.user_id) !== userId) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const chainRoot = trim(anchor.chain_root_id) || trim(anchor.id);
  const { results } = await env.DB.prepare(
    `SELECT id, parent_run_id, chain_root_id, status, mode, task_type, trigger,
            agent_id, model_id, ai_model_ref, latency_ms, cost_usd, error_message,
            conversation_id, workspace_id, user_id, routing_arm_id,
            created_at, created_at_unix, started_at, completed_at
       FROM agentsam_agent_run
      WHERE chain_root_id = ? OR id = ?
      ORDER BY COALESCE(created_at_unix, 0) ASC, id ASC
      LIMIT ?`,
  )
    .bind(chainRoot, chainRoot, limit)
    .all()
    .catch(() => ({ results: [] }));

  const rows = Array.isArray(results) ? results : [];

  return jsonResponse({
    ok: true,
    chain_root_id: chainRoot,
    anchor_run_id: trim(anchor.id),
    conversation_id: trim(anchor.conversation_id) || conversationId || null,
    row_count: rows.length,
    rows,
  });
}
