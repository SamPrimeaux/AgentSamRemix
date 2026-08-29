import { analyzeRetrievalQuery } from './policy.js';
import { resolveActiveCodeScopes } from './code-index-scope.js';
import { searchStructuralAst } from './structural.js';
import { searchLexicalAst } from './lexical.js';
import { searchDenseAnn } from './dense.js';
import { reciprocalRankFusion } from './fusion.js';
import { selectDiverseCandidates, redundantTokenRatio } from './diversity.js';
import { maybeRerank } from './rerank.js';
import { packEvidence } from './budget.js';
import { rankingEntropy, scoreMargin } from './math.js';
import { recordRetrievalObservation } from './observations.js';

export const RETRIEVAL_POLICY_VERSION = 'retrieval-v1.0';
const RERANK_ENTROPY_THRESHOLD = 0.72;

async function timed(fn) {
  const started = performance.now();
  try {
    return { value: await fn(), ms: performance.now() - started };
  } catch (error) {
    return { error, ms: performance.now() - started };
  }
}

function cleanScope(params) {
  return {
    workspaceId: String(params?.workspaceId || '').trim(),
    tenantId: params?.tenantId ? String(params.tenantId).trim() : null,
    userId: params?.userId ? String(params.userId).trim() : null,
    repoFullName: params?.repoFullName ? String(params.repoFullName).trim() : '',
    sourceType: params?.sourceType ? String(params.sourceType).trim() : 'code',
  };
}

function citationFor(row) {
  return {
    id: String(row?.canonicalId || row?.sourceId || row?.id || ''),
    sourceId: row?.sourceId || null,
    sourceType: row?.sourceType || null,
    repoFullName: row?.repoFullName || null,
    revisionSha: row?.revisionSha || null,
    filePath: row?.filePath || null,
    symbolName: row?.symbolName || null,
    nodeType: row?.nodeType || null,
    lineStart: row?.lineStart || null,
    lineEnd: row?.lineEnd || null,
    score: Number(row?.score) || 0,
    embeddingSpaceKey: row?.embeddingSpaceKey || null,
    provenance: Array.isArray(row?.provenance) ? row.provenance : [],
  };
}

function groundingBlock(selected) {
  if (!selected.length) return '';
  const parts = ['--- [UNTRUSTED RETRIEVED EVIDENCE] ---'];
  selected.forEach((row, index) => {
    const where = [row.repoFullName, row.filePath].filter(Boolean).join(':');
    const lines = row.lineStart ? ` lines ${row.lineStart}${row.lineEnd ? `-${row.lineEnd}` : ''}` : '';
    parts.push(`\n[Citation ${index + 1}${where ? ` | ${where}` : ''}${lines} | score ${(Number(row.score) || 0).toFixed(4)}]`);
    parts.push(String(row.text || '').slice(0, 12_000));
  });
  parts.push('\n--- [END UNTRUSTED RETRIEVED EVIDENCE] ---');
  return parts.join('\n');
}

/**
 * Retrieval V1: active AST generations + lexical exactness + injected ANN,
 * fused with RRF, ambiguity-gated reranking, MMR diversity, then hard token
 * packing. No model/provider/vector-index default exists here.
 */
