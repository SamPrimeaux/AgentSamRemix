/**
 * Canonical MCP terminal tool contracts (local vs remote).
 * Code wins at runtime; D1 agentsam_tools schemas kept in sync via migration.
 */
import { wranglerTerminalRecoveryHints } from './wrangler-terminal-guidance.js';
import { canonicalizeHostKind } from '../../backend/agentsam/terminal/terminal-binding.js';

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_TERMINAL_LOCAL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command on the signed-in user\'s own device (user_hosted_tunnel — Mac zsh, Windows PowerShell, etc.).',
    },
    path: {
      type: 'string',
      description:
        'Optional working directory on the user device. Honored as cwd unless command already starts with cd.',
    },
    execution_mode: {
      type: 'string',
      enum: ['pty', 'batch_exec'],
      default: 'pty',
      description: 'Use batch_exec for non-interactive jobs on the user-hosted tunnel; pty remains the default.',
    },
    background: {
      type: 'boolean',
      default: false,
      description: 'Submit as a durable background batch job and return job_id immediately. Agent-linked calls can resume automatically when the job finishes.',
    },
    idempotency_key: {
      type: 'string',
      description: 'Optional dedupe key. Agent runtime supplies one automatically for linked background tool calls.',
    },
    resume_policy: {
      type: 'string',
      enum: ['none', 'terminal', 'success', 'failure'],
      description: 'When a linked background job should resume the owning Agent Sam conversation.',
    },
    max_attempts: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Maximum batch job attempts. Transport-only retries are the default.',
    },
    retry_policy: {
      type: 'object',
      properties: {
        max_attempts: { type: 'integer', minimum: 1, maximum: 5 },
        base_delay_ms: { type: 'integer', minimum: 0, maximum: 30000 },
        transport_only: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Optional terminal job ids that must succeed before this background job starts.',
    },
    timeout_ms: {
      type: 'integer',
      description: 'Optional batch/command timeout in milliseconds.',
    },
  },
  required: ['command'],
  additionalProperties: false,
};

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_TERMINAL_REMOTE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command on the GCP cloud desk VM (terminal.inneranimalmedia.com). Use when Mac is asleep or working from phone/OAuth. Platform operators only.',
    },
    target_id: {
      type: 'string',
      description: 'Optional terminal_connections target id for this workspace.',
    },
    execution_mode: {
      type: 'string',
      enum: ['pty', 'batch_exec'],
      default: 'pty',
      description: 'Use batch_exec for non-interactive remote jobs; pty remains the default shell protocol.',
    },
    background: {
      type: 'boolean',
      default: false,
      description: 'Submit as a durable background batch job and return job_id immediately. Agent-linked calls can resume automatically when the job finishes.',
    },
    idempotency_key: {
      type: 'string',
      description: 'Optional dedupe key. Agent runtime supplies one automatically for linked background tool calls.',
    },
    resume_policy: {
      type: 'string',
      enum: ['none', 'terminal', 'success', 'failure'],
      description: 'When a linked background job should resume the owning Agent Sam conversation.',
    },
    max_attempts: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Maximum batch job attempts. Transport-only retries are the default.',
    },
    retry_policy: {
      type: 'object',
      properties: {
        max_attempts: { type: 'integer', minimum: 1, maximum: 5 },
        base_delay_ms: { type: 'integer', minimum: 0, maximum: 30000 },
        transport_only: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Optional terminal job ids that must succeed before this background job starts.',
    },
    timeout_ms: {
      type: 'integer',
      description: 'Optional batch/command timeout in milliseconds.',
    },
  },
  required: ['command'],
  additionalProperties: false,
};

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_TERMINAL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    cwd: { type: 'string', nullable: true },
    cwd_source: {
      type: 'string',
      enum: ['path', 'workspace_root', 'command_cd', 'pty_session_default'],
    },
    exit_code: { type: 'integer', nullable: true },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    output: { type: 'string', description: 'Alias of stdout for backward compatibility.' },
    command: { type: 'string' },
    protocol: { type: 'string', enum: ['pty', 'ssh', 'mcp', 'batch_exec'] },
    target_id: { type: 'string', nullable: true },
    target_type: { type: 'string', nullable: true },
    target_lane: { type: 'string', nullable: true },
    transport: { type: 'string', nullable: true },
    lifecycle: { type: 'string', nullable: true },
    cleanup: { type: 'object', nullable: true },
    instance_name: { type: 'string', nullable: true },
    background: { type: 'boolean' },
    accepted: { type: 'boolean' },
    job_id: { type: 'string', nullable: true },
    status: { type: 'string', nullable: true },
    deduped: { type: 'boolean' },
    dependencies: { type: 'array' },
    resume_policy: { type: 'string', nullable: true },
    recovery_hints: { type: 'array' },
  },
  additionalProperties: true,
};

