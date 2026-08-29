import type { Env } from '../../src/env';
import type { ExecLane, TerminalConnection } from './registry';

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function execosKey(env: Env): string {
  return trim(env.EXECOS_KEY || env.AGENTSAM_BRIDGE_KEY);
}

function targetForLane(lane: ExecLane): 'local' | 'remote' {
  if (lane === 'local') return 'local';
  if (lane === 'remote') return 'remote';
  throw new Error('sandbox_is_not_execos_target');
}

function responseText(data: any): string {
  const stdout = typeof data?.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data?.stderr === 'string' ? data.stderr : '';
  if (stdout && stderr) return `${stdout}\n${stderr}`.trim();
  return (stdout || stderr || '').trim();
}

export async function probeExecOS(env: Env) {
  if (!env.EXECOS?.fetch) {
    return { ok: false, error: 'execos_binding_missing' };
  }
  try {
    const response = await env.EXECOS.fetch(new Request('https://execos.internal/health'));
    const data = await response.json().catch(() => null) as any;
    return {
      ok: response.ok && data?.status === 'ok',
      status: response.status,
      service: data?.service || null,
      targets: Array.isArray(data?.targets) ? data.targets : [],
      localConfigured: Boolean(data?.local_exec_url),
      remoteConfigured: Boolean(data?.remote_exec_url),
      keySet: Boolean(data?.key_set),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'execos_unreachable' };
  }
}

async function executeViaVPC(
  env: Env,
  command: string,
  cwd: string,
  connection: TerminalConnection,
  identity: { userId: string; workspaceId: string; tenantId?: string | null },
) {
  if (!env.PTY_SERVICE?.fetch) {
    return { ok: false, error: 'pty_service_binding_missing', exitCode: 1, text: 'PTY_SERVICE binding is not configured', transport: 'vpc' };
  }
  const daemonIdentity = 'agentsam';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-IAM-Exec-Identity': daemonIdentity,
    'X-IAM-Exec-Actor': 'agentsamremix',
    'X-User-Id': identity.userId,
    'X-Workspace-Id': identity.workspaceId,
  };
  if (identity.tenantId) headers['X-Tenant-Id'] = identity.tenantId;
  if (connection.privileged_target_id) headers['X-IAM-Privileged-Target'] = connection.privileged_target_id;

  try {
    const response = await env.PTY_SERVICE.fetch(new Request('http://pty-service/exec', {
      method: 'POST',
      headers,
      body: JSON.stringify({ command, cwd }),
    }));
    const data = await response.json().catch(() => ({})) as any;
    const exitCode = Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : response.ok ? 0 : 1;
    return {
      ok: response.ok && exitCode === 0,
      error: response.ok && exitCode === 0 ? null : trim(data?.error) || `vpc_exec_${response.status}`,
      exitCode,
      text: responseText(data) || trim(data?.user_message) || (response.ok ? '(no output)' : `vpc_exec_${response.status}`),
      stdout: typeof data?.stdout === 'string' ? data.stdout : '',
      stderr: typeof data?.stderr === 'string' ? data.stderr : '',
      transport: 'vpc',
      target: 'remote',
      connectionId: connection.id,
    };
  } catch (error) {
    return { ok: false, error: 'vpc_exec_unreachable', exitCode: 1, text: error instanceof Error ? error.message : 'vpc_exec_unreachable', transport: 'vpc' };
  }
}

export async function executeViaExecOS(
  env: Env,
  input: {
    lane: 'local' | 'remote';
    command: string;
    cwd: string;
    connection: TerminalConnection;
    userId: string;
    workspaceId: string;
    tenantId?: string | null;
  },
) {
  const key = execosKey(env);
  if (env.EXECOS?.fetch && key) {
    const target = targetForLane(input.lane);
    try {
      const response = await env.EXECOS.fetch(new Request('https://execos.internal/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ExecOS-Key': key,
          'X-User-Id': input.userId,
          'X-Workspace-Id': input.workspaceId,
          ...(input.tenantId ? { 'X-Tenant-Id': input.tenantId } : {}),
        },
        body: JSON.stringify({ command: input.command, target, cwd: input.cwd }),
        signal: AbortSignal.timeout(120_000),
      }));
      const data = await response.json().catch(() => ({})) as any;
      const exitCode = Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : response.ok ? 0 : 1;
      return {
        ok: response.ok && data?.ok !== false && exitCode === 0,
        error: response.ok && data?.ok !== false && exitCode === 0 ? null : trim(data?.error) || `execos_${response.status}`,
        exitCode,
        text: responseText(data) || trim(data?.user_message) || (response.ok ? '(no output)' : `execos_${response.status}`),
        stdout: typeof data?.stdout === 'string' ? data.stdout : '',
        stderr: typeof data?.stderr === 'string' ? data.stderr : '',
        transport: 'execos_service',
        target: data?.target || target,
        requestedLane: input.lane,
        resolvedLane: data?.exec_lane || target,
        connectionId: input.connection.id,
        latencyMs: data?.latency_ms ?? null,
      };
    } catch (error) {
      return { ok: false, error: 'execos_service_unreachable', exitCode: 1, text: error instanceof Error ? error.message : 'execos_service_unreachable', transport: 'execos_service' };
    }
  }

  // Only the permanent remote VM has an infrastructure VPC fallback. Local
  // must fail loud rather than silently executing on a different machine.
  if (input.lane === 'remote') {
    return executeViaVPC(env, input.command, input.cwd, input.connection, input);
  }
  return { ok: false, error: key ? 'execos_binding_missing' : 'execos_key_missing', exitCode: 1, text: key ? 'EXECOS service binding is not configured.' : 'EXECOS_KEY/AGENTSAM_BRIDGE_KEY is not configured.', transport: 'none' };
}