export async function retrieveKnowledge(env, params, services = {}) {
  const totalStarted = performance.now();
  const scope = cleanScope(params);
  if (!scope.workspaceId) {
    return { ok: false, error: 'workspace_scope_required', status: 409 };
  }

  let profile;
  try {
    profile = analyzeRetrievalQuery(params?.query, {
      candidateK: params?.candidateK,
      topK: params?.topK,
      tokenBudget: params?.tokenBudget,
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || error), status: 400 };
  }

  const stages = {};
  const scopeStage = await timed(() => resolveActiveCodeScopes(env, scope));
  stages.scopeMs = scopeStage.ms;
  const codeScopes = scopeStage.value?.ok ? scopeStage.value.scopes : [];

  const structuralPromise = timed(() => searchStructuralAst({
    env,
    workspaceId: scope.workspaceId,
    query: profile.query,
    scopes: codeScopes,
    candidateK: profile.candidateK,
    nodeTypes: params?.nodeTypes,
  }));
  const lexicalPromise = timed(() => searchLexicalAst({
    env,
    workspaceId: scope.workspaceId,
    query: profile.query,
    scopes: codeScopes,
    candidateK: profile.candidateK,
  }));
  const densePromise = timed(() => searchDenseAnn({
    query: profile.query,
    scope: { ...scope, codeScopes },
    candidateK: profile.candidateK,
    services,
  }));

  const [structuralStage, lexicalStage, denseStage] = await Promise.all([
    structuralPromise,
    lexicalPromise,
    densePromise,
  ]);
  stages.astMs = structuralStage.ms;
  stages.lexicalMs = lexicalStage.ms;
  stages.denseMs = denseStage.ms;

  const structural = structuralStage.value || { ok: false, hits: [], error: String(structuralStage.error?.message || structuralStage.error || 'ast_failed') };
  const lexical = lexicalStage.value || { ok: false, hits: [], error: String(lexicalStage.error?.message || lexicalStage.error || 'lexical_failed') };
  const dense = denseStage.value || { ok: false, hits: [], error: String(denseStage.error?.message || denseStage.error || 'dense_failed') };
  const warnings = [scopeStage.value?.ok ? null : scopeStage.value?.error, structural.ok ? null : structural.error, lexical.ok ? null : lexical.error, dense.ok ? null : dense.error].filter(Boolean);

  const availableBackends = [structural, lexical, dense].filter((row) => row.ok);
  if (!availableBackends.length) {
    return {
      ok: false,
      error: 'retrieval_backends_unavailable',
      status: 503,
      warnings,
      metrics: { stages, totalRetrievalMs: performance.now() - totalStarted },
    };
  }

  const fusionStage = await timed(async () => reciprocalRankFusion([
    { name: 'ast', hits: structural.hits || [], weight: 1 },
    { name: 'lexical', hits: lexical.hits || [], weight: 1 },
    { name: 'dense', hits: dense.hits || [], weight: 1 },
  ]).slice(0, Math.min(100, profile.candidateK * 2)));
  stages.fusionMs = fusionStage.ms;
  const fused = fusionStage.value || [];
  const fusionEntropy = rankingEntropy(fused);
  const fusionMargin = scoreMargin(fused);

  const rerankEnabled = typeof services?.rerank === 'function' && Boolean(
    params?.forceRerank ||
    (profile.rerankRecommended && fusionEntropy.normalized >= RERANK_ENTROPY_THRESHOLD),
  );
  const rerankStage = await timed(() => maybeRerank({
    query: profile.query,
    candidates: fused.slice(0, Math.min(40, profile.candidateK)),
    service: services?.rerank,
    enabled: rerankEnabled,
  }));
  stages.rerankMs = rerankStage.ms;
  const rerank = rerankStage.value || { ok: false, applied: false, candidates: fused };
  if (!rerank.ok && rerank.error) warnings.push(rerank.error);

  const diversityStage = await timed(async () => selectDiverseCandidates(
    rerank.candidates || fused,
    { limit: Math.min(48, profile.candidateK), lambda: profile.symbolLike ? 0.84 : 0.74 },
  ));
  stages.diversityMs = diversityStage.ms;
  const diversified = diversityStage.value || [];

  const packingStage = await timed(async () => packEvidence(diversified, {
    tokenBudget: profile.tokenBudget,
    maxItems: profile.topK,
    maxPerSource: profile.symbolLike ? 4 : 3,
  }));
  stages.packingMs = packingStage.ms;
  const packed = packingStage.value || { selected: [], selectedTokens: 0, skippedTokens: 0, tokenBudget: profile.tokenBudget, budgetUtilization: 0 };
  const selected = packed.selected;
  const finalEntropy = rankingEntropy(selected);
  const finalMargin = scoreMargin(selected);

  const metrics = {
    policyVersion: RETRIEVAL_POLICY_VERSION,
    stages,
    totalRetrievalMs: performance.now() - totalStarted,
    astCandidates: structural.hits?.length || 0,
    lexicalCandidates: lexical.hits?.length || 0,
    denseCandidates: dense.hits?.length || 0,
    fusedCandidates: fused.length,
    rerankEligible: Boolean(profile.rerankRecommended),
    rerankApplied: Boolean(rerank.applied),
    rerankedCandidates: rerank.applied ? rerank.candidates.length : 0,
    selectedChunks: selected.length,
    selectedTokens: packed.selectedTokens,
    tokenBudget: packed.tokenBudget,
    budgetUtilization: packed.budgetUtilization,
    redundantTokenRatio: redundantTokenRatio(diversified),
    fusionScoreMargin: fusionMargin,
    fusionScoreEntropy: fusionEntropy.normalized,
    finalScoreMargin: finalMargin,
    finalScoreEntropy: finalEntropy.normalized,
    queryComplexity: profile.complexity,
    identifierDensity: profile.identifierDensity,
  };

  const observation = await recordRetrievalObservation(env, {
    query: profile.query,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId: params?.runId,
    taskType: params?.taskType || 'knowledge_retrieval',
    scopeType: scope.repoFullName ? 'repo' : scope.sourceType || 'workspace',
    scopeId: scope.repoFullName || scope.workspaceId,
    policyVersion: RETRIEVAL_POLICY_VERSION,
    denseRouteKey: dense.routeKey,
    embeddingSpaceKey: dense.embeddingSpaceKey,
    annK: dense.ok ? profile.candidateK : 0,
    metrics,
  });

  return {
    ok: true,
    policyVersion: RETRIEVAL_POLICY_VERSION,
    queryProfile: {
      complexity: profile.complexity,
      identifierDensity: profile.identifierDensity,
      symbolLike: profile.symbolLike,
      candidateK: profile.candidateK,
      topK: profile.topK,
      tokenBudget: profile.tokenBudget,
      rerankRecommended: profile.rerankRecommended,
    },
    scope: {
      workspaceId: scope.workspaceId,
      repoFullName: scope.repoFullName || null,
      activeCodeGenerations: codeScopes.map((row) => ({ repoFullName: row.repoFullName, generationId: row.generationId, revisionSha: row.revisionSha })),
    },
    results: selected,
    citations: selected.map(citationFor),
    grounding: {
      trust: 'untrusted_retrieved_evidence',
      block: groundingBlock(selected),
    },
    metrics,
    warnings,
    observation,
  };
}
