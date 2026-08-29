/**
 * Wrangler CLI auth + general commands — aligned with Cloudflare docs (Apr 2026).
 * @see https://developers.cloudflare.com/workers/wrangler/commands/
 *
 * Lane law:
 * - local (Mac PTY): wrangler login OAuth on your machine
 * - remote (GCP VM): CLOUDFLARE_API_TOKEN via sync-vm-env-cloudflare.sh (headless)
 * - sandbox (CF container): CLOUDFLARE_API_TOKEN injected by Worker — never wrangler login OAuth
 */

/** @typedef {'local'|'remote'|'sandbox'|'auto'} TerminalAuthLane */

export const WRANGLER_DOCS_URL = 'https://developers.cloudflare.com/workers/wrangler/commands/';

/** General Wrangler commands (Cmd+K + terminal help). */
export const WRANGLER_GENERAL_COMMANDS = Object.freeze([
  {
    id: 'wr-docs',
    label: 'Open Wrangler docs',
    command: 'npx wrangler docs [SEARCH]',
    lane: 'all',
    notes: 'Search Cloudflare docs from the CLI.',
  },
  {
    id: 'wr-whoami',
    label: 'Who am I',
    command: 'wrangler whoami',
    lane: 'all',
    notes: 'Verify auth. Use --json for scripts.',
  },
  {
    id: 'wr-auth-token',
    label: 'Print auth token (JSON)',
    command: 'wrangler auth token --json',
    lane: 'sandbox',
    notes: 'Headless / CI — prefer CLOUDFLARE_API_TOKEN in containers.',
  },
  {
    id: 'wr-login-local',
    label: 'Login (local Mac only)',
    command: 'wrangler login',
    lane: 'local',
    notes: 'OAuth in browser. Do not use in CF container — use API token instead.',
  },
  {
    id: 'wr-login-container',
    label: 'Login (container — interactive only)',
    command: 'wrangler login --callback-host=0.0.0.0 --callback-port=8976',
    lane: 'sandbox',
    notes: 'Requires port 8976 published to host. Prefer CLOUDFLARE_API_TOKEN for Agent Sam sandbox.',
  },
  {
    id: 'wr-logout',
    label: 'Logout OAuth',
    command: 'wrangler logout',
    lane: 'local',
  },
  {
    id: 'wr-telemetry-disable',
    label: 'Disable Wrangler telemetry',
    command: 'wrangler telemetry disable',
    lane: 'all',
  },
]);

/**
 * @param {string} command
 */
export function isWranglerCommand(command) {
  return /\b(npx\s+)?wrangler\b/i.test(String(command || ''));
}

/**
 * @param {string} command
 */
export function isWranglerLoginCommand(command) {
  return /\b(npx\s+)?wrangler\s+login\b/i.test(String(command || ''));
}

/**
 * @param {TerminalAuthLane} lane
 */
export function wranglerAuthGuideForLane(lane) {
  const l = String(lane || 'auto').trim().toLowerCase();
  if (l === 'local') {
    return {
      lane: 'local',
      title: 'Wrangler on your Mac',
      summary: 'Use wrangler login once on your machine (OAuth). Then wrangler deploy, d1, r2 from the local PTY.',
      recommended: ['wrangler login', 'wrangler whoami', 'wrangler deploy'],
      avoid: ['Do not expect OAuth callback inside CF container.'],
    };
  }
  if (l === 'remote') {
    return {
      lane: 'remote',
      title: 'Wrangler on cloud desk (GCP)',
      summary:
        'Headless VM — sync .env.cloudflare via scripts/sync-vm-env-cloudflare.sh. Use CLOUDFLARE_API_TOKEN, then wrangler whoami.',
      recommended: ['wrangler whoami --json', 'wrangler deploy', 'npm run deploy:full from repo root'],
      avoid: ['wrangler login (no browser on VM unless you tunnel port 8976).'],
    };
  }
  return {
    lane: 'sandbox',
    title: 'Wrangler in CF container sandbox',
    summary:
      'Agent Sam injects your Cloudflare credentials (OAuth, BYOK, or platform fallback for operators). Use wrangler whoami — not wrangler login OAuth.',
    recommended: [
      'wrangler whoami --json',
      'wrangler auth token --json',
      'wrangler deploy --dry-run',
      'npx wrangler docs deploy',
    ],
    avoid: [
      'wrangler login without --callback-host=0.0.0.0 (will hang in container).',
      'Interactive OAuth on iPhone — use GitHub tools + sandbox exec instead.',
    ],
    docs: WRANGLER_DOCS_URL,
  };
}

/**
 * Block or rewrite wrangler auth commands per lane before container/remote exec.
 * @param {string} command
 * @param {TerminalAuthLane} lane
 * @returns {{ ok: true, command: string } | { ok: false, error: string, guidance: ReturnType<typeof wranglerAuthGuideForLane> }}
 */
