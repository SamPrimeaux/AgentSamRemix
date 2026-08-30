import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  machineProofHasCapability,
  resolveDelegatedMachineUser,
  resolveMachineProof,
} from '../bridge-key-auth.js';

describe('Agent Sam bridge service principal', () => {
  it('authenticates without user, workspace, tenant, or cookie identity', () => {
    const request = new Request('https://example.test/api/agent/retrieval/eval', {
      headers: { 'X-Bridge-Key': 'bridge-secret' },
    });
    const proof = resolveMachineProof(request, { AGENTSAM_BRIDGE_KEY: 'bridge-secret' });

    assert.deepEqual(proof, {
      type: 'bridge',
      principalId: 'agentsam-platform',
      principalType: 'service',
      capabilities: ['retrieval.read', 'retrieval.evaluate'],
      delegatedUserId: null,
    });
    assert.equal(machineProofHasCapability(proof, 'retrieval.read'), true);
    assert.equal(machineProofHasCapability(proof, 'retrieval.evaluate'), true);
    assert.equal(machineProofHasCapability(proof, 'workspace.admin'), false);
  });

  it('keeps legacy delegation optional and separate from machine proof', () => {
    const request = new Request('https://example.test', {
      headers: {
        Authorization: 'Bearer bridge-secret',
        'X-User-Id': 'au_valid123',
      },
    });
    const proof = resolveMachineProof(request, { AGENTSAM_BRIDGE_KEY: 'bridge-secret' });
    assert.equal(proof.principalId, 'agentsam-platform');
    assert.equal(proof.delegatedUserId, 'au_valid123');
  });
});
