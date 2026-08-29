import { runTerminalCommandViaHttpExec, probeVmTerminalViaVpc } from '../terminal/vm-http-exec.js';
import type { Env } from '../../src/env';

type TerminalConnection = {
  id?: string;
  name?: string;
  remote_exec_user?: string;
  username?: string;
  privileged_target_id?: string | null;
};

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function defaultHome(execUser: string): string {
  return execUser === 'root' ? '/root' : `/home/${execUser}`;
}

const BLOCKED_COMMANDS = [
  /(^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i,
  /(^|[;&|]\s*)(?:shutdown|reboot|halt|poweroff)\b/i,
  /(^|[;&|]\s*)mkfs(?:\.|\s)/i,
  /(^|[;&|]\s*)dd\s+[^\n]*\bof=\/dev\//i,
];

export function commandIsBlocked(command: string): boolean {
  return BLOCKED_COMMANDS.some((pattern) => pattern.test(command));
}

export async function resolveDefaultVmConnection(env: Env): Promise<TerminalConnection | null> {
  try {
    const row = await env.DB.prepare(`
      SELECT id, name, remote_exec_user, username, privileged_target_id
      FROM terminal_connections
      WHERE target_type = 'platform_vm' AND is_active = 1
      ORDER BY is_default DESC, target_priority ASC, updated_at DESC
      LIMIT 1
    `).first<TerminalConnection>();
    return row || null;
  } catch (error) {
    console.warn('[host-exec] terminal connection lookup failed', error);
    return null;
  }
}

export async function getHostExecStatus(env: Env) {
  const connection = await resolveDefaultVmConnection(env);
  const health = await probeVmTerminalViaVpc(env);
  const execUser = trim(connection?.remote_exec_user || connection?.username);
  return {
    ok: Boolean(connection && health.ok),
    lane: 'execos_vm',
    connection: connection ? {
      name: trim(connection.name) || 'ExecOS VM',
      ready: health.ok,
      defaultCwd: execUser ? defaultHome(execUser) : null,
    } : null,
    health: health.ok ? 'ready' : 'unavailable',
  };
}

export async function executeOnDefaultVm(
  env: Env,
  command: string,
  options: { cwd?: string; userId?: string; tenantId?: string; workspaceId?: string } = {},
) {
  const cmd = trim(command);
  if (!cmd) return { ok: false, error: 'command_required', exitCode: 1, text: 'command_required' };
  if (cmd.length > 24_000) return { ok: false, error: 'command_too_large', exitCode: 1, text: 'command_too_large' };
  if (commandIsBlocked(cmd)) return { ok: false, error: 'command_blocked', exitCode: 1, text: 'Command blocked by AgentSamRemix host guard.' };

  const connection = await resolveDefaultVmConnection(env);
  if (!connection) return { ok: false, error: 'execos_vm_unavailable', exitCode: 1, text: 'No active platform VM connection.' };

  const execUser = trim(connection.remote_exec_user || connection.username);
  if (!execUser) return { ok: false, error: 'exec_identity_missing', exitCode: 1, text: 'ExecOS identity is not configured.' };

  const cwd = trim(options.cwd) || defaultHome(execUser);
  return runTerminalCommandViaHttpExec(env, cmd, {
    cwd,
    execIdentity: execUser,
    privilegedTargetId: trim(connection.privileged_target_id),
    userId: trim(options.userId),
    tenantId: trim(options.tenantId),
    workspaceId: trim(options.workspaceId),
    execActor: 'agentsamremix',
  });
}
