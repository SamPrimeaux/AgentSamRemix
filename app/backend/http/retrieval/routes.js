import { retrieveKnowledge } from '../../knowledge/retrieval/index.js';
import { createRetrievalRuntimeServices } from '../../knowledge/retrieval/runtime-services.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export async function handleRetrievalHttpRequest(request, env, scope, services = null) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/agent/retrieval/query') return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!scope?.userId || !scope?.workspaceId) return json({ ok: false, error: 'workspace_scope_required' }, 409);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_json' }, 400);
  const query = trim(body.query);
  if (!query) return json({ ok: false, error: 'retrieval_query_required' }, 400);
  const runtimeServices = services || createRetrievalRuntimeServices(env, scope);

  const result = await retrieveKnowledge(env, {
    query,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    repoFullName: trim(body.repoFullName || body.repo_full_name || body.repo),
    sourceType: trim(body.sourceType || body.source_type) || 'code',
    taskType: trim(body.taskType || body.task_type) || 'knowledge_retrieval',
    runId: trim(body.runId || body.run_id) || null,
    candidateK: body.candidateK ?? body.candidate_k,
    topK: body.topK ?? body.top_k,
    tokenBudget: body.tokenBudget ?? body.token_budget,
    nodeTypes: Array.isArray(body.nodeTypes || body.node_types) ? (body.nodeTypes || body.node_types) : [],
    edgeTypes: Array.isArray(body.edgeTypes || body.edge_types) ? (body.edgeTypes || body.edge_types) : [],
    forceRerank: body.forceRerank === true || body.force_rerank === true,
  }, runtimeServices);

  return json(result, result.ok ? 200 : Number(result.status) || 500);
}
