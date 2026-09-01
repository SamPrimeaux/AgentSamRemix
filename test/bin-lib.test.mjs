import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../bin/lib/repo-root.mjs';
import { normalizeGitRemote, resolveGitContext } from '../bin/lib/git-context.mjs';
import { buildBridgeHeaders, createBridgeClient } from '../bin/lib/bridge-client.mjs';
import { inspectSdkBoundary } from '../bin/lib/sdk-boundary.mjs';

test('normalizeGitRemote handles GitHub HTTPS and SSH remotes', () => {
  assert.deepEqual(normalizeGitRemote('https://github.com/SamPrimeaux/AgentSamRemix.git'), {
    remoteUrl: 'https://github.com/SamPrimeaux/AgentSamRemix.git',
    remoteHost: 'github.com',
    repoFullName: 'SamPrimeaux/AgentSamRemix',
    owner: 'SamPrimeaux',
    repo: 'AgentSamRemix',
  });
  assert.equal(
    normalizeGitRemote('git@github.com:SamPrimeaux/AgentSamRemix.git').repoFullName,
    'SamPrimeaux/AgentSamRemix',
  );
});

test('resolveGitContext derives repository identity from Git, not env identity', () => {
  const context = resolveGitContext({ cwd: ROOT });
  assert.equal(context.repoFullName, 'SamPrimeaux/AgentSamRemix');
  assert.match(context.revisionSha, /^[0-9a-f]{40}$/i);
  assert.equal(typeof context.dirty, 'boolean');
  assert.equal('userId' in context, false);
  assert.equal('workspaceId' in context, false);
});

test('bridge headers authenticate the machine without user/workspace shell identity', () => {
  const headers = buildBridgeHeaders({ env: { AGENTSAM_BRIDGE_KEY: 'test-bridge-key' } });
  assert.equal(headers.Authorization, 'Bearer test-bridge-key');
  assert.equal(headers['X-Bridge-Key'], 'test-bridge-key');
  assert.equal(headers['X-User-Id'], undefined);
  assert.equal(headers['X-Workspace-Id'], undefined);
});

test('bridge client posts JSON through the shared service principal', async () => {
  let captured = null;
  const client = createBridgeClient({
    baseUrl: 'https://example.test',
    key: 'bridge-test',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const result = await client.post('/api/test', { repoFullName: 'SamPrimeaux/AgentSamRemix' });
  assert.equal(result.ok, true);
  assert.equal(captured.url, 'https://example.test/api/test');
  assert.equal(captured.init.headers.Authorization, 'Bearer bridge-test');
  assert.deepEqual(JSON.parse(captured.init.body), { repoFullName: 'SamPrimeaux/AgentSamRemix' });
});

test('portable bin helpers are SDK-backed with no outstanding candidates', () => {
  const report = inspectSdkBoundary();
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.deepEqual(report.candidates, []);
});

test('host CLI forwards SDK-only verbs to the installed agentsam-sdk binary', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['bin/agentsam', 'status', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.schemaVersion, 'string');
});
