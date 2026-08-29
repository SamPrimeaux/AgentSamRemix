import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agentNamePrefixForUser,
  resolveOwnedAgentName,
} from '../app/backend/browser/live-view.js';

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

test('resolveOwnedAgentName allows conversation agents owned by the user', () => {
  assert.equal(
    resolveOwnedAgentName('abc-123', 'user-abc-123-conversation-7'),
    'user-abc-123-conversation-7',
  );
});

test('resolveOwnedAgentName defaults to the base user agent', () => {
  assert.equal(resolveOwnedAgentName('abc-123', ''), 'user-abc-123');
});

test('resolveOwnedAgentName rejects another user agent', () => {
  assert.throws(
    () => resolveOwnedAgentName('abc-123', 'user-other-user-conversation-7'),
    /browser_agent_scope_forbidden/,
  );
});

test('agentNamePrefixForUser applies the same 72 character user-id cap as AgentShell', () => {
  const longUserId = 'a'.repeat(100);
  const prefix = agentNamePrefixForUser(longUserId);
  assert.equal(prefix, `user-${'a'.repeat(72)}`);
});
