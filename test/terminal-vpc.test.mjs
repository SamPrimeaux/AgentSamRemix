import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('remote VM is a built-in PTY_SERVICE target without a seeded connection row', () => {
  const registry = read('backend/agentsam/terminal/registry.ts');
  const runtime = read('backend/agentsam/terminal/runtime.ts');

  assert.match(registry, /BUILTIN_VPC_CONNECTION_ID = 'builtin:pty-service'/);
  assert.match(registry, /if \(!env\.PTY_SERVICE\?\.fetch\) return null/);
  assert.match(registry, /return explicitId \? null : builtin/);
  assert.match(runtime, /return env\.PTY_SERVICE\?\.fetch \? 'remote' : 'local'/);
});

test('interactive browser PTY upgrades directly through the VPC binding', () => {
  const source = read('backend/agentsam/terminal/interactive.ts');

  assert.match(source, /new URL\('http:\/\/localhost:3099\/terminal'\)/);
  assert.match(source, /env\.PTY_SERVICE\.fetch/);
  assert.match(source, /new WebSocketPair\(\)/);
  assert.match(source, /target_type: 'platform_vm'/);
  assert.match(source, /transport: 'vpc'/);
  assert.doesNotMatch(source, /AGENTSAM_USER_ID|AGENTSAM_WORKSPACE_ID/);
});

test('worker claims terminal browser routes before the generic Agent API dispatcher', () => {
  const worker = read('backend/src/index.ts');
  const configAt = worker.indexOf('url.pathname === "/api/agent/terminal/config-status"');
  const wsAt = worker.indexOf('url.pathname === "/api/agent/terminal/ws"');
  const fallbackAt = worker.indexOf('url.pathname === "/api/agent/terminal/run"');
  const genericAt = worker.indexOf('url.pathname.startsWith("/api/agent/")');

  assert.ok(configAt > 0, 'config-status route missing');
  assert.ok(wsAt > 0, 'terminal websocket route missing');
  assert.ok(fallbackAt > 0, 'terminal command fallback missing');
  assert.ok(genericAt > 0, 'generic Agent API route missing');
  assert.ok(configAt < genericAt, 'config-status must be claimed before generic Agent routes');
  assert.ok(wsAt < genericAt, 'websocket must be claimed before generic Agent routes');
  assert.ok(fallbackAt < genericAt, 'fallback run route must be claimed before generic Agent routes');
});

test('remote one-shot execution prefers direct VPC instead of adding an ExecOS hop', () => {
  const source = read('backend/agentsam/terminal/execos.ts');
  const vpcFirst = source.indexOf("if (input.lane === 'remote' && env.PTY_SERVICE?.fetch)");
  const execosCall = source.indexOf("const result = await callExecOS(env, '/run'");
  assert.ok(vpcFirst > 0 && execosCall > vpcFirst);
});

test('new Remix workspace terminal preferences start on platform_vm', () => {
  const source = read('app/src/lib/terminalWorkspacePrefs.ts');
  assert.match(source, /return \{ targetType: 'platform_vm', splashDismissed: true \}/);
  assert.match(source, /explicit saved Local\/Sandbox choice is still preserved/);
});
