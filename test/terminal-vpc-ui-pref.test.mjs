import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('new Remix workspaces select platform_vm without local setup', () => {
  const source = fs.readFileSync(
    path.join(root, 'app/src/lib/terminalWorkspacePrefs.ts'),
    'utf8',
  );
  assert.match(source, /return \{ targetType: 'platform_vm', splashDismissed: true \}/);
  assert.match(source, /explicit saved Local\/Sandbox choice is still preserved/);
});
