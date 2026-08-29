import { runTerminalCommandViaHttpExec } from '../vm-http-exec.js';

/**
 * VM (platform_vm) one-shot transport — GCP only via vm-http-exec.
 * No cross-lane fallback.
 */
export const remoteTerminalTransport = {
  name: 'platform_vm',
  async execute(session, plan, ctx) {
    const cmd = String(ctx.payload?.command || ctx.command || '').trim();
    const cwd = String(ctx.payload?.cwd || plan.cwd || '').trim();
    const r = await runTerminalCommandViaHttpExec(session.env, cmd, {
      cwd,
      userId: plan.user_id,
      workspaceId: plan.workspace_id,
      connection: plan.connection,
      execUser: ctx.execUser ?? null,
      transportExecUser: ctx.transportExecUser ?? null,
      privilegedTargetId: ctx.privilegedTargetId ?? null,
      isTunnelOwner: ctx.isTunnelOwner === true,
      headers: ctx.headers ?? null,
    });
    if (!r.ok) {
      return { error: r.error || r.text || 'vm_exec_failed' };
    }
    return { output: r.text || '(no output)', exit_code: r.exitCode ?? 0 };
  },
};
