import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROOT } from '../bin/lib/repo-root.mjs';

const sdkPackage = JSON.parse(
  readFileSync(new URL('../node_modules/@inneranimalmedia/agentsam-sdk/package.json', import.meta.url)),
);

test('AgentSamRemix delegates version to the installed SDK CLI', () => {
  const output = execFileSync('bin/agentsam', ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(output, sdkPackage.version);
});

test('AgentSamRemix delegates portable context to the installed SDK CLI', () => {
  const output = execFileSync('bin/agentsam', ['context', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const context = JSON.parse(output);
  assert.equal(context.schemaVersion, 'agentsam-context-v1');
  assert.equal(context.git.repoFullName, 'SamPrimeaux/AgentSamRemix');
  assert.equal('userId' in context.git, false);
  assert.equal('workspaceId' in context.git, false);
});
