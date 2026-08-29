import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (this file lives at app/backend/agentsam/tools/lib/). */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
