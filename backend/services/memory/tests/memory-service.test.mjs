import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryService } from '../memory-service.js';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../constants.js';
import { VectorizeMemoryStore } from '../adapters/vectorize-memory-store.js';

const VECTOR = Object.freeze(
  Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
);

const NOW_MS = Date.parse('2026-08-22T12:00:00.000Z');
const NOW_UNIX = Math.floor(NOW_MS / 1000);

function makeHarness() {
  const rows = new Map();

  const repository = {
    async insert(value) {
      const row = {
        id: value.id,
        workspace_id: value.workspaceId,
        subject_id: value.subjectId,
        agent_id: value.agentId,
        tenant_id: value.tenantId,
        memory_type: value.memoryType,
        content: value.content,
        content_hash: value.contentHash,
        importance: value.importance,
        confidence: value.confidence,
        source_type: value.sourceType,
        source_id: value.sourceId,
        metadata: value.metadata,
        supersedes_id: null,
        superseded_by_id: null,
        is_active: true,
        expires_at_unix: value.expiresAtUnix,
        created_at_unix: NOW_UNIX,
        updated_at_unix: NOW_UNIX,
        embedded_at_unix: NOW_UNIX,
      };
      rows.set(row.id, row);
      return row;
    },

    async getById({ id, workspaceId }) {
      const row = rows.get(id);
      return row?.workspace_id === workspaceId ? row : null;
    },

    async search({ workspaceId, includeExpired = false }) {
      return [...rows.values()]
        .filter((row) => {
          if (row.workspace_id !== workspaceId || row.is_active !== true) return false;
          if (
            !includeExpired &&
            Number.isInteger(row.expires_at_unix) &&
            row.expires_at_unix <= NOW_UNIX
          ) {
            return false;
          }
          return true;
        })
        .map((row) => ({ ...row, semantic_score: 0.9 }));
    },

    async list({ workspaceId, includeInactive = false }) {
      return [...rows.values()].filter((row) => {
        if (row.workspace_id !== workspaceId) return false;
        if (!includeInactive && row.is_active !== true) return false;
        return true;
      });
    },

    async update({ id, workspaceId, patch }) {
      const row = rows.get(id);
      if (!row || row.workspace_id !== workspaceId) return null;
      const mapped = {
        content: 'content',
        contentHash: 'content_hash',
        memoryType: 'memory_type',
        subjectId: 'subject_id',
        agentId: 'agent_id',
        tenantId: 'tenant_id',
        importance: 'importance',
        confidence: 'confidence',
        sourceType: 'source_type',
        sourceId: 'source_id',
        metadata: 'metadata',
        expiresAtUnix: 'expires_at_unix',
        supersedesId: 'supersedes_id',
        supersededById: 'superseded_by_id',
        isActive: 'is_active',
        embeddedAtUnix: 'embedded_at_unix',
      };
      for (const [key, value] of Object.entries(patch)) {
        const target = mapped[key];
        if (target) row[target] = value;
      }
      row.updated_at_unix = NOW_UNIX;
      return row;
    },

    async softDelete({ id, workspaceId }) {
      return this.update({
        id,
        workspaceId,
        patch: { isActive: false },
      });
    },
  };

  const embeddingProvider = {
    documentCalls: 0,
    queryCalls: 0,
    async embedDocument() {
      this.documentCalls += 1;
      return [...VECTOR];
    },
    async embedQuery() {
      this.queryCalls += 1;
      return [...VECTOR];
    },
  };

  let id = 0;
  const service = new MemoryService({
    repository,
    embeddingProvider,
    idFactory: () => `mem_fixture_${++id}`,
    now: () => NOW_MS,
  });

  return { service, embeddingProvider, rows };
}

test('remember embeds and persists canonical memory', async () => {
  const { service, embeddingProvider } = makeHarness();
  const memory = await service.remember({
    workspaceId: 'ws_fixture',
    subjectId: 'user_fixture',
    memoryType: 'preference',
    content: '  User prefers concise answers.  ',
    importance: 0.8,
    confidence: 0.95,
  });

  assert.equal(memory.id, 'mem_fixture_1');
  assert.equal(memory.content, 'User prefers concise answers.');
  assert.equal(memory.memory_type, 'preference');
  assert.equal(memory.importance, 0.8);
  assert.equal(memory.created_at_unix, NOW_UNIX);
  assert.equal(embeddingProvider.documentCalls, 1);
  assert.equal(memory.content_hash.length, 64);
});

test('search embeds query and returns ranked candidates', async () => {
  const { service, embeddingProvider } = makeHarness();
  await service.remember({
    workspaceId: 'ws_fixture',
    content: 'The project uses Cloudflare.',
  });

  const result = await service.search({
    workspaceId: 'ws_fixture',
    query: 'Where is the project hosted?',
    limit: 5,
  });

  assert.equal(embeddingProvider.queryCalls, 1);
  assert.equal(result.length, 1);
  assert.ok(result[0].rank_score > 0);
});

test('forget is scoped by workspace and soft-deletes', async () => {
  const { service } = makeHarness();
  const memory = await service.remember({
    workspaceId: 'ws_fixture',
    content: 'Temporary memory.',
  });

  await service.forget({ id: memory.id, workspaceId: 'ws_fixture' });
  const found = await service.search({
    workspaceId: 'ws_fixture',
    query: 'temporary',
  });
  assert.equal(found.length, 0);
});

test('updating content regenerates its embedding', async () => {
  const { service, embeddingProvider } = makeHarness();
  const memory = await service.remember({
    workspaceId: 'ws_fixture',
    content: 'Old memory.',
  });

  await service.update({
    id: memory.id,
    workspaceId: 'ws_fixture',
    patch: { content: 'New memory.' },
  });

  assert.equal(embeddingProvider.documentCalls, 2);
  const updated = await service.get({
    id: memory.id,
    workspaceId: 'ws_fixture',
  });
  assert.equal(updated.content, 'New memory.');
});

test('supersede preserves lineage and retires old memory', async () => {
  const { service } = makeHarness();
  const old = await service.remember({
    workspaceId: 'ws_fixture',
    content: 'The old preference.',
  });

  const next = await service.supersede({
    id: old.id,
    workspaceId: 'ws_fixture',
    replacement: { content: 'The new preference.' },
  });

  const oldAfter = await service.get({
    id: old.id,
    workspaceId: 'ws_fixture',
  });

  assert.equal(oldAfter.is_active, false);
  assert.equal(oldAfter.superseded_by_id, next.id);
  assert.equal(next.supersedes_id, old.id);
});

test('consolidate retires duplicate content hashes', async () => {
  const { service } = makeHarness();
  const a = await service.remember({
    workspaceId: 'ws_fixture',
    content: 'Same fact.',
    importance: 0.2,
  });
  const b = await service.remember({
    workspaceId: 'ws_fixture',
    content: 'Same fact.',
    importance: 0.9,
  });

  const result = await service.consolidate({ workspaceId: 'ws_fixture' });
  assert.equal(result.retired.length, 1);
  assert.equal(result.retired[0].kept, b.id);
  assert.equal(result.retired[0].forgotten, a.id);

  const leftover = await service.search({
    workspaceId: 'ws_fixture',
    query: 'fact',
  });
  assert.equal(leftover.length, 1);
  assert.equal(leftover[0].id, b.id);
});

test('vectorize adapter refuses to become write SSOT', async () => {
  const store = new VectorizeMemoryStore();
  await assert.rejects(() => store.insert({}), /projection_not_ssot/);
});
