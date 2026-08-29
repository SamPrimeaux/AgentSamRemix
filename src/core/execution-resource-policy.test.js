import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyExecutionResource,
  evaluateRemoteVmAdmission,
  shouldRemapRemoteToSandbox,
} from './execution-resource-policy.js';

test('classifies builds and dependency installs as heavy', () => {
  for (const command of ['npm run build', 'npm ci', 'vite build', 'npx playwright test', 'docker build .']) {
    assert.equal(classifyExecutionResource(command).resource_class, 'heavy', command);
  }
});

test('classifies git inspection as VM-safe control-plane work', () => {
  const decision = classifyExecutionResource('git status --short --branch');
  assert.equal(decision.vm_safe, true);
  assert.equal(decision.sandbox_preferred, false);
});

test('remote operator heavy work remaps to sandbox', () => {
  assert.equal(shouldRemapRemoteToSandbox('agentsam_terminal_remote', 'remote', true, 'npm run build'), true);
  assert.equal(shouldRemapRemoteToSandbox('agentsam_terminal_remote', 'auto', true, 'npm run build'), true);
  assert.equal(shouldRemapRemoteToSandbox('agentsam_terminal_remote', 'local', true, 'npm run build'), false);
});

test('small VM admission denies known-heavy work unless trusted override is explicit', () => {
  assert.equal(evaluateRemoteVmAdmission('npm ci').allowed, false);
  assert.equal(evaluateRemoteVmAdmission('npm ci', { allowHeavyRemote: true }).allowed, true);
});
