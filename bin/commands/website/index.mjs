import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/repo-root.mjs';

export function websiteCmd(argv) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin/website-assets.mjs'), ...argv], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
