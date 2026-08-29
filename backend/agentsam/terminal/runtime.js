import { resolveTerminalWorkspaceId } from '../../identity/bootstrap.js';
import { resolvePtyTenantIdForUser } from './pty-workspace-paths.js';
import { resolveControlPlaneAuthUser, runTerminalCommandViaControlPlane } from './control-plane.js';
import { writeTerminalHistory } from './history-d1.js';
import { normalizeTerminalExecutionResult } from './execution-result.js';
import { resolveTerminalTargetCandidates } from './fallback.js';

/**
 * Primary Execution Orchestrator — hard-bind one target, execute once via control plane.
 * AUTO picks a single lane; FALLBACK / ambient HTTP exec are prohibited.
 */
export async function runTerminalCommand(env, request, command, sessionId = null, executionCtx = null) {
  const cmd = typeof command === 'string' ? command.trim() : '';
  const ctx = executionCtx && typeof executionCtx === 'object' ? { ...executionCtx } : {};

  const mode = String(ctx.execution_mode || 'pty').toLowerCase();
  let requestedType;
  try {
    const { requireTerminalTargetType } = await import('./execution-lane.js');
    requestedType = requireTerminalTargetType(ctx.target_type || ctx.targetType);
  } catch (e) {
    throw new Error(e?.code || e?.message || 'target_type_required');
  }
  const pinnedId = String(ctx.connection_id || ctx.target_id || ctx.ssh_target_id || '').trim() || null;

  let candidateUserId = String(ctx.user_id || ctx.userId || '').trim();
  let candidateWorkspaceId = String(ctx.workspace_id || ctx.workspaceId || '').trim();
  let candidateTenantId = String(ctx.tenant_id || ctx.tenantId || '').trim();
  if (!candidateUserId || !candidateWorkspaceId || !candidateTenantId) {
    try {
      const authUser = await resolveControlPlaneAuthUser(env, request, ctx);
      if (!candidateUserId && authUser?.id) candidateUserId = String(authUser.id).trim();
      if (authUser?.id) {
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, candidateWorkspaceId || null);
        if (!candidateWorkspaceId && tw?.workspaceId) candidateWorkspaceId = String(tw.workspaceId).trim();
        if (!candidateTenantId) {
          candidateTenantId = String(
            (await resolvePtyTenantIdForUser(env, authUser, candidateUserId).catch(() => '')) || '',
          ).trim();
        }
      }
    } catch {}
  }

  const laneCandidates = await resolveTerminalTargetCandidates(env, {
    requestedType,
    pinnedId,
    userId: candidateUserId,
    workspaceId: candidateWorkspaceId,
    tenantId: candidateTenantId,
  });
  const lane = laneCandidates[0] || null;
  if (!lane) {
    throw new Error('terminal target unresolved');
  }

  const tryExtra = {
    ...ctx,
    target_type: lane.target_type || requestedType,
    target_id: lane.target_id || pinnedId || null,
    connection_id: lane.target_id || pinnedId || null,
  };
  const controlTry = await runTerminalCommandViaControlPlane(env, request, cmd, mode, tryExtra);
  const attempts = [
    {
      connection_id: lane.target_id || null,
      target_type: lane.target_type || null,
      ok: controlTry.ok === true,
      error: controlTry.error || null,
    },
  ];

  if (controlTry.ok === true) {
    const cleanOutput = controlTry.text;
    const exitCode = controlTry.exitCode;
    await writeTerminalHistory(env, request, sessionId, cmd, cleanOutput, exitCode);
    const normalized = normalizeTerminalExecutionResult({
      ok: true,
      output: cleanOutput,
      command: cmd,
      exit_code: exitCode,
      target_id: controlTry.targetId || lane.target_id || null,
      target_type: controlTry.targetType || lane.target_type || null,
      target_lane: controlTry.targetLane || null,
      transport: controlTry.transport || null,
      lifecycle: controlTry.lifecycle || null,
      cleanup: controlTry.cleanup || null,
      instance_name: controlTry.instance_name || null,
      lane_attempts: attempts,
    }, { protocol: mode });
    return { ...normalized, exitCode: normalized.exit_code, targetId: normalized.target_id };
  }

  const hopErr = new Error(controlTry.error || `${mode} execution unavailable`);
  if (controlTry.failure_class) hopErr.failure_class = controlTry.failure_class;
  throw hopErr;
}
