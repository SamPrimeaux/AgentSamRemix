import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agentNamePrefixForUser,
  resolveOwnedAgentName,
} from '../backend/browser/agent-name.js';

const UUID_SUFFIX = '550e8400-e29b-41d4-a716-446655440000';

test('agentNamePrefixForUser matches frontend AgentShell naming', () => {
  assert.equal(
    agentNamePrefixForUser('user@example.com'),
    'user-user-example-com',
  );
});

test('resolveOwnedAgentName allows the base user agent', () => {
  assert.equal(
    resolveOwnedAgentName('abc-123', 'user-abc-123'),
    'user-abc-123',
  );
});

test('resolveOwnedAgentName allows UUID conversation agents owned by the user', () => {
  assert.equal(
    resolveOwnedAgentName('abc-123', `user-abc-123-${UUID_SUFFIX}`),
    `user-abc-123-${UUID_SUFFIX}`,
  );
});

test('resolveOwnedAgentName allows the browser fallback conversation suffix', () => {
  assert.equal(
    resolveOwnedAgentName('abc-123', 'user-abc-123-m3abc123-abc1234'),
    'user-abc-123-m3abc123-abc1234',
  );
});

test('resolveOwnedAgentName defaults to the base user agent', () => {
  assert.equal(resolveOwnedAgentName('abc-123', ''), 'user-abc-123');
});

test('resolveOwnedAgentName rejects another user agent', () => {
  assert.throws(
    () => resolveOwnedAgentName('abc-123', `user-other-user-${UUID_SUFFIX}`),
    /browser_agent_scope_forbidden/,
  );
});

test('resolveOwnedAgentName rejects simple prefix collisions', () => {
  assert.throws(
    () => resolveOwnedAgentName('abc', 'user-abc-123'),
    /browser_agent_scope_forbidden/,
  );
});

test('agentNamePrefixForUser applies the same 72 character user-id cap as AgentShell', () => {
  const longUserId = 'a'.repeat(100);
  const prefix = agentNamePrefixForUser(longUserId);
  assert.equal(prefix, `user-${'a'.repeat(72)}`);
});
