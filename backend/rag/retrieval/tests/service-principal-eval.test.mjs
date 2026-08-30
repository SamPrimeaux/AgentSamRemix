import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  listActiveCorpora,
  resolveActiveCorpusForRepo,
} from '../corpus-registry.js';
import { runRetrievalEvaluation } from '../eval-runner.js';

function dbWith({ allRows = [], latest = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              return { results: allRows };
            },
            async first() {
              return latest;
            },
          };
        },
        async all() {
          return { results: allRows };
        },
      };
    },
  };
}

describe('Retrieval service-principal evaluation', () => {
  it('resolves a logical repo to one active physical partition', async () => {
    const env = { DB: dbWith({ allRows: [{
      id: 'job_1',
      workspace_id: 'ws_physical',
      repo_full_name: 'SamPrimeaux/AgentSamRemix',
      index_generation_id: 'cidxgen_1',
      revision_sha: 'a'.repeat(40),
      status: 'completed',
    }] }) };
    const result = await resolveActiveCorpusForRepo(env, 'SamPrimeaux/AgentSamRemix');
    assert.equal(result.ok, true);
    assert.equal(result.corpus.repoFullName, 'SamPrimeaux/AgentSamRemix');
    assert.equal(result.corpus.workspaceId, 'ws_physical');
  });

  it('enumerates active corpora server-side without caller workspace input', async () => {
    const env = { DB: dbWith({ allRows: [{
      id: 'job_1',
      workspace_id: 'ws_internal',
      repo_full_name: 'SamPrimeaux/AgentSamRemix',
      index_generation_id: 'cidxgen_1',
      revision_sha: null,
      status: 'completed',
    }] }) };
    const result = await listActiveCorpora(env);
    assert.equal(result.ok, true);
    assert.equal(result.corpora[0].workspaceId, 'ws_internal');
  });

  it('runs the shared retrieval service and records corpus-scoped cases', async () => {
    const calls = [];
    const result = await runRetrievalEvaluation({}, {
      repoFullName: 'SamPrimeaux/AgentSamRemix',
      principalId: 'agentsam-platform',
      queries: ['Where is routing composed?'],
    }, {
      resolveActiveCorpusForRepo: async () => ({
        ok: true,
        corpus: {
          repoFullName: 'SamPrimeaux/AgentSamRemix',
          workspaceId: 'ws_internal_only',
          generationId: 'cidxgen_1',
          revisionSha: 'a'.repeat(40),
        },
      }),
      createRetrievalRuntimeServices: (_env, actor) => ({ actor }),
      retrieveKnowledge: async (_env, params, services) => {
        calls.push({ params, services });
        return {
          ok: true,
          policyVersion: 'retrieval-v1.1',
          scope: { corpusKey: 'SamPrimeaux/AgentSamRemix@cidxgen_1' },
          metrics: { selectedChunks: 3, selectedTokens: 900, totalRetrievalMs: 12 },
          warnings: [],
          observation: { recorded: true, id: 'ret_1', decisionId: 'rdec_1' },
          citations: [{ id: 'symbol_1' }],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.principalId, 'agentsam-platform');
    assert.equal(result.results[0].passed, 1);
    assert.equal(calls[0].params.workspaceId, 'ws_internal_only');
    assert.equal(calls[0].params.taskType, 'retrieval_evaluation');
    assert.equal('userId' in calls[0].services.actor, false);
  });
});
