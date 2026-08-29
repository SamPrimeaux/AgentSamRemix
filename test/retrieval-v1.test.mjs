import test from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion } from '../backend/knowledge/retrieval/fusion.js';
import { selectDiverseCandidates } from '../backend/knowledge/retrieval/diversity.js';
import { packEvidence } from '../backend/knowledge/retrieval/budget.js';
import { rankingEntropy, scoreMargin } from '../backend/knowledge/retrieval/math.js';
import { analyzeRetrievalQuery } from '../backend/knowledge/retrieval/policy.js';
import { searchDenseAnn } from '../backend/knowledge/retrieval/dense.js';
import { createDenseSearchService } from '../backend/knowledge/retrieval/dense-service.js';
import { recallAtK, precisionAtK, meanReciprocalRank, ndcgAtK } from '../backend/knowledge/retrieval/evaluate.js';

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
