/**
 * Canonical Wrangler commands for Cmd+K / agentsam_commands (platform scope).
 * Keep in sync with migrations/319_seed_wrangler_cmdk_commands.sql
 */

export type WranglerCommandCategory =
  | 'auth'
  | 'r2'
  | 'd1'
  | 'vectorize'
  | 'hyperdrive'
  | 'kv'
  | 'queues'
  | 'worker'
  | 'workflows';

export type WranglerCatalogEntry = {
  id: string;
  slug: string;
  display_name: string;
  category: WranglerCommandCategory;
  mapped_command: string;
  description?: string;
  risk_level?: 'low' | 'medium' | 'high';
  requires_confirmation?: boolean;
  sort_order?: number;
};

const destructive = /\b(delete|rollback|terminate|remove)\b/i;
const write = /\b(create|put|apply|deploy|update|insert|trigger|export)\b/i;

function riskFor(cmd: string): 'low' | 'medium' | 'high' {
  if (destructive.test(cmd)) return 'high';
  if (write.test(cmd)) return 'medium';
  return 'low';
}

function entry(
  category: WranglerCommandCategory,
  slug: string,
  display_name: string,
  mapped_command: string,
  sort_order: number,
  description?: string,
): WranglerCatalogEntry {
  const risk_level = riskFor(mapped_command);
  return {
    id: `cmd_wr_${slug.replace(/\//g, '_')}`,
    slug: `/wr/${slug}`,
    display_name,
    category,
    mapped_command,
    description,
    risk_level,
    requires_confirmation: risk_level !== 'low',
    sort_order,
  };
}

/** User-facing section labels (Cmd+K grouping). */
export const WRANGLER_CATEGORY_LABELS: Record<WranglerCommandCategory, string> = {
  auth: 'Auth & setup',
  r2: 'R2',
  d1: 'D1',
  vectorize: 'Vectorize',
  hyperdrive: 'Hyperdrive',
  kv: 'KV',
  queues: 'Queues',
  worker: 'Workers',
  workflows: 'Workflows',
};

