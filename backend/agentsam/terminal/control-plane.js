import { getAuthUser } from '../../../src/core/auth.js';
import { resolveTerminalWorkspaceId, WORKSPACE_CONTEXT_MISSING } from '../../identity/bootstrap.js';
import { resolvePtyTenantIdForUser } from './pty-workspace-paths.js';
import { resolveTerminalExecRoutingFromDb } from './routing-policy.js';
import { buildTerminalSessionDoName } from './session-name.js';

function trimId(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Prefer a caller-resolved identity (internal/MCP catalog) over session cookies.
 * Service-binding hops have no browser session; getAuthUser(request) would 401.
 * @param {any} env
 * @param {Request|null|undefined} request
 * @param {Record<string, unknown>} [extra]
 */
export async function resolveControlPlaneAuthUser(env, request, extra = {}) {
  const extraUser = extra.authUser && typeof extra.authUser === 'object' ? extra.authUser : extra.user;
  const extraId = trimId(extraUser?.id || extra.user_id || extra.userId);
  if (extraId) {
    if (extraUser?.id) return extraUser;
    return { id: extraId };
  }
  if (!request) return null;
  try {
    const fromRequest = await getAuthUser(request, env);
    return fromRequest?.id ? fromRequest : null;
  } catch {
    return null;
  }
}

export async function runTerminalCommandViaControlPlane(env, request, command, executionMode = 'pty', extra = {}) {
  if (!env?.AGENT_SESSION) return { ok: false };
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!cmd) return { ok: false, error: 'No command' };
  try {
    const authUser = await resolveControlPlaneAuthUser(env, request, extra);
    if (!authUser?.id) return { ok: false, error: 'Unauthorized' };
    const userId = String(authUser.id).trim();
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, extra.workspace_id);
    if (tw.error === 'Forbidden') return { ok: false, error: 'Forbidden' };
    if (tw.error || !tw.workspaceId) return { ok: false, error: WORKSPACE_CONTEXT_MISSING };
    const workspaceId = tw.workspaceId;
    const mode = ['pty', 'ssh', 'mcp', 'batch_exec'].includes(String(executionMode || '').toLowerCase())
      ? String(executionMode).toLowerCase()
      : 'pty';
    const doUrl = new URL('https://do.internal/terminal/exec');
    doUrl.searchParams.set('execution_mode', mode);
    doUrl.searchParams.set('workspace_id', workspaceId);
    doUrl.searchParams.set('user_id', userId);
    let tid = await resolvePtyTenantIdForUser(env, authUser, userId);
    tid = tid != null ? String(tid).trim() : '';
    if (!tid) return { ok: false, error: 'TENANT_CONTEXT_REQUIRED' };
    doUrl.searchParams.set('tenant_id', tid);
    const { userMayUsePrivilegedTerminal } = await import('../../identity/workspace/grants.js');
    const isOp = await userMayUsePrivilegedTerminal(env, { id: userId }, workspaceId);
    const routing = await resolveTerminalExecRoutingFromDb(env, {
      tool_name: extra.tool_name,
      target_id: extra.target_id || extra.ssh_target_id || extra.connection_id,
      target_type: extra.target_type,
      user_id: userId,
      mayUsePrivilegedTerminal: isOp,
    });
    const pinType = routing.target_type || extra.target_type || null;
    let sessionName;
    try {
      sessionName = buildTerminalSessionDoName({
        userId,
        workspaceId,
        executionMode: mode,
        targetType: pinType,
        plane: 'agent',
      });
    } catch (e) {
      return { ok: false, error: e?.code || e?.message || 'target_type_required' };
    }
    const doId = env.AGENT_SESSION.idFromName(sessionName);
    const stub = env.AGENT_SESSION.get(doId);
    const pinId = routing.target_id || extra.target_id || extra.connection_id || extra.ssh_target_id || null;
    if (pinType) doUrl.searchParams.set('target_type', String(pinType));
    if (pinId) doUrl.searchParams.set('connection_id', String(pinId));
    const puuid = authUser.person_uuid != null && String(authUser.person_uuid).trim() !== '' ? String(authUser.person_uuid).trim() : '';
    if (puuid) doUrl.searchParams.set('person_uuid', puuid);
    const resp = await stub.fetch(new Request(doUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        command: cmd,
        execution_mode: mode,
        workspace_id: workspaceId,
        target_id: pinId,
        target_type: pinType,
        connection_id: pinId,
        tool_name: extra.tool_name || null,
        ssh_target_id: extra.ssh_target_id || null,
        timeout_ms: extra.timeout_ms ?? null,
        params: extra.params || null,
      }),
    }));
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload?.ok === false) {
      return {
        ok: false,
        error: payload?.error || `control-plane ${resp.status}`,
        ...(payload?.failure_class ? { failure_class: payload.failure_class } : {}),
      };
    }
    return {
      ok: true,
      text: typeof payload?.output === 'string' ? payload.output : '',
      output: typeof payload?.output === 'string' ? payload.output : '',
      stdout: typeof payload?.stdout === 'string' ? payload.stdout : (typeof payload?.output === 'string' ? payload.output : ''),
      stderr: typeof payload?.stderr === 'string' ? payload.stderr : '',
      exitCode: payload?.exit_code ?? 0,
      exit_code: payload?.exit_code ?? 0,
      protocol: payload?.execution_mode ?? mode,
      toolName: payload?.tool_name ?? null,
      targetId: payload?.target_id ?? pinId ?? null,
      target_id: payload?.target_id ?? pinId ?? null,
      targetType: payload?.target_type ?? pinType ?? null,
      target_type: payload?.target_type ?? pinType ?? null,
      targetLane: payload?.target_lane ?? null,
      target_lane: payload?.target_lane ?? null,
      transport: payload?.transport ?? null,
      cwd: payload?.cwd ?? null,
      lifecycle: payload?.lifecycle ?? null,
      cleanup: payload?.cleanup ?? null,
      instance_name: payload?.instance_name ?? null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
