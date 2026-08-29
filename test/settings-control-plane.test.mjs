import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IGNORE_POLICY_EMPTY,
  applyRepoIgnorePolicy,
  matchIgnoreGlob,
  normalizeIgnorePolicyRepo,
} from '../app/backend/agentsam/codebase/ignore-policy.js';
import { normalizeApiKeySecret } from '../app/backend/credentials/provider-validation.js';

test('index-rule glob semantics match production policy', () => {
  assert.equal(matchIgnoreGlob('src/core/a.js', 'src/**'), true);
  assert.equal(matchIgnoreGlob('src/core/a.js', '*.js'), true);
  assert.equal(matchIgnoreGlob('node_modules/pkg/a.js', 'node_modules/'), true);
  assert.equal(matchIgnoreGlob('src/core/a.ts', 'src/*.js'), false);
});

test('allow scope is enforced before deny rules', () => {
  const policy = { allow: ['app/**', 'backend/**'], deny: ['**/node_modules/**', 'app/generated/**'] };
  assert.deepEqual(applyRepoIgnorePolicy(policy, 'docs/readme.md'), {
    ignored: true,
    reason: 'repo_allowlist_miss',
  });
  assert.deepEqual(applyRepoIgnorePolicy(policy, 'app/generated/foo.js'), {
    ignored: true,
    reason: 'repo_deny:app/generated/**',
  });
  assert.deepEqual(applyRepoIgnorePolicy(policy, 'backend/http/index.js'), {
    ignored: false,
    reason: null,
  });
});

test('unsafe empty path fails closed', () => {
  assert.deepEqual(applyRepoIgnorePolicy({ allow: [], deny: [] }, ''), {
    ignored: true,
    reason: 'unsafe_path',
  });
});

test('repo identity is constrained to owner/name', () => {
  assert.equal(normalizeIgnorePolicyRepo('SamPrimeaux/AgentSamRemix'), 'SamPrimeaux/AgentSamRemix');
  assert.equal(normalizeIgnorePolicyRepo('../etc/passwd'), '');
  assert.equal(normalizeIgnorePolicyRepo('owner/repo/extra'), '');
});

test('API key normalization removes paste artifacts without changing content', () => {
  assert.equal(normalizeApiKeySecret('  Bearer abc-123\n'), 'abc-123');
  assert.equal(normalizeApiKeySecret('\u200Babc 123\uFEFF'), 'abc123');
});

test('empty-policy error code remains explicit', () => {
  assert.equal(typeof IGNORE_POLICY_EMPTY, 'string');
  assert.ok(IGNORE_POLICY_EMPTY.length > 0);
});