export const WRANGLER_COMMAND_CATALOG: WranglerCatalogEntry[] = [
  // Auth & general (Cloudflare wrangler commands — Apr 2026)
  entry(
    'auth',
    'auth-docs',
    'Open Wrangler docs',
    'npx wrangler docs [SEARCH]',
    1,
    'Search Cloudflare docs from the CLI.',
  ),
  entry('auth', 'auth-whoami', 'Whoami', 'wrangler whoami', 2, 'Verify auth. Add --json for scripts.'),
  entry(
    'auth',
    'auth-token-json',
    'Auth token (JSON)',
    'wrangler auth token --json',
    3,
    'Headless / CI — sandbox uses injected CLOUDFLARE_API_TOKEN.',
  ),
  entry(
    'auth',
    'auth-login-local',
    'Login (local Mac)',
    'wrangler login',
    4,
    'OAuth in browser. Local PTY only — not CF container sandbox.',
  ),
  entry(
    'auth',
    'auth-login-container',
    'Login (container)',
    'wrangler login --callback-host=0.0.0.0 --callback-port=8976',
    5,
    'Requires port 8976 published. Prefer API token in Agent Sam sandbox.',
  ),
  entry('auth', 'auth-logout', 'Logout OAuth', 'wrangler logout', 6, 'Local OAuth only — invalidates wrangler login token.'),
  entry('auth', 'auth-telemetry-disable', 'Disable telemetry', 'wrangler telemetry disable', 7),
  entry('auth', 'auth-telemetry-status', 'Telemetry status', 'wrangler telemetry status', 8),
  entry('auth', 'auth-complete-zsh', 'Shell completions (zsh)', 'wrangler complete zsh >> ~/.zshrc', 9),

  // R2
  entry('r2', 'r2-bucket-create', 'R2 bucket create', 'wrangler r2 bucket create <NAME>', 10),
  entry('r2', 'r2-bucket-list', 'R2 bucket list', 'wrangler r2 bucket list', 11),
  entry('r2', 'r2-bucket-delete', 'R2 bucket delete', 'wrangler r2 bucket delete <NAME>', 12),
  entry('r2', 'r2-bucket-info', 'R2 bucket info', 'wrangler r2 bucket info <NAME>', 13),
  entry('r2', 'r2-object-get', 'R2 object get', 'wrangler r2 object get <BUCKET>/<KEY> --file=<OUTPUT>', 14),
  entry('r2', 'r2-object-put', 'R2 object put', 'wrangler r2 object put <BUCKET>/<KEY> --file=<INPUT>', 15),
  entry('r2', 'r2-object-delete', 'R2 object delete', 'wrangler r2 object delete <BUCKET>/<KEY>', 16),
  entry('r2', 'r2-object-list', 'R2 object list', 'wrangler r2 object list <BUCKET> --prefix=<PREFIX>', 17),

  // D1
  entry('d1', 'd1-create', 'D1 create', 'wrangler d1 create <NAME>', 20),
  entry('d1', 'd1-list', 'D1 list', 'wrangler d1 list', 21),
  entry('d1', 'd1-info', 'D1 info', 'wrangler d1 info <NAME>', 22),
  entry('d1', 'd1-delete', 'D1 delete', 'wrangler d1 delete <NAME>', 23),
  entry('d1', 'd1-execute-cmd', 'D1 execute (SQL)', 'wrangler d1 execute <NAME> --command="<SQL>" --remote', 24),
  entry('d1', 'd1-execute-file', 'D1 execute (file)', 'wrangler d1 execute <NAME> --file=<FILE> --remote', 25),
  entry('d1', 'd1-export', 'D1 export backup', 'wrangler d1 export <NAME> --remote --output=backup.sql', 26),
  entry('d1', 'd1-export-schema', 'D1 export schema', 'wrangler d1 export <NAME> --remote --output=schema.sql --no-data', 27),
  entry('d1', 'd1-migrations-create', 'D1 migrations create', 'wrangler d1 migrations create <NAME> <MIGRATION_NAME>', 28),
  entry('d1', 'd1-migrations-list', 'D1 migrations list', 'wrangler d1 migrations list <NAME> --remote', 29),
  entry('d1', 'd1-migrations-apply', 'D1 migrations apply', 'wrangler d1 migrations apply <NAME> --remote', 30),

  // Vectorize
  entry(
    'vectorize',
    'vectorize-create-dims',
    'Vectorize create (dimensions)',
    'wrangler vectorize create <NAME> --dimensions=<N> --metric=cosine',
    40,
  ),
  entry(
    'vectorize',
    'vectorize-create-preset',
    'Vectorize create (preset)',
    'wrangler vectorize create <NAME> --preset=@cf/baai/bge-base-en-v1.5',
    41,
  ),
  entry('vectorize', 'vectorize-list', 'Vectorize list', 'wrangler vectorize list', 42),
  entry('vectorize', 'vectorize-get', 'Vectorize get', 'wrangler vectorize get <NAME>', 43),
  entry('vectorize', 'vectorize-delete', 'Vectorize delete', 'wrangler vectorize delete <NAME>', 44),
  entry('vectorize', 'vectorize-insert', 'Vectorize insert', 'wrangler vectorize insert <NAME> --file=vectors.ndjson', 45),
  entry(
    'vectorize',
    'vectorize-query',
    'Vectorize query',
    'wrangler vectorize query <NAME> --vector="[0.1, 0.2, ...]" --top-k=10',
    46,
  ),

  // Hyperdrive
  entry(
    'hyperdrive',
    'hyperdrive-create',
    'Hyperdrive create',
    'wrangler hyperdrive create <NAME> --connection-string="postgres://user:pass@host:5432/db"',
    50,
  ),
  entry('hyperdrive', 'hyperdrive-list', 'Hyperdrive list', 'wrangler hyperdrive list', 51),
  entry('hyperdrive', 'hyperdrive-get', 'Hyperdrive get', 'wrangler hyperdrive get <ID>', 52),
  entry(
    'hyperdrive',
    'hyperdrive-update',
    'Hyperdrive update',
    'wrangler hyperdrive update <ID> --connection-string="..."',
    53,
  ),
  entry('hyperdrive', 'hyperdrive-delete', 'Hyperdrive delete', 'wrangler hyperdrive delete <ID>', 54),

  // KV
  entry('kv', 'kv-namespace-create', 'KV namespace create', 'wrangler kv namespace create <NAME>', 60),
  entry('kv', 'kv-namespace-list', 'KV namespace list', 'wrangler kv namespace list', 61),
  entry('kv', 'kv-namespace-delete', 'KV namespace delete', 'wrangler kv namespace delete --namespace-id=<ID>', 62),
  entry('kv', 'kv-key-put', 'KV key put', 'wrangler kv key put <KEY> <VALUE> --namespace-id=<ID> --remote', 63),
  entry('kv', 'kv-key-get', 'KV key get', 'wrangler kv key get <KEY> --namespace-id=<ID> --remote', 64),
  entry('kv', 'kv-key-delete', 'KV key delete', 'wrangler kv key delete <KEY> --namespace-id=<ID> --remote', 65),
  entry('kv', 'kv-key-list', 'KV key list', 'wrangler kv key list --namespace-id=<ID> --remote', 66),

  // Queues
  entry('queues', 'queues-create', 'Queues create', 'wrangler queues create <NAME>', 70),
  entry('queues', 'queues-list', 'Queues list', 'wrangler queues list', 71),
  entry('queues', 'queues-delete', 'Queues delete', 'wrangler queues delete <NAME>', 72),
  entry('queues', 'queues-consumer-add', 'Queues consumer add', 'wrangler queues consumer add <QUEUE> <WORKER>', 73),
  entry('queues', 'queues-consumer-remove', 'Queues consumer remove', 'wrangler queues consumer remove <QUEUE> <WORKER>', 74),

  // Workers (general)
  entry('worker', 'worker-deploy', 'Deploy Worker', 'wrangler deploy', 80, 'Deploy current Worker project'),
  entry('worker', 'worker-dev', 'Dev server', 'wrangler dev', 81),
  entry('worker', 'worker-tail', 'Tail logs', 'wrangler tail <WORKER_NAME>', 82),
  entry('worker', 'worker-rollback', 'Rollback', 'wrangler rollback', 83),
  entry('worker', 'worker-versions-list', 'Versions list', 'wrangler versions list', 84),
  entry('worker', 'worker-versions-deploy', 'Versions deploy', 'wrangler versions deploy', 85),
  entry('worker', 'worker-secret-put', 'Secret put', 'wrangler secret put <NAME>', 86),
  entry('worker', 'worker-secret-delete', 'Secret delete', 'wrangler secret delete <NAME>', 87),
  entry('worker', 'worker-secret-list', 'Secret list', 'wrangler secret list', 88),

  // Cloudflare Workflows product (wrangler workflows *)
  entry('workflows', 'workflows-list', 'Workflows list', 'wrangler workflows list', 100),
  entry('workflows', 'workflows-describe', 'Workflows describe', 'wrangler workflows describe <NAME>', 101),
  entry('workflows', 'workflows-trigger', 'Workflows trigger', 'wrangler workflows trigger <NAME>', 102),
  entry('workflows', 'workflows-instances-list', 'Workflow instances list', 'wrangler workflows instances list <NAME>', 103),
  entry(
    'workflows',
    'workflows-instances-describe',
    'Workflow instance describe',
    'wrangler workflows instances describe <NAME> <INSTANCE_ID>',
    104,
  ),
  entry(
    'workflows',
    'workflows-instances-terminate',
    'Workflow instance terminate',
    'wrangler workflows instances terminate <NAME> <INSTANCE_ID>',
    105,
  ),
];

