import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/repo-root.mjs';

export function acpCmd(argv) {
  const [subcommand = 'help', ...rest] = argv;
  if (subcommand === 'serve') {
    const r = spawnSync(process.execPath, [join(ROOT, 'backend/agentsam/acp/serve.mjs'), ...rest], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(r.status ?? 1);
  }
  console.error('usage: bin/agentsam acp serve');
  process.exit(subcommand === 'help' || subcommand === '--help' || subcommand === '-h' ? 0 : 2);
}
