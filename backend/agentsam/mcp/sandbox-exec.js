/**
 * MCP zone sandbox execution for agentsam_terminal_sandbox.
 * Container-only via MY_CONTAINER (tryContainerExec).
 *
 * Residual src/core deps (my-container, fuse cwd, github git helper, terminal contract)
 * stay until those domains peel — do not reclassify callers to hide this.
 */
import {
  CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
  tryContainerExec,
} from '../sandbox/my-container.js';
import {
  buildTerminalToolResponseBody,
  terminalRecoveryHints,
} from '../../../src/core/mcp-terminal-contract.js';
import { normalizeMcpZoneSlug, resolveMcpZoneConversationId } from './zone-contract.js';
import { resolveSandboxContainerSlug, recordMcpZonePatchSession } from './zone-operations.js';

/** @param {string} raw */
function shellQuote(raw) {
  const s = String(raw || '');
  if (!/[\s'"$`\\]/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {any} env
 * @param {Request|null|undefined} request
 * @param {{
 *   command: string,
 *   zoneSlug?: string,
 *   tenantId?: string,
 *   userId?: string,
 *   workspaceId?: string,
 *   sessionId?: string|null,
 *   config?: Record<string, unknown>,
 *   language?: string,
 *   path?: string,
 *   timeout_ms?: number,
 *   authUser?: { role?: string }|null,
 *   signal?: AbortSignal|null,
 *   agentRunId?: string|null,
 *   modelKey?: string|null,
 *   ctx?: any,
 *   recordPatchSession?: boolean,
 * }} opts
 */
export async function runMcpZoneSandboxCommand(env, request, opts) {
  void request;
  const command = String(opts.command || '').trim();
  if (!command) {
    return { ok: false, error: 'command required' };
  }

  if (!env?.MY_CONTAINER) {
    return {
      ok: false,
      error: 'container_unbound',
      body: {
        user_message: 'Sandbox lane requires MY_CONTAINER binding (sandbox_unavailable).',
        lane: 'container',
        error: 'container_unbound',
      },
    };
  }

  const zoneSlug = await resolveSandboxContainerSlug(env, {
    zoneSlug: opts.zoneSlug,
    userId: opts.userId,
    username: opts.username,
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId,
  });

  const language = String(opts.language || 'shell').trim().toLowerCase();
  let runCmd = command;
  if (language === 'python') {
    runCmd = `python3 -c ${shellQuote(command)}`;
  } else if (language === 'node') {
    runCmd = `node -e ${shellQuote(command)}`;
  }

  const timeoutMs =
    opts.timeout_ms != null && Number.isFinite(Number(opts.timeout_ms))
      ? Number(opts.timeout_ms)
      : CONTAINER_EXEC_COMMAND_TIMEOUT_MS;

  const { resolveSandboxContainerCwd, buildSandboxExecShellPreamble } = await import(
    '../sandbox/r2-fuse-env.js'
  );
  const execCwd = await resolveSandboxContainerCwd(env, {
    workspaceId: opts.workspaceId,
    zoneSlug,
    innerPath: opts.path,
  });
  const preamble = buildSandboxExecShellPreamble(env, execCwd, zoneSlug);

  let gitPreamble = '';
  let gitMeta = null;
  try {
    const { resolveSandboxGithubGitPreamble } = await import(
      '../../../src/core/sandbox-github-git-helper.js'
    );
    gitMeta = await resolveSandboxGithubGitPreamble(env, {
      command: runCmd,
      userId: opts.userId,
      authUser: opts.authUser ?? null,
    });
    if (gitMeta?.applied && gitMeta.preamble) {
      gitPreamble = `${gitMeta.preamble}\n`;
    }
  } catch (e) {
    console.warn('[mcp/sandbox-exec] github git helper', e?.message ?? e);
  }

  const wrappedCmd = `${preamble} && ${gitPreamble}${runCmd}`;
  const containerOut = await tryContainerExec(env, {
    command: wrappedCmd,
    cwd: '/tmp',
    timeout_ms: timeoutMs,
    authUser: opts.authUser ?? null,
    signal: opts.signal ?? null,
  });

  if (containerOut.error === 'container_unbound') {
    return {
      ok: false,
      error: 'container_unbound',
      body: {
        user_message: 'Sandbox lane requires MY_CONTAINER binding (sandbox_unavailable).',
        zone_slug: zoneSlug,
        lane: 'container',
        error: 'container_unbound',
      },
    };
  }

  const stdout = String(containerOut.stdout ?? '');
  const stderr = String(containerOut.stderr ?? containerOut.error ?? '');
  const exitCode = containerOut.exit_code ?? (containerOut.ok ? 0 : 1);
  const body = buildTerminalToolResponseBody({
    explicitPath: opts.path,
    workspaceRoot: execCwd,
    executedCommand: gitPreamble
      ? `${preamble} && # iam-sandbox-github-git && ${runCmd}`
      : wrappedCmd,
    stdout,
    stderr,
    exitCode,
    status: containerOut.ok ? 'success' : 'error',
  });
  const gitRecovery =
    exitCode === 42
      ? [
          {
            code: 'git_author_missing',
            action:
              'Sandbox has no git author email for this user. Ensure auth_users.email is set, or commit from agentsam_terminal_remote (GCP).',
          },
        ]
      : exitCode === 43 || /IAM_GIT_ERR:github_token_missing/i.test(stderr)
        ? [
            {
              code: 'github_token_missing',
              action:
                'Reconnect GitHub under Keys & Secrets, then retry. For ship/push, prefer agentsam_terminal_remote on GCP (SSH already works).',
            },
          ]
        : [];
  const recoveryHints =
    containerOut.error === 'container_start_timeout'
      ? [
          {
            code: 'container_start_timeout',
            action:
              'CF Container pool failed to start (scheduler cold start). Use agentsam_terminal_remote for git/shell now; retry sandbox once the inneranimalmedia container is warm.',
          },
        ]
      : containerOut.guidance
        ? [
            {
              code: 'wrangler_auth_lane',
              action: String(containerOut.guidance.summary || containerOut.error || ''),
            },
            ...gitRecovery,
            ...terminalRecoveryHints({ stdout, stderr, exitCode, command: runCmd }),
          ]
        : [...gitRecovery, ...terminalRecoveryHints({ stdout, stderr, exitCode, command: runCmd })];

  const ok = containerOut.ok !== false && !containerOut.error;
  const result = {
    ok,
    error: containerOut.error || null,
    body: {
      ...body,
      zone_slug: zoneSlug,
      sandbox_root: execCwd,
      lane: 'container',
      image: containerOut.image ?? null,
      recovery_hints: recoveryHints,
      github_git: gitMeta?.applied
        ? {
            has_token: gitMeta.has_token === true,
            has_author: gitMeta.has_author === true,
            author_source: gitMeta.author_source || null,
            token_mode: gitMeta.token_mode || null,
          }
        : null,
    },
  };

  if (
    opts.recordPatchSession !== false &&
    opts.tenantId &&
    (opts.zoneSlug || zoneSlug)
  ) {
    try {
      void recordMcpZonePatchSession(env, opts.ctx ?? null, {
        zoneSlug: normalizeMcpZoneSlug(opts.zoneSlug || zoneSlug),
        tenantId: String(opts.tenantId),
        workspaceId: opts.workspaceId ?? null,
        agentRunId: opts.agentRunId != null ? String(opts.agentRunId) : null,
        conversationId:
          opts.sessionId ??
          resolveMcpZoneConversationId(opts.zoneSlug || zoneSlug, opts.tenantId),
        modelKey: opts.modelKey ?? null,
        taskFile: command.slice(0, 200),
        passed: ok && exitCode === 0 ? 1 : 0,
        applied: ok && exitCode === 0 ? 1 : 0,
        failReason: ok && exitCode === 0 ? null : result.error || 'sandbox_exit_nonzero',
      });
    } catch (e) {
      console.warn('[mcp/sandbox-exec] patch session', e?.message ?? e);
    }
  }

  return result;
}

export { normalizeMcpZoneSlug };
