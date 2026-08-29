/**
 * Data-driven script execution: handler_config.script_slug → agentsam_scripts row → run.
 * No hardcoded script names, paths, or slugs in this module.
 */
import {
  finalizeAgentsamScriptRun,
  startAgentsamScriptRun,
} from './agentsam-script-runs.js';
import { resolveOutboundBridgeKey } from '../../backend/auth/bridge-key-auth.js';

function parseJson(str, fallback = {}) {
  if (str == null) return fallback;
  if (typeof str === 'object' && !Array.isArray(str)) return { ...str };
  try {
    const o = JSON.parse(String(str || '{}'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : fallback;
  } catch {
    return fallback;
  }
}

function flattenInput(input) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { value: input };
}

function templateString(tpl, vars) {
  return String(tpl || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}

/**
 * @param {any} env
 * @param {string} scriptSlug
 * @param {string | null | undefined} workspaceId
 */
export async function loadAgentsamScriptBySlug(env, scriptSlug, workspaceId) {
  const slug = String(scriptSlug || '').trim();
  if (!env?.DB || !slug) return null;

  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const row = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, slug, name, path, body, description,
            purpose, runner, language, safe_to_run, approval_required, owner_only,
            requires_env, is_active, is_global
     FROM agentsam_scripts
     WHERE slug = ?
       AND COALESCE(is_active, 1) = 1
       AND (
         COALESCE(is_global, 0) = 1
         OR (? != '' AND workspace_id = ?)
         OR workspace_id = ''
       )
     ORDER BY (CASE WHEN ? != '' AND workspace_id = ? THEN 0 ELSE 1 END)
     LIMIT 1`,
  )
    .bind(slug, ws, ws, ws, ws)
    .first();

  return row || null;
}

/**
 * Build shell command from registry row + workflow input (no slug-specific branches).
 * @param {Record<string, unknown>} scriptRow
 * @param {Record<string, unknown>} input
 */
export function buildScriptCommand(scriptRow, input) {
  const runner = String(scriptRow.runner || 'bash').toLowerCase();
  const path = String(scriptRow.path || '').trim();
  const body = String(scriptRow.body || '').trim();
  const flat = flattenInput(input);
  const vars = { ...flat, slug: scriptRow.slug, path };

  if (body) {
    const rendered = templateString(body, vars);
    switch (runner) {
      case 'bash':
        return { command: rendered, runner: 'bash' };
      case 'npm':
        return { command: rendered.startsWith('npm ') ? rendered : `npm ${rendered}`, runner: 'npm' };
      case 'node':
        return {
          command: rendered.includes('\n') ? `node -e ${JSON.stringify(rendered)}` : `node ${rendered}`,
          runner: 'node',
        };
      case 'python':
        return {
          command: rendered.includes('\n') ? `python3 -c ${JSON.stringify(rendered)}` : `python3 ${rendered}`,
          runner: 'python',
        };
      case 'wrangler':
        return {
          command: rendered.startsWith('wrangler ') ? rendered : `wrangler ${rendered}`,
          runner: 'wrangler',
        };
      case 'sql': {
        const sql = rendered.trim();
        return { command: sql, runner: 'sql', sql };
      }
      default:
        return { command: rendered, runner };
    }
  }

  if (!path) {
    return { error: 'agentsam_scripts row has no body or path' };
  }

  const renderedPath = templateString(path, vars);
  switch (runner) {
    case 'bash':
      return { command: `bash ${JSON.stringify(renderedPath)}`, runner: 'bash' };
    case 'npm':
      return { command: `npm --prefix . run ${JSON.stringify(renderedPath)}`, runner: 'npm' };
    case 'node':
      return { command: `node ${JSON.stringify(renderedPath)}`, runner: 'node' };
    case 'python':
      return { command: `python3 ${JSON.stringify(renderedPath)}`, runner: 'python' };
    case 'wrangler':
      return { command: `wrangler ${renderedPath}`, runner: 'wrangler' };
    case 'sql':
      return { command: renderedPath, runner: 'sql', sql: renderedPath };
    default:
      return { command: `${runner} ${JSON.stringify(renderedPath)}`, runner };
  }
}

/**
 * Run command via platform PTY HTTP API (generic shell — not a catalog tool_key).
 * @param {any} env
 * @param {{ command: string, session_id?: string | null }} opts
 */
async function runShellViaPty(env, opts) {
  const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
  const headers = { 'Content-Type': 'application/json' };
  const bridge = resolveOutboundBridgeKey(env);
  if (bridge) headers.Authorization = `Bearer ${bridge}`;

  const res = await fetch(`${origin}/api/agent/terminal/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      command: opts.command,
      session_id: opts.session_id ?? env.PTY_SESSION_ID ?? null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error || `PTY HTTP ${res.status}`, output: data };
  }
  return { ok: true, output: data };
}

