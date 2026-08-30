/**
 * OpenAI Responses hosted shell (tkt_oai_hosted_shell).
 * Gate: feature flag openai_hosted_shell + agentsam_model_catalog.supports_hosted_shell.
 * Injects { type: "shell", environment: { type: "container_auto" } } — OpenAI runs commands.
 * Local shell executor (environment.type=local → IAM PTY) is out of scope for this ticket.
 * Never hardcode model ids — catalog column is SSOT.
 */

export const FLAG_KEY = 'openai_hosted_shell';

/** Hybrid routing hint appended to Responses instructions when shell is injected. */
export const HOSTED_SHELL_HYBRID_INSTRUCTION = [
  'Shell routing (hybrid):',
  '- Prefer the active workspace terminal / filesystem tools for Inner Animal Media repo, git, deploys, and workspace files (.scratch/, src/, app/, absolute Mac/GCP paths).',
  '- Use the OpenAI hosted shell tool ONLY for isolated Debian container work under /mnt/data (scratch compute). Hosted shell is NOT the IAM workspace.',
  '- Never use hosted shell for .scratch/, repo-relative paths, /Users/, /home/<tunnel-owner>/, or git/deploy. If the task needs those, use workspace tools already on your menu.',
  '- Hosted shell has no outbound network unless an allowlist is configured; do not assume curl/pip network works.',
].join('\n');

/** Paths / cues that mean the model aimed hosted shell at the IAM workspace (Job 1), not /mnt/data. */
const WORKSPACE_SHELL_RE =
  /(^|[^\w.])(\.scratch\/|src\/|dashboard\/|migrations\/|scripts\/|\/Users\/|\/home\/[A-Za-z0-9._-]+|inneranimalmedia\/|\bgit\b|\bnpm run deploy|\bwrangler\b)/i;

/**
 * True when hosted-shell commands look like workspace/repo work (fail-loud for Gate 1a).
 * `/mnt/data` scratch alone is allowed; git/deploy/repo paths are not.
 * @param {string[]|null|undefined} commands
 */
export function hostedShellCommandsTargetWorkspace(commands) {
  const cmds = Array.isArray(commands) ? commands : [];
  for (const c of cmds) {
    const s = String(c || '').trim();
    if (!s) continue;
    if (WORKSPACE_SHELL_RE.test(s)) return true;
  }
  return false;
}
/**
 * Build Responses `tools[]` shell entry. network_policy only when domains non-empty
 * (org dashboard allowlist must already include them — requests can only further restrict).
 * @param {string[]} [allowedDomains]
 * @param {{ containerId?: string|null }} [opts]
 */
export function buildHostedShellTool(allowedDomains = [], opts = {}) {
  const domains = (Array.isArray(allowedDomains) ? allowedDomains : [])
    .map((d) => String(d || '').trim().toLowerCase())
    .filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d) || d === 'localhost')
    .slice(0, 32);
  const containerId = String(opts.containerId || '').trim();
  /** @type {Record<string, unknown>} */
  const environment = containerId
    ? { type: 'container_reference', container_id: containerId }
    : { type: 'container_auto' };
  if (domains.length) {
    environment.network_policy = {
      type: 'allowlist',
      allowed_domains: domains,
    };
  }
  return { type: 'shell', environment };
}

/**
 * @param {unknown[]|undefined} oaiTools
 * @param {boolean} enabled
 * @param {{ allowedDomains?: string[], containerId?: string|null }} [opts]
 */
export function withHostedShellTool(oaiTools, enabled, opts = {}) {
  if (!enabled) return oaiTools;
  const list = Array.isArray(oaiTools) ? [...oaiTools] : [];
  if (!list.some((t) => t && typeof t === 'object' && t.type === 'shell')) {
    list.push(buildHostedShellTool(opts.allowedDomains, { containerId: opts.containerId }));
  }
  return list.length ? list : undefined;
}

/**
 * @param {any} env
 * @param {string|null|undefined} modelKey
 */
export async function modelSupportsHostedShell(env, modelKey) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk) return false;
  const { loadCatalogCapabilities } = await import(
    '../../backend/agentsam/catalog/model-capabilities.js'
  );
  const cap = await loadCatalogCapabilities(env, mk);
  return cap?.supports_hosted_shell === true;
}

/**
 * Read optional allowed_domains from flag config_json (empty = no network_policy).
 * @param {any} env
 * @returns {Promise<string[]>}
 */
export async function loadHostedShellAllowedDomains(env) {
  if (!env?.DB) return [];
  try {
    const row = await env.DB.prepare(
      `SELECT config_json FROM agentsam_feature_flag
       WHERE flag_key = ? AND COALESCE(is_archived, 0) = 0 LIMIT 1`,
    )
      .bind(FLAG_KEY)
      .first();
    if (!row?.config_json) return [];
    const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
    const domains = cfg?.allowed_domains;
    return Array.isArray(domains) ? domains.map((d) => String(d)) : [];
  } catch {
    return [];
  }
}

/**
 * True when the turn's Files rail / menu is the GitHub workspace (not /mnt/data).
 * Hosted shell must not steal inspect/edit away from agentsam_github_* + retrieve.
 * @param {{
 *   filesSource?: string|null,
 *   files_source?: string|null,
 *   tools?: unknown[]|null,
 * }} opts
 */