/** @returns {Record<string, unknown>} */
export function agentsamTerminalLocalInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_TERMINAL_LOCAL_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_TERMINAL_LOCAL_INPUT_SCHEMA.properties },
    required: [...CANONICAL_AGENTSAM_TERMINAL_LOCAL_INPUT_SCHEMA.required],
  };
}

/**
 * Prefix a shell command with cd when callers pass an explicit working directory.
 * Skips when the command already starts with cd (caller owns cwd).
 * @param {string|null|undefined} path
 * @param {string} command
 */
export function wrapShellCommandWithPath(path, command) {
  const cmd = String(command || '').trim();
  const dir = String(path || '').trim();
  if (!cmd) return cmd;
  if (/^\s*cd\s+/i.test(cmd)) {
    // Caller owns cwd — still rewrite Mac /Users prefixes when we have a Linux root.
    if (dir && !dir.startsWith('/Users/') && !/^[A-Za-z]:\\/.test(dir)) {
      const m = cmd.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&\s*(.+)$/is);
      if (m) {
        const oldDir = String(m[1] || m[2] || m[3] || '').trim();
        const rest = String(m[4] || '').trim();
        if (
          oldDir.startsWith('/Users/') ||
          /^[A-Za-z]:\\/.test(oldDir) ||
          oldDir.startsWith('/Volumes/')
        ) {
          const quoted =
            dir.includes(' ') || dir.includes('$') ? `"${dir.replace(/"/g, '\\"')}"` : dir;
          return `cd ${quoted} && ${rest}`;
        }
      }
    }
    return cmd;
  }
  if (!dir) return cmd;
  const quoted = dir.includes(' ') || dir.includes('$') ? `"${dir.replace(/"/g, '\\"')}"` : dir;
  return `cd ${quoted} && ${cmd}`;
}

/** @returns {Record<string, unknown>} */
export function agentsamTerminalRemoteInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_TERMINAL_REMOTE_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_TERMINAL_REMOTE_INPUT_SCHEMA.properties },
    required: [...CANONICAL_AGENTSAM_TERMINAL_REMOTE_INPUT_SCHEMA.required],
  };
}

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_TERMINAL_SANDBOX_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command inside the MCP zone sandbox directory.',
    },
    zone_slug: {
      type: 'string',
      description: 'MCP zone: engineer, architect, cms, or specialist.',
    },
    language: {
      type: 'string',
      enum: ['shell', 'python', 'node'],
      default: 'shell',
    },
    path: {
      type: 'string',
      description: 'Optional subpath inside the zone root.',
    },
    execution_mode: {
      type: 'string',
      enum: ['pty', 'batch_exec'],
      default: 'pty',
      description: 'batch_exec uses the unified non-interactive runtime; pty keeps the normal persistent sandbox behavior.',
    },
    target_type: {
      type: 'string',
      enum: ['sandbox'],
      default: 'sandbox',
      description: 'Sandbox dock lane. Throwaway instances use lifecycle=ephemeral with execution_mode=batch_exec.',
    },
    lifecycle: {
      type: 'string',
      enum: ['durable', 'ephemeral'],
      default: 'durable',
      description: 'ephemeral spins a fresh container, runs the command, then destroys that instance. Requires execution_mode=batch_exec.',
    },
    background: {
      type: 'boolean',
      default: false,
      description: 'Submit as a durable background batch job and return job_id immediately. Agent-linked calls can resume automatically when the job finishes.',
    },
    idempotency_key: {
      type: 'string',
      description: 'Optional dedupe key. Agent runtime supplies one automatically for linked background tool calls.',
    },
    resume_policy: {
      type: 'string',
      enum: ['none', 'terminal', 'success', 'failure'],
      description: 'When a linked background job should resume the owning Agent Sam conversation.',
    },
    max_attempts: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Maximum batch job attempts. Transport-only retries are the default.',
    },
    retry_policy: {
      type: 'object',
      properties: {
        max_attempts: { type: 'integer', minimum: 1, maximum: 5 },
        base_delay_ms: { type: 'integer', minimum: 0, maximum: 30000 },
        transport_only: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Optional terminal job ids that must succeed before this background job starts.',
    },
    timeout_ms: {
      type: 'integer',
      description: 'Optional command timeout in milliseconds.',
    },
  },
  required: ['command'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamTerminalSandboxInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_TERMINAL_SANDBOX_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_TERMINAL_SANDBOX_INPUT_SCHEMA.properties },
    required: [...CANONICAL_AGENTSAM_TERMINAL_SANDBOX_INPUT_SCHEMA.required],
  };
}

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_CONTAINER_EXEC_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description:
        'Non-interactive shell command to run in the MY_CONTAINER cloud sandbox (Alpine Linux). Example: uname -a',
    },
    cwd: {
      type: 'string',
      description: 'Optional working directory inside the container (default /tmp).',
    },
    timeout_ms: {
      type: 'integer',
      description: 'Optional timeout in milliseconds.',
    },
  },
  required: ['command'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamContainerExecInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_CONTAINER_EXEC_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_CONTAINER_EXEC_INPUT_SCHEMA.properties },
    required: [...CANONICAL_AGENTSAM_CONTAINER_EXEC_INPUT_SCHEMA.required],
  };
}

