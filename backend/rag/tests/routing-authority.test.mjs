import assert from 'node:assert/strict';
import test from 'node:test';

import { embedTextWithSpec } from '../embeddings/provider.js';
import { resolveRagLane } from '../lanes/registry.js';

function mockDb({ arm = null, catalog = null, pgRows = [], vectorize = null } = {}) {
  return {
    prepare(sql) {
      let binds = [];
      const statement = {
        bind(...values) {
          binds = values;
          return statement;
        },
        async first() {
          if (sql.includes('FROM agentsam_routing_arms')) return arm;
          if (sql.includes('FROM agentsam_model_catalog')) return catalog;
          if (sql.includes('FROM vectorize_index_registry')) return vectorize;
          throw new Error(`unexpected first query: ${sql} :: ${JSON.stringify(binds)}`);
        },
        async all() {
          if (sql.includes('FROM agentsam_pgvector_lane_registry')) return { results: pgRows };
          throw new Error(`unexpected all query: ${sql} :: ${JSON.stringify(binds)}`);
        },
      };
      return statement;
    },
  };
}

test('logical lane resolves arm, validates catalog, then selects matching physical lane', async () => {
  const env = {
    DB: mockDb({
      arm: {
        id: 'arm_docs',
        task_type: 'document_index_embed',
        provider: 'openai',
        model_key: 'model-alpha',
        model_catalog_id: 'catalog-alpha',
        priority: 90,
      },
      catalog: { id: 'catalog-alpha', model_key: 'model-alpha', provider: 'openai' },
      pgRows: [
        {
          id: 'newest-wrong-space',
          schema_name: 'agentsam',
          table_name: 'wrong_table',
          purpose: 'documents',
          dimensions: 42,
          embedding_model: 'model-beta',
          metric: 'cosine',
        },
        {
          id: 'matching-space',
          schema_name: 'agentsam',
          table_name: 'right_table',
          purpose: 'documents',
          dimensions: 3,
          embedding_model: 'model-alpha',
          metric: 'cosine',
        },
      ],
    }),
  };

  const lane = await resolveRagLane(env, 'docs');
  assert.equal(lane.routingArmId, 'arm_docs');
  assert.equal(lane.modelCatalogId, 'catalog-alpha');
  assert.equal(lane.modelKey, 'model-alpha');
  assert.equal(lane.tableName, 'right_table');
  assert.equal(lane.dimensions, 3);
});

test('missing routing arm fails closed instead of selecting a fallback model', async () => {
  const env = { DB: mockDb({ pgRows: [] }) };
  await assert.rejects(() => resolveRagLane(env, 'docs'), /routing_arm_missing:document_index_embed/);
});

test('physical lane with a different embedding_model fails closed', async () => {
  const env = {
    DB: mockDb({
      arm: {
        id: 'arm_memory',
        task_type: 'memory_embed',
        provider: 'google',
        model_key: 'model-alpha',
        model_catalog_id: 'catalog-alpha',
        priority: 90,
      },
      catalog: { id: 'catalog-alpha', model_key: 'model-alpha', provider: 'google' },
      pgRows: [
        {
          id: 'wrong-space',
          schema_name: 'agentsam',
          table_name: 'wrong_memory_table',
          purpose: 'memory',
          dimensions: 3,
          embedding_model: 'model-beta',
          metric: 'cosine',
        },
      ],
    }),
  };

  await assert.rejects(() => resolveRagLane(env, 'memory'), /rag_lane_registry_model_missing:memory:model-alpha/);
});

test('provider adapter requires explicit model and dimensions and forwards them unchanged', async () => {
  await assert.rejects(
    () => embedTextWithSpec({ OPENAI_API_KEY: 'test-key' }, 'hello', { provider: 'openai' }),
    /rag_embedding_model_required/,
  );

  let requestBody = null;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
      },
    };
  };

  const result = await embedTextWithSpec(
    { OPENAI_API_KEY: 'test-key' },
    'hello',
    { provider: 'openai', model: 'model-selected-by-routing', dimensions: 3 },
    { fetchImpl },
  );

  assert.equal(requestBody.model, 'model-selected-by-routing');
  assert.equal(requestBody.dimensions, 3);
  assert.equal(result.model, 'model-selected-by-routing');
  assert.equal(result.dimensions, 3);
});
