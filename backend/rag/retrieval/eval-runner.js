import { retrieveKnowledge } from './retrieve.js';
import { createRetrievalRuntimeServices } from './runtime-services.js';
import { listActiveCorpora, resolveActiveCorpusForRepo } from './corpus-registry.js';

export const DEFAULT_RETRIEVAL_EVAL_QUERIES = Object.freeze([
  'Where is the main application entry point and how is request routing composed?',
  'How is authentication and authorization enforced for server-side requests?',
  'Where are production tests and deployment commands defined?',
]);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function runId() {
  return `reteval_${crypto.randomUUID().replace(/-/g, '')}`;
}

function summarize(result, query) {
  return {
    ok: result?.ok === true,
    query,
    error: result?.error || null,
    policyVersion: result?.policyVersion || null,
    corpusKey: result?.scope?.corpusKey || null,
    selectedChunks: Number(result?.metrics?.selectedChunks) || 0,
    selectedTokens: Number(result?.metrics?.selectedTokens) || 0,
    totalRetrievalMs: Number(result?.metrics?.totalRetrievalMs) || 0,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    observation: result?.observation || null,
    citations: Array.isArray(result?.citations) ? result.citations.slice(0, 8) : [],
  };
}

/**
 * Evaluate one registered corpus or every active corpus. This composes the same
 * retrieveKnowledge service used by human requests; it does not implement a
 * second retrieval pipeline.
 */
export async function runRetrievalEvaluation(env, params = {}, dependencies = {}) {
  const all = params.all === true;
  const repoFullName = trim(params.repoFullName);
  if (all && repoFullName) return { ok: false, error: 'repo_and_all_are_mutually_exclusive', status: 400 };
  if (!all && !repoFullName) return { ok: false, error: 'repo_full_name_required', status: 400 };

  const registry = all
    ? await (dependencies.listActiveCorpora || listActiveCorpora)(env)
    : await (dependencies.resolveActiveCorpusForRepo || resolveActiveCorpusForRepo)(env, repoFullName);
  if (!registry?.ok) return registry;

  const corpora = all ? registry.corpora : [registry.corpus];
  const explicitQueries = Array.isArray(params.queries)
    ? params.queries.map(trim).filter(Boolean)
    : [];
  const queries = explicitQueries.length ? explicitQueries.slice(0, 20) : [...DEFAULT_RETRIEVAL_EVAL_QUERIES];
  const evaluationRunId = trim(params.runId) || runId();
  const retrieve = dependencies.retrieveKnowledge || retrieveKnowledge;
  const createServices = dependencies.createRetrievalRuntimeServices || createRetrievalRuntimeServices;
  const results = [];

  for (const corpus of corpora) {
    const services = createServices(env, {
      authType: 'service',
      principalId: params.principalId || 'agentsam-platform',
      repoFullName: corpus.repoFullName,
    });
    const cases = [];
    for (const query of queries) {
      const result = await retrieve(env, {
        query,
        workspaceId: corpus.workspaceId,
        repoFullName: corpus.repoFullName,
        taskType: 'retrieval_evaluation',
        runId: evaluationRunId,
        candidateK: params.candidateK,
        topK: params.topK,
        tokenBudget: params.tokenBudget,
        forceRerank: params.forceRerank === true,
      }, services);
      cases.push(summarize(result, query));
    }
    results.push({
      repoFullName: corpus.repoFullName,
      generationId: corpus.generationId,
      revisionSha: corpus.revisionSha,
      cases,
      passed: cases.filter((row) => row.ok).length,
      failed: cases.filter((row) => !row.ok).length,
    });
  }

  const totalCases = results.reduce((sum, row) => sum + row.cases.length, 0);
  const passed = results.reduce((sum, row) => sum + row.passed, 0);
  return {
    ok: passed === totalCases,
    status: passed === totalCases ? 200 : 502,
    runId: evaluationRunId,
    principalId: params.principalId || 'agentsam-platform',
    corpusCount: results.length,
    totalCases,
    passed,
    failed: totalCases - passed,
    results,
  };
}