export function isGithubWorkspaceHostedShellSurface(opts = {}) {
  const src = String(opts.filesSource || opts.files_source || '')
    .trim()
    .toLowerCase();
  if (src === 'github') return true;
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  for (const t of tools) {
    const name =
      t && typeof t === 'object'
        ? String(
            /** @type {any} */ (t).name ||
              /** @type {any} */ (t).tool_key ||
              /** @type {any} */ (t).tool_name ||
              '',
          )
            .trim()
            .toLowerCase()
        : '';
    if (name.startsWith('agentsam_github_')) return true;
  }
  return false;
}

/**
 * Flag + catalog capability. Fail-closed when either is off.
 * Soft gate: writePolicy.can_terminal === false blocks inject (hosted shell still "shell").
 * Hard block: Design Studio / CAD routes — OpenAI hosted shell is /mnt/data scratch, not CAD.
 * Hard block: GitHub Files rail / agentsam_github_* menu — use real agentsam_tools.
 * @param {any} env
 * @param {{
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   modelKey?: string|null,
 *   writePolicy?: Record<string, unknown>|null,
 *   routeKey?: string|null,
 *   taskType?: string|null,
 *   tools?: unknown[]|null,
 *   filesSource?: string|null,
 *   files_source?: string|null,
 * }} opts
 */
export async function shouldInjectHostedShell(env, opts = {}) {
  if (opts.writePolicy && opts.writePolicy.can_terminal === false) return false;
  if (isDesignStudioCadSurface(opts)) return false;
  if (isGithubWorkspaceHostedShellSurface(opts)) return false;
  const { isFeatureEnabled } = await import('../../backend/platform/feature-flags.js');
  const flagOn = await isFeatureEnabled(env, FLAG_KEY, {
    userId: opts.userId,
    tenantId: opts.tenantId,
  });
  if (!flagOn) return false;
  return modelSupportsHostedShell(env, opts.modelKey);
}

/**
 * Design Studio / CAD generation must use cad_generate → viewport GLB, never OpenAI hosted shell.
 * @param {{
 *   routeKey?: string|null,
 *   taskType?: string|null,
 *   tools?: unknown[]|null,
 * }} opts
 */
export function isDesignStudioCadSurface(opts = {}) {
  const rk = String(opts.routeKey || '')
    .trim()
    .toLowerCase();
  const tt = String(opts.taskType || '')
    .trim()
    .toLowerCase();
  if (
    rk === 'design_studio' ||
    rk === 'cad_generation' ||
    rk.startsWith('design_studio') ||
    tt === 'design_studio_base' ||
    tt === 'cad_generation' ||
    tt.startsWith('design_studio_base')
  ) {
    return true;
  }
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  for (const t of tools) {
    const name =
      t && typeof t === 'object'
        ? String(/** @type {any} */ (t).name || /** @type {any} */ (t).tool_key || '').trim()
        : '';
    if (name === 'cad_generate') return true;
  }
  return false;
}

/**
 * Append hybrid routing instruction once.
 * @param {string|null|undefined} systemPrompt
 * @param {boolean} enabled
 */
export function withHostedShellHybridInstructions(systemPrompt, enabled) {
  if (!enabled) return systemPrompt;
  const base = systemPrompt != null ? String(systemPrompt) : '';
  if (base.includes('Shell routing (hybrid):')) return base || systemPrompt;
  if (!base.trim()) return HOSTED_SHELL_HYBRID_INSTRUCTION;
  return `${base.trim()}\n\n${HOSTED_SHELL_HYBRID_INSTRUCTION}`;
}

/**
 * Summarize shell_call action for SSE / logs.
 * @param {unknown} action
 */
export function summarizeShellCallAction(action) {
  const a = action && typeof action === 'object' ? action : {};
  const cmds = Array.isArray(a.commands)
    ? a.commands.map((c) => String(c)).filter(Boolean)
    : typeof a.command === 'string'
      ? [a.command]
      : [];
  return {
    commands: cmds.slice(0, 8),
    timeout_ms: a.timeout_ms != null ? Number(a.timeout_ms) : null,
    max_output_length: a.max_output_length != null ? Number(a.max_output_length) : null,
  };
}

/**
 * API-shape helper: shell_call with no executable commands.
 * @param {{ commands?: string[] }|null|undefined} actionSummary
 */
export function isEmptyHostedShellAction(actionSummary) {
  const cmds = Array.isArray(actionSummary?.commands) ? actionSummary.commands : [];
  return cmds.filter((c) => String(c || '').trim()).length === 0;
}

/**
 * Flatten shell_call_output for UI preview.
 * @param {unknown} output
 */
export function formatShellCallOutputPreview(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output.slice(0, 8000);
  if (!Array.isArray(output)) {
    try {
      return JSON.stringify(output).slice(0, 8000);
    } catch {
      return String(output).slice(0, 8000);
    }
  }
  const parts = [];
  for (const item of output.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const stdout = item.stdout != null ? String(item.stdout) : '';
    const stderr = item.stderr != null ? String(item.stderr) : '';
    const outcome = item.outcome && typeof item.outcome === 'object' ? item.outcome : {};
    const code =
      outcome.type === 'exit' && outcome.exit_code != null
        ? `exit=${outcome.exit_code}`
        : outcome.type
          ? String(outcome.type)
          : '';
    if (stdout) parts.push(stdout.slice(0, 4000));
    if (stderr) parts.push(`[stderr] ${stderr.slice(0, 2000)}`);
    if (code) parts.push(`[${code}]`);
  }
  return parts.join('\n').slice(0, 8000);
}
