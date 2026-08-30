import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseRetrievalEvalArgs,
  repoFullNameFromRemote,
  runRetrievalEval,
} from '../index.mjs';

describe('bin/agentsam eval retrieval', () => {
  it('normalizes common git remote spellings', () => {
    assert.equal(
      repoFullNameFromRemote('https://github.com/SamPrimeaux/AgentSamRemix.git'),
      'SamPrimeaux/AgentSamRemix',
    );
    assert.equal(
      repoFullNameFromRemote('git@github.com:SamPrimeaux/AgentSamRemix.git'),
      'SamPrimeaux/AgentSamRemix',
    );
  });

  it('infers the repo and never introduces user/workspace flags', () => {
    const parsed = parseRetrievalEvalArgs([], {
      inferRepoFullName: () => 'SamPrimeaux/AgentSamRemix',
    });
    assert.deepEqual(parsed, {
      repoFullName: 'SamPrimeaux/AgentSamRemix',
      all: false,
      queries: [],
      json: false,
    });
    assert.throws(() => parseRetrievalEvalArgs(['--user', 'au_1']), /unknown/);
    assert.throws(() => parseRetrievalEvalArgs(['--workspace', 'ws_1']), /unknown/);
  });

  it('sends only the logical corpus selector through bridge auth client', async () => {
    const calls = [];
    const output = [];
    await runRetrievalEval(['--repo', 'SamPrimeaux/AgentSamRemix'], {
      client: {
        async post(path, body) {
          calls.push({ path, body });
          return {
            ok: true,
            runId: 'reteval_1',
            corpusCount: 1,
            totalCases: 1,
            passed: 1,
            results: [],
          };
        },
      },
      write: (line) => output.push(line),
    });
    assert.deepEqual(calls, [{
      path: '/api/agent/retrieval/eval',
      body: { repoFullName: 'SamPrimeaux/AgentSamRemix' },
    }]);
    assert.equal(JSON.stringify(calls).includes('workspace'), false);
    assert.equal(JSON.stringify(calls).includes('userId'), false);
    assert.match(output[0], /passed/);
  });
});
