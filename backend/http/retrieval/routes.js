import { machineProofHasCapability } from '../../auth/bridge-key-auth.js';
import { retrieveKnowledge, createRetrievalRuntimeServices } from '../../rag/index.js';
import { resolveActiveCorpusForRepo } from '../../rag/retrieval/corpus-registry.js';
import { runRetrievalEvaluation } from '../../rag/retrieval/eval-runner.js';

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

function isMachineScope(scope) {
  return scope?.authType === 'service' && scope?.machineProof?.type === 'bridge';
}

async function resolveRetrievalScope(env, scope, repoFullName) {
  if (!isMachineScope(scope)) {
    if (!scope?.userId) {
      return { ok: false, error: 'user_scope_required', status: 401 };
    }
    if (repoFullName) {
      const registry = await resolveActiveCorpusForRepo(env, repoFullName);
      if (!registry.ok) return registry;
      return {
        ok: true,
        workspaceId: registry.corpus.workspaceId,
        repoFullName: registry.corpus.repoFullName,
        actorScope: { ...scope, repoFullName: registry.corpus.repoFullName },
      };
    }
    if (scope?.workspaceId) {
      return {
        ok: true,
        workspaceId: scope.workspaceId,
        repoFullName,
        actorScope: scope,
      };
    }
    return { ok: false, error: 'repo_full_name_required', status: 400 };
  }

  if (!machineProofHasCapability(scope.machineProof, 'retrieval.read')) {
    return { ok: false, error: 'machine_capability_required', capability: 'retrieval.read', status: 403 };
  }
  const registry = await resolveActiveCorpusForRepo(env, repoFullName);
  if (!registry.ok) return registry;
  return {
    ok: true,
    workspaceId: registry.corpus.workspaceId,
    repoFullName: registry.corpus.repoFullName,
    actorScope: {
      authType: 'service',
      principalId: scope.machineProof.principalId,
      repoFullName: registry.corpus.repoFullName,
    },
  };
}

export async function handleRetrievalHttpRequest(request, env, scope, services = null) {
  const url = new URL(request.url);
  const isQuery = url.pathname === '/api/agent/retrieval/query';
  const isEval = url.pathname === '/api/agent/retrieval/eval';
  if (!isQuery && !isEval) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_json' }, 400);

  if (isEval) {
    if (!isMachineScope(scope)) return json({ ok: false, error: 'machine_principal_required' }, 401);
    if (!machineProofHasCapability(scope.machineProof, 'retrieval.evaluate')) {
      return json({ ok: false, error: 'machine_capability_required', capability: 'retrieval.evaluate' }, 403);
    }
    const result = await runRetrievalEvaluation(env, {
      all: body.all === true,
      repoFullName: trim(body.repoFullName || body.repo_full_name || body.repo),
      queries: Array.isArray(body.queries)
        ? body.queries
        : trim(body.query)
          ? [trim(body.query)]
          : [],
      runId: trim(body.runId || body.run_id) || null,
      principalId: scope.machineProof.principalId,
      candidateK: body.candidateK ?? body.candidate_k,
      topK: body.topK ?? body.top_k,
      tokenBudget: body.tokenBudget ?? body.token_budget,
      forceRerank: body.forceRerank === true || body.force_rerank === true,
    });
    return json(result, result.ok ? 200 : Number(result.status) || 500);
  }

  const query = trim(body.query);
  if (!query) return json({ ok: false, error: 'retrieval_query_required' }, 400);
  const requestedRepo = trim(body.repoFullName || body.repo_full_name || body.repo);
  const resolved = await resolveRetrievalScope(env, scope, requestedRepo);
  if (!resolved.ok) return json(resolved, Number(resolved.status) || 500);
  const runtimeServices = services || createRetrievalRuntimeServices(env, resolved.actorScope);

  const result = await retrieveKnowledge(env, {
    query,
    workspaceId: resolved.workspaceId,
    repoFullName: resolved.repoFullName,
    sourceType: trim(body.sourceType || body.source_type) || 'code',
    taskType: trim(body.taskType || body.task_type) || 'knowledge_retrieval',
    runId: trim(body.runId || body.run_id) || null,
    decisionId: trim(body.decisionId || body.decision_id) || null,
    candidateK: body.candidateK ?? body.candidate_k,
    topK: body.topK ?? body.top_k,
    tokenBudget: body.tokenBudget ?? body.token_budget,
    nodeTypes: Array.isArray(body.nodeTypes || body.node_types) ? (body.nodeTypes || body.node_types) : [],
    edgeTypes: Array.isArray(body.edgeTypes || body.edge_types) ? (body.edgeTypes || body.edge_types) : [],
    forceRerank: body.forceRerank === true || body.force_rerank === true,
  }, runtimeServices);

  return json(result, result.ok ? 200 : Number(result.status) || 500);
}