/**
 * @param {Record<string, unknown>} params
 * @returns {string|null} error message when invalid
 */
export function assertTerminalLocalArgs(params) {
  if (params?.target_id != null && String(params.target_id).trim() !== '') {
    return 'terminal_local_does_not_accept_target_id: use agentsam_terminal_remote';
  }
  if (params?.targetId != null && String(params.targetId).trim() !== '') {
    return 'terminal_local_does_not_accept_targetId: use agentsam_terminal_remote';
  }
  return null;
}

/**
 * @param {string} command
 * @returns {string|null}
 */
export function inferCwdFromShellCommand(command) {
  const cmd = String(command || '').trim();
  const m = cmd.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (!m) return null;
  return String(m[1] || m[2] || m[3] || '').trim() || null;
}

/**
 * @param {{ stdout?: string, stderr?: string, exitCode?: number|null }} opts
 * @returns {{ code: string, action: string }[]}
 */
function isSpawnEnoent(exitCode) {
  const c = exitCode == null ? '' : String(exitCode).trim().toUpperCase();
  return c === 'ENOENT' || c === 'ENOTDIR' || c === 'EACCES';
}

export function terminalRecoveryHints(opts = {}) {
  const text = `${opts.stdout ?? ''}\n${opts.stderr ?? ''}`;
  const hints = [];

  if (isSpawnEnoent(opts.exitCode) || /\bENOENT\b/i.test(text)) {
    hints.push({
      code: 'exec_spawn_enoent',
      action:
        'Spawn failed before the shell ran (often a Mac cwd on Linux). Ensure vm_workspace_root is set for this workspace, or use agentsam_github_commit_tree / agentsam_terminal_sandbox.',
    });
  }

  if (
    /Permission to .+ denied|fatal: unable to access 'https:\/\/github\.com|returned error: 403/i.test(
      text,
    )
  ) {
    hints.push({
      code: 'git_https_push_denied',
      action:
        'Push failed over HTTPS. When SSH is authorized, set origin to git@github.com:OWNER/REPO.git and retry git push.',
    });
  }

  if (
    /Cannot find native binding|Cannot find module '@rolldown\/binding|optional dependency/i.test(
      text,
    )
  ) {
    hints.push({
      code: 'node_optional_binding_missing',
      action: 'Run npm i then npm run build before changing application source code.',
    });
  }

  if (opts.exitCode != null && opts.exitCode !== 0 && hints.length === 0) {
    void opts.exitCode;
  }

  hints.push(...wranglerTerminalRecoveryHints(opts));

  return hints;
}

/**
 * @param {{
 *   explicitPath?: string|null,
 *   workspaceRoot?: string|null,
 *   executedCommand?: string,
 *   stdout?: string,
 *   stderr?: string,
 *   exitCode?: number|null,
 *   status?: string,
 * }} ctx
 */
