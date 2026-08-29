/**
 * AgentSamRemix VM execution transport.
 *
 * Authority split:
 * - Worker authenticates the machine caller.
 * - IAM_VPC is the private Cloudflare transport to the VM service.
 * - terminal-daemon owns command guards, cwd validation, OS identity, and process execution.
 *
 * This module deliberately has no dependency on the larger InnerAnimalMedia terminal
 * routing graph. AgentSamRemix can grow those policies later without making the base
 * VPC path depend on copied, unresolved modules.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function jsonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

function responseText(data) {
  if (!data || typeof data !== 'object') return '';
  const stdout = typeof data.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data.stderr === 'string' ? data.stderr : '';
  return [stdout, stderr].filter(Boolean).join(stderr && stdout ? '\nSTDERR: ' : '').trim();
}

function vpcBinding(env) {
  const binding = env?.IAM_VPC;
  return binding && typeof binding.fetch === 'function' ? binding : null;
}

/**
 * Execute a single command on the VM terminal daemon through Cloudflare Workers VPC.
 * The daemon requires an explicit cwd and X-IAM-Exec-Identity and validates both.
 */
export async function runTerminalCommandViaHttpExec(env, command, opts = {}) {
  const binding = vpcBinding(env);
  if (!binding) {
    return {
      ok: false,
      error: 'iam_vpc_binding_missing',
      exitCode: 1,
      text: 'IAM_VPC binding is not configured',
    };
  }

  const cmd = trim(command);
  const cwd = trim(opts.cwd);
  const execIdentity = trim(opts.execIdentity);

  if (!cmd) return { ok: false, error: 'command_required', exitCode: 1, text: 'command_required' };
  if (!cwd) return { ok: false, error: 'cwd_required', exitCode: 1, text: 'cwd_required' };
  if (!execIdentity) {
    return {
      ok: false,
      error: 'exec_identity_required',
      exitCode: 1,
      text: 'X-IAM-Exec-Identity is required',
    };
  }

  const headers = jsonHeaders({
    'X-IAM-Exec-Identity': execIdentity,
    'X-IAM-Exec-Actor': trim(opts.execActor) || 'agentsamremix-worker',
  });

  const privilegedTarget = trim(opts.privilegedTargetId);
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = trim(opts.tenantId);
  if (privilegedTarget) headers['X-IAM-Privileged-Target'] = privilegedTarget;
  if (userId) headers['X-User-Id'] = userId;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  try {
    // With a VPC Service binding, the registered service determines the actual host/port.
    // The URL host is not used as a network target; it only supplies HTTP Host/SNI metadata.
    const response = await binding.fetch(
      new Request('http://iam-vpc/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({ command: cmd, cwd }),
      }),
    );

    const data = await response.json().catch(() => null);
    const text = responseText(data);
    const exitCode = Number.isFinite(Number(data?.exit_code)) ? Number(data.exit_code) : response.ok ? 0 : 1;

    if (!response.ok) {
      return {
        ok: false,
        error: trim(data?.error) || `vpc_exec_failed_${response.status}`,
        detail: trim(data?.user_message) || trim(data?.stderr) || null,
        exitCode,
        text: text || `vpc_exec_failed_${response.status}`,
        status: response.status,
        transport: 'vpc',
      };
    }

    return {
      ok: exitCode === 0,
      error: exitCode === 0 ? null : trim(data?.error) || 'command_failed',
      exitCode,
      text,
      stdout: typeof data?.stdout === 'string' ? data.stdout : '',
      stderr: typeof data?.stderr === 'string' ? data.stderr : '',
      transport: 'vpc',
    };
  } catch (error) {
    return {
      ok: false,
      error: 'vpc_exec_unreachable',
      exitCode: 1,
      text: error instanceof Error ? error.message : 'vpc_exec_unreachable',
      transport: 'vpc',
    };
  }
}

/** Basic daemon liveness probe through IAM_VPC. */
export async function probeVmTerminalViaVpc(env) {
  const binding = vpcBinding(env);
  if (!binding) return { ok: false, error: 'iam_vpc_binding_missing' };

  try {
    const response = await binding.fetch(new Request('http://iam-vpc/health'));
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok && data?.status === 'ok',
      status: response.status,
      transport: 'vpc',
      daemon: data,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'vpc_health_unreachable',
      transport: 'vpc',
    };
  }
}
