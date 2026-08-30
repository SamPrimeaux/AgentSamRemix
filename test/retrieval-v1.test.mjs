import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion } from '../backend/rag/retrieval/fusion.js';
import { selectDiverseCandidates } from '../backend/rag/retrieval/diversity.js';
import { packEvidence } from '../backend/rag/retrieval/budget.js';
import { rankingEntropy, scoreMargin } from '../backend/rag/retrieval/math.js';
import { analyzeRetrievalQuery } from '../backend/rag/retrieval/policy.js';
import { searchDenseAnn } from '../backend/rag/retrieval/dense.js';
import { createDenseSearchService } from '../backend/rag/retrieval/dense-service.js';
import { recordRetrievalObservation } from '../backend/rag/retrieval/observations.js';
import { recallAtK, precisionAtK, meanReciprocalRank, ndcgAtK } from '../backend/rag/retrieval/evaluate.js';

test('RRF rewards evidence returned by multiple retrievers', () => {
  const fused = reciprocalRankFusion([
    { name: 'ast', hits: [{ id: 'a', sourceId: 'shared', text: 'alpha', score: 1 }, { id: 'b', sourceId: 'ast-only', text: 'beta', score: 0.9 }] },
    { name: 'dense', hits: [{ id: 'c', sourceId: 'shared', text: 'alpha dense', score: 0.8 }, { id: 'd', sourceId: 'dense-only', text: 'delta', score: 0.7 }] },
  ]);
  assert.equal(fused[0].canonicalId, 'shared');
  assert.deepEqual(Object.keys(fused[0].ranks).sort(), ['ast', 'dense']);
});

test('MMR reduces near-duplicate evidence', () => {
  const candidates = [
    { id: 'a', score: 1, text: 'resolve auth workspace session terminal' },
    { id: 'b', score: 0.99, text: 'resolve auth workspace session terminal handler' },
    { id: 'c', score: 0.82, text: 'execute command via remote pty lane' },
  ];
  const selected = selectDiverseCandidates(candidates, { limit: 2, lambda: 0.65 });
  assert.equal(selected.length, 2);
  assert.equal(selected[0].id, 'a');
  assert.equal(selected[1].id, 'c');
});

test('token packer never exceeds hard budget', () => {
  const packed = packEvidence([
    { id: 'a', score: 1, text: 'a', tokenCount: 80 },
    { id: 'b', score: 0.9, text: 'b', tokenCount: 80 },
    { id: 'c', score: 0.8, text: 'c', tokenCount: 80 },
  ], { tokenBudget: 160, maxItems: 10 });
  assert.ok(packed.selectedTokens <= 160);
  assert.equal(packed.selected.length, 2);
});

test('score margin and entropy separate confident from ambiguous rankings', () => {
  const confident = [{ score: 0.95 }, { score: 0.2 }, { score: 0.1 }];
  const ambiguous = [{ score: 0.81 }, { score: 0.8 }, { score: 0.79 }];
  assert.ok(scoreMargin(confident) > scoreMargin(ambiguous));
  assert.ok(rankingEntropy(confident).normalized < rankingEntropy(ambiguous).normalized);
});

test('query policy spends less on exact symbol lookups than architecture questions', () => {
  const symbol = analyzeRetrievalQuery('resolveProviderCredential');
  const architecture = analyzeRetrievalQuery('how does identity authorization flow through terminal execution across the worker and runtime?');
  assert.equal(symbol.symbolLike, true);
  assert.ok(symbol.candidateK < architecture.candidateK);
  assert.ok(symbol.tokenBudget < architecture.tokenBudget);
});