export function filterWranglerCatalog(term: string, limit = 80): WranglerCatalogEntry[] {
  const t = term.trim().toLowerCase();
  const rows = !t
    ? WRANGLER_COMMAND_CATALOG
    : WRANGLER_COMMAND_CATALOG.filter((c) => {
        const hay = `${c.display_name} ${c.mapped_command} ${c.category} ${c.slug}`.toLowerCase();
        return hay.includes(t);
      });
  return rows.slice(0, limit);
}

export function groupWranglerCatalog(
  rows: WranglerCatalogEntry[],
): { category: WranglerCommandCategory; label: string; rows: WranglerCatalogEntry[] }[] {
  const order: WranglerCommandCategory[] = [
    'auth',
    'r2',
    'd1',
    'vectorize',
    'hyperdrive',
    'kv',
    'queues',
    'worker',
    'workflows',
  ];
  const byCat = new Map<WranglerCommandCategory, WranglerCatalogEntry[]>();
  for (const r of rows) {
    const list = byCat.get(r.category) || [];
    list.push(r);
    byCat.set(r.category, list);
  }
  return order
    .filter((c) => byCat.has(c))
    .map((c) => ({
      category: c,
      label: WRANGLER_CATEGORY_LABELS[c],
      rows: (byCat.get(c) || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }));
}

/** Normalize D1 / API rows onto catalog shape. */
export function normalizeCommandRow(raw: Record<string, unknown>): WranglerCatalogEntry | null {
  const mapped = String(raw.mapped_command || raw.command_template || '').trim();
  if (!mapped) return null;
  const cmd = mapped.replace(/^npx\s+/i, '');
  const category = String(raw.category || 'worker').toLowerCase() as WranglerCommandCategory;
  const validCategories = Object.keys(WRANGLER_CATEGORY_LABELS) as WranglerCommandCategory[];
  return {
    id: String(raw.id || raw.slug || cmd),
    slug: String(raw.slug || ''),
    display_name: String(raw.display_name || raw.name || cmd),
    category: validCategories.includes(category) ? category : 'worker',
    mapped_command: cmd,
    description: raw.description != null ? String(raw.description) : undefined,
    risk_level: (raw.risk_level as WranglerCatalogEntry['risk_level']) || riskFor(cmd),
    requires_confirmation: Boolean(raw.requires_confirmation),
    sort_order: typeof raw.sort_order === 'number' ? raw.sort_order : 50,
  };
}
