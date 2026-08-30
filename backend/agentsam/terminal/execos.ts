import type { Env } from '../../src/env';
import type { TerminalConnection } from './registry';

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function bridgeKey(env: Env): string {
  return trim(env.AGENTSAM_BRIDGE_KEY);
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
    const targets = Array.isArray(data?.targets) ? data.targets : [];
    return {
      ok: response.ok && data?.status === 'ok',
      status: response.status,
      service: data?.service || null,
      targets,
      localConfigured: Boolean(data?.local_exec_url),
      remoteConfigured: Boolean(data?.remote_exec_url),
      environmentConfigured: Boolean(data?.environment_controller && targets.includes('environment')),
      keySet: Boolean(data?.key_set),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'execos_unreachable' };
  }
}

export async function callExecOS(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
) {
  const key = bridgeKey(env);
  if (!env.EXECOS?.fetch) {
    return { ok: false, status: 503, data: { ok: false, error: 'execos_binding_missing' } };
  }
  if (!key) {
    return { ok: false, status: 503, data: { ok: false, error: 'bridge_key_missing' } };
  }
  try {
    const response = await env.EXECOS.fetch(new Request(`https://execos.internal${path}`, {
      method: init.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Key': key,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs || 310_000),
    }));
    const data = await response.json().catch(() => ({})) as any;
    return { ok: response.ok && data?.ok !== false, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      data: {
        ok: false,
        error: 'execos_service_unreachable',
        detail: error instanceof Error ? error.message : 'execos_service_unreachable',
      },
    };
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-IAM-Exec-Identity': 'agentsam',
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
  // The permanent VM is a first-class Cloudflare VPC binding in Remix. Use it
  // directly instead of adding an ExecOS hop that can independently be down or
  // misconfigured. ExecOS remains the authority for local and a fallback when
  // the VPC binding is absent.
  if (input.lane === 'remote' && env.PTY_SERVICE?.fetch) {
    return executeViaVPC(env, input.command, input.cwd, input.connection, input);
  }

  const target = input.lane === 'local' ? 'local' : 'remote';
  const result = await callExecOS(env, '/run', {
    method: 'POST',
    timeoutMs: 120_000,
    body: {
      command: input.command,
      target,
      cwd: input.cwd,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      tenant_id: input.tenantId || undefined,
    },
  });

  if (result.ok || result.data?.exit_code !== undefined) {
    const data = result.data;
    const exitCode = Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : result.ok ? 0 : 1;
    return {
      ok: result.ok && exitCode === 0,
      error: result.ok && exitCode === 0 ? null : trim(data?.error) || `execos_${result.status}`,
      exitCode,
      text: responseText(data) || trim(data?.user_message) || (result.ok ? '(no output)' : `execos_${result.status}`),
      stdout: typeof data?.stdout === 'string' ? data.stdout : '',
      stderr: typeof data?.stderr === 'string' ? data.stderr : '',
      transport: 'execos_service',
      target: data?.target || target,
      requestedLane: input.lane,
      resolvedLane: data?.resolved_lane || target,
      connectionId: input.connection.id,
      latencyMs: data?.latency_ms ?? null,
    };
  }

  if (input.lane === 'remote') {
    return executeViaVPC(env, input.command, input.cwd, input.connection, input);
  }
  return {
    ok: false,
    error: result.data?.error || 'execos_service_unreachable',
    exitCode: 1,
    text: result.data?.detail || result.data?.error || 'ExecOS service unavailable.',
    transport: 'none',
  };
}
