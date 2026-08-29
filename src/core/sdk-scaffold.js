/**
 * Agent Sam SDK scaffold — CORE provisions CF resources and returns file contents.
 * External developers never clone IAM repos; Agent Sam builds the project server-side.
 */
import { cfApi } from './customer-cloudflare-dispatch.js';
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { resolveEffectiveWorkspaceId } from '../../backend/identity/bootstrap.js';
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { generateUserPtyAuthToken } from '../../backend/credentials/user-secrets.js';

const LANE_KEYS = {
  fullstack: 'fullstack',
  cms: 'cms',
  data: 'data',
  crm: 'crm',
  creative: 'creative',
  'full stack': 'fullstack',
  'data solutions': 'data',
  'customer management': 'crm',
  'creative & design': 'creative',
};

const LANE_LABELS = {
  fullstack: 'Full Stack',
  cms: 'CMS',
  data: 'Data Solutions',
  crm: 'Customer Management',
  creative: 'Creative & Design',
};

const AGENT_FOR_LANE = {
  fullstack: 'orchestrator',
  cms: 'cms',
  data: 'data',
  crm: 'crm',
  creative: 'creative',
};

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function slugify(value) {
  return (
    trim(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agentsam-project'
  );
}

function looksLikeCfAccountId(v) {
  return /^[a-f0-9]{32}$/i.test(trim(v));
}

async function cfFetchJson(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.[0]?.message || `cloudflare_${res.status}`;
    throw new Error(String(msg));
  }
  return data.result;
}

async function listCfAccounts(token) {
  const data = await cfFetchJson(token, 'https://api.cloudflare.com/client/v4/accounts?per_page=50');
  const accounts = Array.isArray(data) ? data : [];
  return accounts
    .map((a) => ({ id: trim(a?.id), name: trim(a?.name) || trim(a?.id) }))
    .filter((a) => a.id);
}

async function resolveCfTokenAndAccount(env, authUser, explicitAccountId) {
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) throw new Error('user_not_resolved');
  const row = await getIntegrationOAuthRow(env, userId, 'cloudflare', '');
  const token = row?.access_token ? trim(row.access_token) : '';
  if (!token) throw new Error('cloudflare_oauth_required');

  const accounts = await listCfAccounts(token);
  const explicit = trim(explicitAccountId);
  if (explicit && looksLikeCfAccountId(explicit)) {
    return { token, accountId: explicit, accounts, userId };
  }
  if (accounts.length === 1) {
    return { token, accountId: accounts[0].id, accounts, userId };
  }
  if (accounts.length === 0) {
    throw new Error('cloudflare_account_not_found');
  }
  throw new Error('cloudflare_account_selection_required');
}

async function createD1Database(token, accountId, name) {
  return cfApi(token, `/accounts/${encodeURIComponent(accountId)}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

async function createKvNamespace(token, accountId, title) {
  return cfApi(token, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

async function createR2Bucket(token, accountId, bucketName) {
  return cfApi(token, `/accounts/${encodeURIComponent(accountId)}/r2/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name: bucketName }),
  });
}

async function execD1Sql(token, accountId, databaseId, sql) {
  const statement = trim(sql);
  if (!statement) return;
  await cfFetchJson(
    token,
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    { method: 'POST', body: JSON.stringify({ sql: statement }) },
  );
}

function splitMigrationStatements(sql) {
  return String(sql || '')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(';') ? s.slice(0, -1) : s));
}

function migrationTemplate({ projectName, laneKey }) {
  const cmsExtra =
    laneKey === 'cms'
      ? `
CREATE TABLE IF NOT EXISTS cms_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  hero_asset_key TEXT,
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cms_assets (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  title TEXT,
  alt_text TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`
      : '';

  return `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  lane TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_json TEXT,
  output_json TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);
${cmsExtra}
`.trim();
}

