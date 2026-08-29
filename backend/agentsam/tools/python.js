/**
 * agentsam_code_interpreter — isolated Python on MY_CONTAINER (sandbox).
 * Not GCP / PTY_SERVICE. Persistent engineering shell stays on agentsam_terminal_remote.
 */
import {
  CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
  tryContainerExec,
} from '../sandbox/my-container.js';

const DEFAULT_CWD = '/tmp/code_interpreter';

export const PYTHON_TOOLS = [
  {
    name: 'agentsam_code_interpreter',
    description: `Run short Python for math, stats, transforms, and plots on data ALREADY in this turn
(after agentsam_d1_query / fs_read_file / github read). Executes in an isolated CF Container
(MY_CONTAINER sandbox), not the GCP desk. Second step only — do not fetch data with this tool,
and do not use it for repo edits, deploys, or shell (use fs_*/agentsam_github_*/agentsam_terminal_*).
Scratch Python environment under /tmp/code_interpreter. Inline any D1/CSV payloads in the script.
Returns stdout, stderr, exit_code, lane=container.`,
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description:
            'Python source. Prefer one structured script. Inline prior tool results as literals.',
        },
        pip_install: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional pip packages before running, e.g. ["pandas","numpy"].',
        },
        working_dir: {
          type: 'string',
          description: `Optional cwd inside the sandbox (must stay under /tmp). Default ${DEFAULT_CWD}.`,
        },
        timeout_seconds: {
          type: 'number',
          description: 'Command budget in seconds (capped by container exec limits).',
        },
      },
      required: ['script'],
    },
  },
];

/** @param {string} raw */
function shellQuote(raw) {
  const s = String(raw || '');
  if (!/[\s'"$`\\]/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Only allow ephemeral paths under /tmp — never GCP home or workspace roots.
 * @param {unknown} dir
 */
export function resolveCodeInterpreterCwd(dir) {
  const s = String(dir || '').trim();
  if (!s) return DEFAULT_CWD;
  if (s.length > 256) return DEFAULT_CWD;
  if (/[^\w\-\/\.]/.test(s)) return DEFAULT_CWD;
  const cleaned = s.replace(/\/+/g, '/');
  if (cleaned === '/tmp' || cleaned.startsWith('/tmp/')) return cleaned.replace(/\/$/, '') || DEFAULT_CWD;
  return DEFAULT_CWD;
}

/**
 * @param {string[]} pip
 * @param {string} script
 * @param {string} cwd
 */
export function buildCodeInterpreterShellCommand(pip, script, cwd) {
  const parts = [`mkdir -p ${shellQuote(cwd)}`, `cd ${shellQuote(cwd)}`];
  if (pip.length > 0) {
    parts.push(`pip install --quiet ${pip.map((p) => shellQuote(p)).join(' ')}`);
  }
  parts.push(`python3 -c ${shellQuote(script)}`);
  return parts.join(' && ');
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 * @param {{ authUser?: unknown, signal?: AbortSignal|null } | null} [ctx]
 */
export async function python_execute(params, env, ctx = null) {
  const script = params?.script;
  if (typeof script !== 'string' || !String(script).trim()) {
    return JSON.stringify({
      error: 'script is required',
      stdout: '',
      stderr: '',
      exit_code: 1,
      lane: 'container',
      ok: false,
    });
  }

  if (!env?.MY_CONTAINER) {
    return JSON.stringify({
      error: 'container_unbound',
      stdout: '',
      stderr: 'agentsam_code_interpreter requires MY_CONTAINER (sandbox unavailable)',
      exit_code: 1,
      lane: 'container',
      ok: false,
    });
  }

  const pipRaw = Array.isArray(params.pip_install) ? params.pip_install : [];
  const pip = pipRaw.map((p) => String(p || '').trim()).filter(Boolean);
  const cwd = resolveCodeInterpreterCwd(params.working_dir);
  const timeoutSec =
    params.timeout_seconds != null && Number.isFinite(Number(params.timeout_seconds))
      ? Number(params.timeout_seconds)
      : null;
  const timeoutMs =
    timeoutSec != null
      ? Math.min(Math.max(1_000, Math.floor(timeoutSec * 1000)), CONTAINER_EXEC_COMMAND_TIMEOUT_MS)
      : CONTAINER_EXEC_COMMAND_TIMEOUT_MS;

  const command = buildCodeInterpreterShellCommand(pip, String(script), cwd);
  const out = await tryContainerExec(env, {
    command,
    cwd,
    timeout_ms: timeoutMs,
    authUser: ctx?.authUser ?? null,
    signal: ctx?.signal ?? null,
    skip_wrangler_normalize: true,
  });

  const stdout = typeof out.stdout === 'string' ? out.stdout : '';
  const stderr = typeof out.stderr === 'string' ? out.stderr : String(out.error || '');
  const exitCode = Number.isFinite(Number(out.exit_code))
    ? Number(out.exit_code)
    : out.ok
      ? 0
      : 1;
  const ok = out.ok !== false && !out.error && exitCode === 0;

  return JSON.stringify({
    stdout,
    stderr,
    exit_code: exitCode,
    ok,
    lane: 'container',
    host_kind: 'cf_container',
    cwd,
    image: out.image ?? null,
    ...(ok
      ? {}
      : {
          error: out.error || `container_python_failed_${exitCode}`,
        }),
  });
}

export const handlers = {
  python_execute,
  agentsam_code_interpreter: python_execute,
};