test('dense adapter fails closed on mixed embedding spaces', async () => {
  const result = await searchDenseAnn({
    query: 'test',
    scope: { workspaceId: 'ws_1' },
    services: {
      denseSearch: async () => ({
        embeddingSpaceKey: 'workers_ai:model:768:mean:v1',
        hits: [{ id: 'x', text: 'x', score: 0.8, embeddingSpaceKey: 'openai:model:768:none:v1' }],
      }),
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /embedding_space_mismatch/);
});

test('dense search service enforces route dimensions before vector search', async () => {
  let searched = false;
  const denseSearch = createDenseSearchService({
    resolveRoute: async () => ({
      routeKey: 'code:v1',
      provider: 'workers_ai',
      model: 'bge',
      dimensions: 3,
      embeddingSpaceKey: 'workers_ai:bge:3:mean:v1',
    }),
    embed: async () => ({
      vector: [0.1, 0.2],
      embeddingSpaceKey: 'workers_ai:bge:3:mean:v1',
    }),
    vectorRepository: {
      search: async () => { searched = true; return { hits: [] }; },
    },
  });
  await assert.rejects(() => denseSearch({ query: 'x', scope: { sourceType: 'code' }, topK: 5 }), /embedding_dimensions_mismatch/);
  assert.equal(searched, false);
});

test('offline relevance metrics are deterministic', () => {
  const results = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const relevant = new Set(['b', 'c']);
  assert.equal(recallAtK(results, relevant, 2), 0.5);
  assert.equal(precisionAtK(results, relevant, 2), 0.5);
  assert.equal(meanReciprocalRank(results, relevant), 0.5);
  assert.ok(ndcgAtK(results, relevant, 3) > 0 && ndcgAtK(results, relevant, 3) <= 1);
});

test('retrieval observations persist corpus decisions without identity dimensions', async () => {
  const captured = {};
  const env = {
    DB: {
      prepare(sql) {
        captured.sql = sql;
        return {
          bind(...values) {
            captured.values = values;
            return { run: async () => ({ success: true }) };
          },
        };
      },
    },
  };

  const result = await recordRetrievalObservation(env, {
    query: 'where is retrieval routed?',
    workspaceId: 'ws_should_not_persist',
    tenantId: 'tenant_should_not_persist',
    userId: 'user_should_not_persist',
    runId: 'run_1',
    decisionId: 'rdec_1',
    taskType: 'codebase_retrieval',
    corpusType: 'code_index',
    corpusKey: 'SamPrimeaux/AgentSamRemix@cidxgen_1',
    repoFullName: 'SamPrimeaux/AgentSamRemix',
    indexGenerationKey: 'cidxgen_1',
    revisionSha: 'a'.repeat(40),
    policyVersion: 'retrieval-v1.1',
    denseRouteKey: 'code:v1',
    embeddingSpaceKey: 'openai:text-embedding-3-large:1536:none:v1',
    metrics: {
      annK: 24,
      denseCandidates: 20,
      lexicalCandidates: 12,
      astCandidates: 14,
      graphCandidates: 4,
      fusedCandidates: 28,
      selectedChunks: 8,
      selectedTokens: 1800,
      totalRetrievalMs: 42,
      stages: { rerankMs: 0, packingMs: 2 },
      fusionScoreMargin: 0.18,
      fusionScoreEntropy: 0.54,
      redundantTokenRatio: 0.1,
      budgetUtilization: 0.45,
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(result.decisionId, 'rdec_1');
  assert.match(captured.sql, /decision_id/);
  assert.match(captured.sql, /corpus_key/);
  assert.doesNotMatch(captured.sql, /workspace_id|tenant_id|user_id/);
  assert.ok(captured.values.includes('SamPrimeaux/AgentSamRemix@cidxgen_1'));
  assert.ok(!captured.values.includes('ws_should_not_persist'));
  assert.ok(!captured.values.includes('tenant_should_not_persist'));
  assert.ok(!captured.values.includes('user_should_not_persist'));
});

test('retrieval observation v2 schema has no identity learning columns', async () => {
  const migration = await fs.readFile(new URL('../migrations/1323_retrieval_observations_v2.sql', import.meta.url), 'utf8');
  const createTable = migration.slice(
    migration.indexOf('CREATE TABLE agentsam_retrieval_observations_v2'),
    migration.indexOf('INSERT OR IGNORE INTO agentsam_retrieval_observations_v2'),
  );
  assert.match(createTable, /decision_id TEXT NOT NULL/);
  assert.match(createTable, /corpus_key TEXT NOT NULL/);
  assert.doesNotMatch(createTable, /workspace_id|tenant_id|user_id/);
});
