/**
 * Sandbox/container transport — runner injected by composition (no backend import here).
 * Shared terminal-session must not import backend/; attach runMcpZoneSandboxCommand on plan/ctx.
 */
export const sandboxTerminalTransport = {
  name: 'container_exec',
  async execute(session, plan, ctx) {
    if (ctx.signal?.aborted) return { error: 'terminal_job_cancelled' };
    const run =
      (typeof ctx?.runMcpZoneSandboxCommand === 'function' && ctx.runMcpZoneSandboxCommand) ||
      (typeof plan?.runMcpZoneSandboxCommand === 'function' && plan.runMcpZoneSandboxCommand) ||
      (typeof session?.runMcpZoneSandboxCommand === 'function' && session.runMcpZoneSandboxCommand);
    if (typeof run !== 'function') {
      return {
        error:
          'sandbox_runner_unavailable — composition must attach runMcpZoneSandboxCommand on plan/ctx',
      };
    }
    const result = await run(session.env, null, {
      command: ctx.command,
      tenantId: plan.tenant_id,
      userId: plan.user_id,
      workspaceId: plan.workspace_id,
      sessionId: await session.getOrCreateTerminalSessionId().catch(() => null),
      config: { target_type: 'container' },
      language: 'shell',
      signal: ctx.signal ?? null,
      recordPatchSession: false,
    });
    if (ctx.signal?.aborted) return { error: 'terminal_job_cancelled' };
    const body = result?.body || {};
    if (!result?.ok) {
      return { error: result?.error || body?.stderr || 'sandbox execution failed' };
    }
    const output = String(body.output ?? body.stdout ?? '').trim() || '(no output)';
    return { output, exit_code: body.exit_code ?? 0, sandbox: body };
  },
};
