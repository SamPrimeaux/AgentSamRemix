import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/repo-root.mjs';

export function deployCmd(argv) {
  const r = spawnSync(join(ROOT, 'scripts/agentsam-remix'), ['deploy', ...argv], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
