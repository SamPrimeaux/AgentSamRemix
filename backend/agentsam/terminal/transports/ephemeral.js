export const ephemeralContainerTransport = {
  name: 'sandbox_ephemeral',
  async execute(session, plan, ctx) {
    const { tryEphemeralContainerExec } = await import('../../sandbox/my-container.js');
    const result = await tryEphemeralContainerExec(session.env, {
      command: ctx.command,
      cwd: ctx.payload?.cwd || plan.cwd || '/tmp',
      timeout_ms: ctx.timeout_ms,
      authUser: ctx.authUser ?? null,
      signal: ctx.signal ?? null,
      instance_name: ctx.instance_name ?? null,
    });
    if (result?.ok === false || result?.error) {
      return {
        error: result?.error || 'ephemeral container execution failed',
        cleanup: result?.cleanup || null,
        instance_name: result?.instance_name || null,
      };
    }
    const stdout = String(result?.stdout ?? result?.output ?? '');
    const stderr = String(result?.stderr ?? '');
    return {
      output: `${stdout}${stderr ? `\n${stderr}` : ''}`.trim() || '(no output)',
      stdout,
      stderr,
      exit_code: result?.exit_code ?? 0,
      cleanup: result?.cleanup || null,
      instance_name: result?.instance_name || null,
      lifecycle: 'ephemeral',
    };
  },
};
