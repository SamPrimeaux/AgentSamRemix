/**
 * Submit an agent-linked terminal tool call as a durable background batch job.
 * Conversation/turn/tool identity comes from trusted runContext, never model input.
 */
export async function submitTerminalBackgroundJob(env, opts = {}) {
  if (!env?.AGENT_SESSION) return { ok: false, error: 'agent_session_binding_missing_for_background_job' };

  const params = opts.params || {};
  const runContext = opts.runContext || {};
  const toolKey = String(opts.terminalToolKey || '').trim();
  const command = String(opts.command || '').trim();
  const userId = String(opts.userId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : null;
  const conversationId = opts.conversationId != null ? String(opts.conversationId).trim() : '';
  const turnId = String(runContext.turnId ?? runContext.turn_id ?? '').trim() || null;
  const toolCallId = String(runContext.toolCallId ?? runContext.tool_call_id ?? '').trim() || null;
  const agentId = String(opts.agentId || '').trim() || null;

  const explicitTargetType = String(params.target_type || params.targetType || '').trim();
  const targetType = explicitTargetType ||
    (toolKey === 'agentsam_terminal_local'
      ? 'user_hosted_tunnel'
      : toolKey === 'agentsam_terminal_remote'
        ? 'platform_vm'
        : 'sandbox');
  const idempotencyKey = String(params.idempotency_key || params.idempotencyKey || '').trim() ||
    (conversationId && turnId && toolCallId ? `${conversationId}:${turnId}:${toolCallId}` : null);

  const stub = env.AGENT_SESSION.get(
    env.AGENT_SESSION.idFromName(`terminal:${userId}:${workspaceId}:batch_exec`),
  );
  const jobBody = {
    command,
    cwd: params.cwd ?? params.path ?? null,
    target_id: params.target_id ?? params.targetId ?? null,
    target_type: targetType,
    timeout_ms: params.timeout_ms ?? params.timeoutMs ?? null,
    user_id: userId,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    conversation_id: conversationId || null,
    turn_id: turnId,
    agent_id: agentId,
    tool_call_id: toolCallId,
    idempotency_key: idempotencyKey,
    resume_policy: params.resume_policy ?? params.resumePolicy ?? (conversationId && turnId ? 'terminal' : 'none'),
    retry_policy: params.retry_policy ?? params.retryPolicy ?? undefined,
    max_attempts: params.max_attempts ?? params.maxAttempts ?? undefined,
    depends_on: params.depends_on ?? params.dependencies ?? [],
  };

  const response = await stub.fetch(new Request('https://do/terminal/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobBody),
  }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    return { ok: false, error: data?.error || `terminal_job_submit_${response.status}` };
  }
  return {
    ok: true,
    body: {
      background: true,
      protocol: 'batch_exec',
      accepted: true,
      job_id: data?.job_id ?? data?.job?.job_id ?? null,
      status: data?.job?.status ?? data?.status ?? 'queued',
      deduped: data?.job?.deduped === true,
      target_type: data?.job?.target_type ?? targetType,
      dependencies: data?.job?.dependencies ?? [],
      resume_policy: data?.job?.resume_policy ?? jobBody.resume_policy,
      message: 'Background terminal job accepted. The agent turn can end; completion will resume the linked conversation when configured.',
    },
  };
}