/**
 * @param {any} env
 * @param {{ command: string, sql?: string }} built
 */
async function runScriptBuilt(env, built) {
  if (built.runner === 'sql' && built.sql) {
    if (!env?.DB) return { ok: false, error: 'DB binding unavailable for sql runner' };
    try {
      const sql = String(built.sql).trim();
      if (/^\s*select\b/i.test(sql)) {
        const { results } = await env.DB.prepare(sql).all();
        return { ok: true, output: { rows: results, row_count: results?.length ?? 0 } };
      }
      const runRes = await env.DB.prepare(sql).run();
      return {
        ok: true,
        output: { changes: runRes?.meta?.changes ?? 0 },
      };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }
  return runShellViaPty(env, { command: built.command });
}

/**
 * @param {any} env
 * @param {{ scriptSlug: string, workspaceId?: string | null, tenantId?: string | null, userId?: string | null, triggerSource?: string, smoke?: boolean }} opts
 * @param {unknown} input
 * @param {Record<string, unknown>} [runContext]
 */
export async function executeAgentsamScript(env, opts, input, runContext = {}) {
  const scriptSlug = String(opts?.scriptSlug || '').trim();
  if (!scriptSlug) {
    return { ok: false, error: 'script executor missing script_slug in handler_config_json' };
  }

  if (opts?.smoke || runContext?.smoke) {
    return { ok: true, output: { smoke: true, skipped: true, script_slug: scriptSlug } };
  }

  const workspaceId =
    opts.workspaceId ??
    runContext?.workspaceId ??
    runContext?.runMeta?.workspaceId ??
    runContext?.workspace_id ??
    null;
  const tenantId =
    opts.tenantId ?? runContext?.tenantId ?? runContext?.runMeta?.tenantId ?? runContext?.tenant_id ?? null;
  const userId =
    opts.userId ?? runContext?.userId ?? runContext?.runMeta?.userId ?? runContext?.canonicalUserId ?? null;

  const scriptRow = await loadAgentsamScriptBySlug(env, scriptSlug, workspaceId);
  if (!scriptRow) {
    return { ok: false, error: `agentsam_scripts not found for slug=${scriptSlug}` };
  }

  if (Number(scriptRow.safe_to_run) !== 1) {
    return {
      ok: false,
      error: `script slug=${scriptSlug} is not safe_to_run (approval may be required)`,
      script_id: scriptRow.id,
    };
  }

  const built = buildScriptCommand(scriptRow, input);
  if (built.error) {
    return { ok: false, error: built.error, script_id: scriptRow.id, script_slug: scriptSlug };
  }

  const started = Date.now();
  const runMeta = await startAgentsamScriptRun(env.DB, {
    scriptId: String(scriptRow.id),
    workspaceId: String(workspaceId || scriptRow.workspace_id || ''),
    tenantId,
    userId,
    triggerSource: opts.triggerSource || 'agent_sam',
  });

  const execOut = await runScriptBuilt(env, built);
  const durationMs = Date.now() - started;

  if (runMeta?.id) {
    await finalizeAgentsamScriptRun(
      env.DB,
      runMeta.id,
      {
        status: execOut.ok ? 'passed' : 'failed',
        durationMs,
        outputSummary: execOut.ok
          ? JSON.stringify(execOut.output || {}).slice(0, 500)
          : null,
        errorMessage: execOut.ok ? null : String(execOut.error || 'script_failed').slice(0, 500),
      },
      {
        scriptId: String(scriptRow.id),
        workspaceId: String(workspaceId || scriptRow.workspace_id || ''),
        tenantId,
        userId,
      },
    );
  }

  if (!execOut.ok) {
    return {
      ok: false,
      error: execOut.error,
      script_id: scriptRow.id,
      script_slug: scriptSlug,
      runner: built.runner,
    };
  }

  return {
    ok: true,
    output: {
      script_id: scriptRow.id,
      script_slug: scriptSlug,
      runner: built.runner,
      result: execOut.output,
    },
  };
}