function workerTemplate({ projectName, laneKey, agent }) {
  return `import { AgentSam } from '@inneranimalmedia/agentsam-sdk';

export default {
  async fetch(request, env, ctx) {
    const agent = new AgentSam({
      env,
      ctx,
      project: '${projectName}',
      lane: '${laneKey}',
      agent: '${agent}',
    });

    return agent.handle(request);
  },
};
`;
}

function wranglerTemplate({ projectName, accountId, d1Id, kvId, bucketName }) {
  return `name = "${projectName}"
main = "src/index.js"
compatibility_date = "2026-06-27"
account_id = "${accountId}"

[[d1_databases]]
binding = "DB"
database_name = "${projectName}-db"
database_id = "${d1Id}"

[[kv_namespaces]]
binding = "KV"
id = "${kvId}"

[[r2_buckets]]
binding = "R2"
bucket_name = "${bucketName}"
`;
}

function buildScaffoldFiles({
  projectName,
  laneKey,
  laneLabel,
  agent,
  hosting,
  accountId,
  d1Id,
  kvId,
  bucketName,
  sdkVersion = '1.5.1',
}) {
  const sdkRange = `^${sdkVersion.split('.').slice(0, 2).join('.')}.0`;
  const migrationSql = migrationTemplate({ projectName, laneKey });

  const files = [
    {
      path: 'agentsam.config.js',
      content: `export default {
  project: '${projectName}',
  lane: '${laneKey}',
  provider: '${hosting}',
  agent: '${agent}',
  cloudflare: {
    accountId: '${accountId}',
  },
  api: {
    baseUrl: '/api/agentsam',
  },
};
`,
    },
    {
      path: '.env.example',
      content: `# Copy to .env (gitignored). Wrangler also reads these from the shell / .dev.vars.
# This Worker does NOT use AGENTSAM_API_KEY — runtime uses Cloudflare bindings
# (DB / KV / R2 in wrangler.toml), not a custom API key.

# ── wrangler CLI (npm run dev / deploy / db:migrate) ──────────────────────────
CLOUDFLARE_ACCOUNT_ID=${accountId || 'your-cloudflare-account-id'}
# API token with Account / D1 / Workers / KV / R2 edit (or npx wrangler login)
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token

# Optional: D1 name when using agentsam-sdk Python audits without --db
AGENTSAM_D1_DB_NAME=${projectName}-db

# ── NOT env vars — already in wrangler.toml after scaffold ────────────────────
# [[d1_databases]] database_id
# [[kv_namespaces]] id
# [[r2_buckets]] bucket_name
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
.env
.dev.vars
dist/
.wrangler/
`,
    },
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: projectName,
          version: '0.1.0',
          type: 'module',
          private: true,
          scripts: {
            dev: 'wrangler dev --port 8787',
            deploy: 'wrangler deploy',
            smoke: 'node ./scripts/smoke.mjs',
            'db:migrate': 'wrangler d1 migrations apply DB --remote',
          },
          dependencies: {
            '@inneranimalmedia/agentsam-sdk': sdkRange,
          },
          devDependencies: {
            wrangler: '^4.0.0',
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'wrangler.toml',
      content: wranglerTemplate({ projectName, accountId, d1Id, kvId, bucketName }),
    },
    {
      path: 'migrations/0001_agentsam_core.sql',
      content: `${migrationSql}\n`,
    },
    {
      path: 'src/index.js',
      content: `${workerTemplate({ projectName, laneKey, agent })}\n`,
    },
    {
      path: 'README.md',
      content: `# ${projectName}

Built by [Agent Sam](https://inneranimalmedia.com) — your Cloudflare account, your repo, your Worker.

## Lane

**${laneLabel}** — ${agent} agent · hosting: ${hosting}

## Commands

\`\`\`bash
npm install
npm run smoke
npm run dev
npx wrangler deploy
\`\`\`

Worker API on **http://127.0.0.1:8787**. CLI / Gorilla shell UX lives in the separate [agentsam-sdk](https://github.com/SamPrimeaux/agentsam-sdk) package (\`npx @inneranimalmedia/agentsam-sdk shell\`).

This project is yours. IAM helped scaffold it; you can run it without IAM anytime.
`,
    },
    {
      path: 'scripts/smoke.mjs',
      content: `import { AgentSam } from '@inneranimalmedia/agentsam-sdk';

const app = new AgentSam({ project: '${projectName}', lane: '${laneKey}', agent: '${agent}' });
const res = await app.handle(new Request('https://example.com/api/health'));
const data = await res.json();

if (!data.ok) {
  console.error(data);
  process.exit(1);
}

console.log('AgentSam smoke test passed:', data);
`,
    },
  ];

  return files;
}