export function normalizeWranglerCommandForLane(command, lane) {
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: true, command: cmd };
  if (!isWranglerLoginCommand(cmd)) return { ok: true, command: cmd };

  const l = String(lane || 'sandbox').trim().toLowerCase();
  const guide = wranglerAuthGuideForLane(l === 'remote' ? 'remote' : l === 'local' ? 'local' : 'sandbox');

  if (l === 'sandbox' || l === 'auto') {
    if (!/--callback-host=/i.test(cmd)) {
      return {
        ok: false,
        error:
          'wrangler login OAuth does not work in CF sandbox without a published callback. ' +
          'Use injected CLOUDFLARE_API_TOKEN and run: wrangler whoami --json',
        guidance: guide,
      };
    }
  }

  return { ok: true, command: cmd };
}

/**
 * Prefix shell exports for headless wrangler in container (per-user CF credentials).
 * @param {any} env
 * @param {{ id?: string, user_id?: string, auth_id?: string, tenant_id?: string, workspace_id?: string }|null} authUser
 */
export async function buildContainerWranglerEnvPrefix(env, authUser) {
  const userId = authUser?.id || authUser?.user_id || authUser?.auth_id;
  const tenantId = authUser?.tenant_id;
  const workspaceId = authUser?.workspace_id;
  if (!userId) return '';

  const { resolvePtySessionCloudflareEnv } = await import('./pty-session-cloudflare-env.js');
  const creds = await resolvePtySessionCloudflareEnv(env, { userId, tenantId, workspaceId });

  if (!creds.ok || !creds.cloudflare_api_token) return '';

  const parts = [
    `export CLOUDFLARE_API_TOKEN=${shellQuote(creds.cloudflare_api_token)}`,
    'export WRANGLER_SEND_METRICS=false',
  ];
  if (creds.cloudflare_account_id) {
    parts.push(`export CLOUDFLARE_ACCOUNT_ID=${shellQuote(creds.cloudflare_account_id)}`);
  }
  return parts.join(' && ');
}

/**
 * @param {string} raw
 */
function shellQuote(raw) {
  const s = String(raw || '');
  if (!/[\s'"$`\\]/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Apply env prefix + lane normalization to a container exec command.
 * @param {any} env
 * @param {{ id?: string, user_id?: string, auth_id?: string, tenant_id?: string, workspace_id?: string }|null} authUser
 * @param {string} command
 * @param {TerminalAuthLane} [lane]
 */
export async function prepareContainerShellCommand(env, authUser, command, lane = 'sandbox') {
  const norm = normalizeWranglerCommandForLane(command, lane);
  if (!norm.ok) {
    return { ok: false, error: norm.error, guidance: norm.guidance };
  }
  const prefix = await buildContainerWranglerEnvPrefix(env, authUser);
  const cmd = norm.command;
  if (isWranglerCommand(cmd) && !prefix) {
    return {
      ok: false,
      error:
        'CLOUDFLARE_API_TOKEN could not be injected into the sandbox. Superadmin: ensure platform CLOUDFLARE_API_TOKEN is set. Customers: connect Cloudflare OAuth or BYOK. Prefer agentsam_d1_query / agentsam_d1_write with database_id + sql.',
      guidance: wranglerAuthGuideForLane('sandbox'),
    };
  }
  if (!prefix) return { ok: true, command: cmd };
  return { ok: true, command: `${prefix} && ${cmd}` };
}

/**
 * Wrangler-specific recovery hints appended to terminal tool output.
 * @param {{ stdout?: string, stderr?: string, command?: string }} opts
 */
export function wranglerTerminalRecoveryHints(opts = {}) {
  const text = `${opts.stdout ?? ''}\n${opts.stderr ?? ''}\n${opts.command ?? ''}`;
  const hints = [];

  if (/Unable to authenticate|Not logged in|OAuth|CLOUDFLARE_API_TOKEN/i.test(text)) {
    hints.push({
      code: 'wrangler_auth_missing',
      action:
        'Sandbox: connect Cloudflare OAuth or BYOK, then wrangler whoami. Local: wrangler login. Remote: sync-vm-env-cloudflare.sh.',
    });
  }
  if (/callback|8976|ECONNREFUSED.*8976/i.test(text) && isWranglerLoginCommand(opts.command || text)) {
    hints.push({
      code: 'wrangler_login_callback',
      action:
        'Container OAuth needs port 8976 and wrangler login --callback-host=0.0.0.0. Prefer CLOUDFLARE_API_TOKEN in sandbox.',
    });
  }
  if (/This site can't be reached|localhost:8976/i.test(text)) {
    hints.push({
      code: 'wrangler_login_remote',
      action:
        'Remote wrangler login: open the OAuth URL on your laptop, or use curl against localhost URL from a second SSH session (see Cloudflare wrangler login docs).',
    });
  }

  return hints;
}
