/**
 * Node test for resolveAgentRunTimeoutMs — no D1 floor that bumps 90s → 180s.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentRunTimeoutMs } from './agent-controller-timeouts.js';

describe('resolveAgentRunTimeoutMs', () => {
  it('honors lower D1 profile max_runtime_ms (no 180s floor)', () => {
    const r = resolveAgentRunTimeoutMs({
      max_runtime_ms: 90_000,
      _runtime_policy: { max_runtime_ms: 90_000, agent_run_hard_timeout_ms: 200_000 },
    });
    assert.equal(r.maxRunMs, 90_000);
    assert.equal(r.source, 'profile.max_runtime_ms');
  });

  it('caps at hard timeout - 5s', () => {
    const r = resolveAgentRunTimeoutMs({
      max_runtime_ms: 500_000,
      _runtime_policy: { agent_run_hard_timeout_ms: 200_000 },
    });
    assert.equal(r.maxRunMs, 195_000);
  });

  it('uses default target only when profile missing', () => {
    const r = resolveAgentRunTimeoutMs({ max_runtime_ms: 0, _runtime_policy: {} });
    assert.equal(r.maxRunMs, 180_000);
    assert.equal(r.source, 'default_target');
  });
});
