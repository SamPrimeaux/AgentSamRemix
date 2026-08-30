import type { Env } from '../../src/env';
import { executeViaExecOS, probeExecOS } from './execos';
import {
  defaultCwdForConnection,
  isExecLane,
  publicConnection,
  resolveTerminalConnection,
  resolveUserRuntimeScope,
  type ExecLane,
} from './registry';
import { executeInSandbox, sandboxStatus } from '../sandbox/runtime';
import {
  destroyEnvironment,
  environmentStatus,
  executeInEnvironment,
} from '../environment/runtime';

const BLOCKED_HOST_COMMANDS = [
  /(^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i,
  /(^|[;&|]\s*)(?:shutdown|reboot|halt|poweroff)\b/i,
  /(^|[;&|]\s*)mkfs(?:\.|\s)/i,
  /(^|[;&|]\s*)dd\s+[^\n]*\bof=\/dev\//i,
];

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function isBlockedHostCommand(command: string) {
  return BLOCKED_HOST_COMMANDS.some((pattern) => pattern.test(command));
}

export async function preferredExecLane(env: Env, userId: string, workspaceId: string): Promise<ExecLane> {
  const key = `asr:exec-lane:${userId}:${workspaceId}`;
  const cached = await env.SESSION_CACHE?.get(key).catch(() => null);
  if (isExecLane(cached)) return cached;
  // The VPC VM is platform infrastructure and requires no per-user connection
  // bootstrap. Local remains an explicit opt-in until the Remix local lane is
  // equally reliable.
  return env.PTY_SERVICE?.fetch ? 'remote' : 'local';
}

export async function rememberExecLane(env: Env, userId: string, workspaceId: string, lane: ExecLane) {
  if (!env.SESSION_CACHE) return;
  const key = `asr:exec-lane:${userId}:${workspaceId}`;
  await env.SESSION_CACHE.put(key, lane, { expirationTtl: 60 * 60 * 24 * 30 });
}

export async function terminalRuntimeStatus(
  env: Env,
  scope: { userId: string; workspaceId: string; tenantId?: string | null },
) {
  const [local, remote, sandbox, environment, execos] = await Promise.all([
    resolveTerminalConnection(env, { userId: scope.userId, workspaceId: scope.workspaceId, lane: 'local' }),
    resolveTerminalConnection(env, { userId: scope.userId, workspaceId: scope.workspaceId, lane: 'remote' }),
    resolveTerminalConnection(env, { userId: scope.userId, workspaceId: scope.workspaceId, lane: 'sandbox' }),
    resolveTerminalConnection(env, { userId: scope.userId, workspaceId: scope.workspaceId, lane: 'environment' }),
    probeExecOS(env),
  ]);
  const [preferredLane, currentEnvironment] = await Promise.all([
    preferredExecLane(env, scope.userId, scope.workspaceId),
    environment && execos.environmentConfigured
      ? environmentStatus(env, scope)
      : Promise.resolve({ ok: true, active: false, state: 'not_started', environmentId: null }),
  ]);
  const sb = sandboxStatus(env, scope);

  return {
    ok: Boolean(local || remote || sandbox || environment),
    preferredLane,
    execos,
    lanes: {
      local: {
        ok: Boolean(local && execos.ok && execos.localConfigured),
        state: local ? (execos.ok && execos.localConfigured ? 'ready' : 'offline') : 'not_registered',
        connection: publicConnection(local),
      },
      remote: {
        ok: Boolean(remote && ((execos.ok && execos.remoteConfigured) || env.PTY_SERVICE)),
        state: remote ? (((execos.ok && execos.remoteConfigured) || env.PTY_SERVICE) ? 'ready' : 'offline') : 'not_registered',
        connection: publicConnection(remote),
      },
      sandbox: {
        ok: Boolean(sandbox && sb.ok),
        state: sandbox && sb.ok ? sb.state : sandbox ? 'unavailable' : 'not_registered',
        connection: publicConnection(sandbox),
        environment: sb,
      },
      environment: {
        ok: Boolean(environment && execos.ok && execos.environmentConfigured),
        state: !environment
          ? 'not_registered'
          : !execos.environmentConfigured
            ? 'unavailable'
            : currentEnvironment.state || 'not_started',
        connection: publicConnection(environment),
        environment: currentEnvironment,
      },
    },
  };
}

export async function executeTerminalLane(
  env: Env,
  input: {
    lane: ExecLane;
    command: string;
    cwd?: string | null;
    userId: string;
    workspaceId: string;
    tenantId?: string | null;
    connectionId?: string | null;
  },
) {
  const command = trim(input.command);
  if (!command) return { ok: false, error: 'command_required', exitCode: 1, text: 'command_required' };
  if (command.length > 24_000) return { ok: false, error: 'command_too_large', exitCode: 1, text: 'command_too_large' };

  const connection = await resolveTerminalConnection(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    lane: input.lane,
    connectionId: input.connectionId,
  });
  if (!connection) {
    return {
      ok: false,
      error: 'terminal_connection_not_found',
      exitCode: 1,
      text: `No ${input.lane} terminal target is available for this request.`,
      lane: input.lane,
    };
  }

  const cwd = trim(input.cwd) || defaultCwdForConnection(connection);
  await rememberExecLane(env, input.userId, input.workspaceId, input.lane).catch(() => {});

  if (input.lane === 'sandbox') {
    const result = await executeInSandbox(env, { ...input, command, cwd });
    return { ...result, lane: input.lane, connection: publicConnection(connection) };
  }

  // Host-backed machines and the owned GCP environment keep the same hard
  // destructive-command guard. The Cloudflare Sandbox remains the disposable
  // experimentation lane with its own isolation boundary.
  if (isBlockedHostCommand(command)) {
    return {
      ok: false,
      error: 'command_blocked',
      exitCode: 1,
      text: 'Command blocked by AgentSamRemix execution guard.',
      lane: input.lane,
    };
  }

  if (input.lane === 'environment') {
    const result = await executeInEnvironment(env, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      command,
      cwd,
    });
    return { ...result, lane: input.lane, connection: publicConnection(connection), cwd };
  }

  const result = await executeViaExecOS(env, {
    lane: input.lane,
    command,
    cwd,
    connection,
    userId: input.userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
  });
  return { ...result, lane: input.lane, connection: publicConnection(connection), cwd };
}

export async function destroyTerminalEnvironment(
  env: Env,
  scope: { userId: string; workspaceId: string; tenantId?: string | null },
) {
  return destroyEnvironment(env, scope);
}

export async function scopeFromAgentName(env: Env, agentName: string) {
  const value = trim(agentName);
  const userId = value.startsWith('user-') ? value.slice(5) : '';
  if (!userId) return null;
  return resolveUserRuntimeScope(env, userId);
}