function normalizeLane(raw) {
  const key = LANE_KEYS[trim(raw).toLowerCase()] || trim(raw).toLowerCase();
  return LANE_KEYS[key] ? key : 'fullstack';
}

function normalizeHosting(raw) {
  const h = trim(raw).toLowerCase();
  if (h === 'github' || h === 'github_cf' || h === 'github + cloudflare') return 'github';
  if (h === 'local' || h === 'self-hosted' || h === 'self_hosted') return 'local';
  return 'cloudflare';
}

/**
 * @param {Record<string, unknown>} env
 * @param {import('./auth.js').AuthUser} authUser
 * @param {Request} request
 * @param {Record<string, unknown>} body
 * @param {(event: Record<string, unknown>) => void | Promise<void>} emit
 */
export async function runSdkScaffold(env, authUser, request, body, emit, terminalDeps = {}) {
  const projectName = slugify(body?.project_name || body?.projectName || body?.name);
  const laneKey = normalizeLane(body?.lane || 'fullstack');
  const laneLabel = LANE_LABELS[laneKey] || 'Full Stack';
  const agent = trim(body?.agent) || AGENT_FOR_LANE[laneKey] || 'orchestrator';
  const hosting = normalizeHosting(body?.hosting || body?.provider || 'cloudflare');
  const accountIdInput = trim(body?.account_id || body?.cf_account_id);

  await emit({ type: 'log', message: `Project: ${projectName} · lane: ${laneLabel} · agent: ${agent}` });

  let workspaceId = trim(body?.workspace_id || authUser.workspace_id);
  if (!workspaceId) {
    const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    workspaceId = wsRes.workspaceId;
  }
  if (!workspaceId) throw new Error('workspace_context_missing');

  const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
  if (!tenantId) throw new Error('tenant_missing');

  await emit({ type: 'log', message: 'Resolving Cloudflare OAuth credentials…' });
  const { token, accountId, accounts } = await resolveCfTokenAndAccount(env, authUser, accountIdInput);

  if (!accountId) {
    await emit({
      type: 'account_selection_required',
      accounts,
      message: 'Multiple Cloudflare accounts — pass account_id and retry.',
    });
    throw new Error('cloudflare_account_selection_required');
  }

  await emit({ type: 'log', message: `Cloudflare account ${accountId.slice(0, 8)}…` });

  await emit({ type: 'log', message: `Creating D1 database ${projectName}-db…` });
  const d1 = await createD1Database(token, accountId, `${projectName}-db`);
  const d1Id = trim(d1?.uuid || d1?.id);
  if (!d1Id) throw new Error('d1_create_failed');
  await emit({ type: 'log', message: `D1 ready (${d1Id})` });

  await emit({ type: 'log', message: `Creating KV namespace ${projectName}-kv…` });
  const kv = await createKvNamespace(token, accountId, `${projectName}-kv`);
  const kvId = trim(kv?.id);
  if (!kvId) throw new Error('kv_create_failed');
  await emit({ type: 'log', message: `KV ready (${kvId})` });

  await emit({ type: 'log', message: `Creating R2 bucket ${projectName}…` });
  await createR2Bucket(token, accountId, projectName);
  await emit({ type: 'log', message: 'R2 bucket ready' });

  const migrationSql = migrationTemplate({ projectName, laneKey });
  await emit({ type: 'log', message: 'Applying initial D1 migration…' });
  for (const stmt of splitMigrationStatements(migrationSql)) {
    await execD1Sql(token, accountId, d1Id, stmt);
  }
  await emit({ type: 'log', message: 'Migration applied' });

  const provisionOnly =
    body?.provision_only === true ||
    body?.provisionOnly === true ||
    trim(body?.mode) === 'provision_only';

  if (provisionOnly) {
    await emit({
      type: 'complete',
      project_name: projectName,
      lane: laneKey,
      agent,
      hosting,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      provision_only: true,
      cloudflare: {
        account_id: accountId,
        d1_database_id: d1Id,
        kv_namespace_id: kvId,
        r2_bucket: projectName,
      },
      next_steps: ['Update wrangler.toml with returned IDs', 'npx wrangler deploy'],
    });
    return;
  }

  await emit({ type: 'log', message: 'Generating project files…' });
  const files = buildScaffoldFiles({
    projectName,
    laneKey,
    laneLabel,
    agent,
    hosting,
    accountId,
    d1Id,
    kvId,
    bucketName: projectName,
  });

  await emit({ type: 'log', message: 'Registering LOCAL-USER PTY connection…' });
  const canPty = await terminalDeps.canRunPty?.(env, String(authUser.id), workspaceId);
  const ptyProv = canPty
    ? await terminalDeps.provisionUserHostedTunnelConnection(env.DB, { userId: String(authUser.id), workspaceId, tenantId, platform: trim(body?.platform) || 'macos', shell: '/bin/zsh' })
    : { ok: false, error: 'terminal_not_enabled', created: false };
  if (!ptyProv.ok && ptyProv.error !== 'terminal_not_enabled') {
    await emit({ type: 'warn', message: `PTY registration skipped: ${ptyProv.error}` });
  }

  let ptyToken = null;
  if (canPty) {
    try {
      const tok = await generateUserPtyAuthToken(env, authUser, workspaceId, request, {}, terminalDeps);
      if (tok.ok && tok.token) ptyToken = tok.token;
    } catch {
      /* optional */
    }
  }

  const conn = await terminalDeps.getUserHostedTunnelConnection?.(env.DB, String(authUser.id), workspaceId) || null;

  await emit({
    type: 'complete',
    project_name: projectName,
    lane: laneKey,
    agent,
    hosting,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    user_id: authUser.id,
    cloudflare: {
      account_id: accountId,
      d1_database_id: d1Id,
      kv_namespace_id: kvId,
      r2_bucket: projectName,
    },
    files,
    pty: {
      connection_id: conn?.id ? String(conn.id) : ptyProv?.connection?.id ?? null,
      connection_created: ptyProv.created === true,
      pty_auth_token: ptyToken,
    },
    next_steps: [
      `cd ${projectName}`,
      'npm install',
      'npm run smoke',
      'npm run dev',
      'Open http://localhost:5173 — Gorilla Mode UI',
      'Optional: npx agentsam start-local',
      'npx agentsam deploy   # Cloudflare OAuth only when you ship',
    ],
  });
}

export { slugify, normalizeLane, normalizeHosting, listCfAccountsForSdk };

async function listCfAccountsForSdk(env, authUser) {
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return { ok: false, accounts: [], error: 'user_not_resolved' };
  const row = await getIntegrationOAuthRow(env, userId, 'cloudflare', '');
  const token = row?.access_token ? trim(row.access_token) : '';
  if (!token) return { ok: false, accounts: [], error: 'cloudflare_oauth_required' };
  const accounts = await listCfAccounts(token);
  return { ok: true, accounts, cloudflare_connected: true };
}