export function buildTerminalToolResponseBody(ctx) {
  const explicitPath = String(ctx.explicitPath || '').trim();
  const workspaceRoot = String(ctx.workspaceRoot || '').trim();
  const executedCommand = String(ctx.executedCommand || '').trim();
  const stdout = typeof ctx.stdout === 'string' ? ctx.stdout : '';
  let stderr = typeof ctx.stderr === 'string' ? ctx.stderr : '';
  const exitCode = ctx.exitCode ?? null;
  const spawnFailed = isSpawnEnoent(exitCode);
  if (spawnFailed && !stderr) {
    stderr = `exec_spawn_failed:${String(exitCode)} — process never started (cwd or shell binary missing on host)`;
  }
  const ok =
    !spawnFailed && (exitCode == null || exitCode === 0 || exitCode === '0');

  let cwd = explicitPath || workspaceRoot || inferCwdFromShellCommand(executedCommand) || null;
  let cwd_source = 'pty_session_default';
  if (explicitPath) cwd_source = 'path';
  else if (workspaceRoot) cwd_source = 'workspace_root';
  else if (inferCwdFromShellCommand(executedCommand)) cwd_source = 'command_cd';

  const recovery_hints = terminalRecoveryHints({ stdout, stderr, exitCode });

  return {
    ok,
    cwd,
    cwd_source,
    exit_code: exitCode,
    stdout,
    stderr,
    output: stdout,
    command: executedCommand,
    status: spawnFailed ? 'error' : ok ? (ctx.status === 'error' ? 'error' : 'success') : 'error',
    ...(spawnFailed ? { error: 'exec_spawn_failed', exec_error: String(exitCode) } : {}),
    ...(recovery_hints.length ? { recovery_hints } : {}),
  };
}

const HOST_RECEIPT_KEYS = [
  'hostname',
  'os',
  'effective_username',
  'effective_uid',
  'effective_home',
  'daemon_username',
  'cwd',
  'cwd_source',
  'repo_root',
  'git_branch',
  'worktree_path',
  'exit_code',
  'failure_class',
  'transport_ok',
  'shell_ok',
  'requested_lane',
  'resolved_lane',
  'lane_substituted',
  'connection_target',
  'host_kind',
  'target',
];

export function mergeHostExecutionReceipt(body, host) {
  const out = { ...(body && typeof body === 'object' ? body : {}) };
  if (!host || typeof host !== 'object') {
    if (out.lane_substituted == null) out.lane_substituted = false;
    return out;
  }
  for (const key of HOST_RECEIPT_KEYS) {
    if (host[key] !== undefined && host[key] !== null && host[key] !== '') {
      if (key === 'host_kind') {
        const kind = canonicalizeHostKind(host[key]);
        if (kind) out[key] = kind;
        continue;
      }
      out[key] = host[key];
    }
  }
  if (out.lane_substituted == null) out.lane_substituted = false;
  return out;
}

export function laneFromTerminalToolKey(toolKey) {
  const tk = String(toolKey || '').trim();
  if (tk === 'agentsam_terminal_local') return 'local';
  if (tk === 'agentsam_terminal_remote') return 'remote';
  if (tk === 'agentsam_terminal_sandbox') return 'sandbox';
  return null;
}

export function normalizeExecutionLane(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (/^(local|mac|user_hosted_tunnel|user_local|user_hosted)$/.test(s) || s.includes('localpty')) return 'local';
  // mac/gcp here are hop/lane aliases, not host_kind (host_kind is darwin|linux).
  if (/^(remote|gcp|platform_vm|iam-tunnel|iam_tunnel)$/.test(s)) return 'remote';
  if (/^(sandbox|container)$/.test(s)) return 'sandbox';
  return s;
}

export function laneSubstitutionError(requested, resolved) {
  const req = normalizeExecutionLane(requested) || String(requested || '').trim();
  const res = normalizeExecutionLane(resolved) || String(resolved || '').trim();
  if (!req || !res || req === res) return null;
  return {
    ok: false,
    error: 'lane_substituted_forbidden',
    requested_lane: req,
    resolved_lane: res,
    lane_substituted: false,
    user_message: `Requested ${req} but execution resolved ${res}. Command was not accepted as a successful ${req} run.`,
  };
}
