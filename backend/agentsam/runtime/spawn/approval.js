// guard-dup-allow: backend spawn peel; legacy approval callers migrate separately.
/** Approval persistence for multitask budget extensions. */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export async function createApprovalRequest(env, _ctx, opts = {}) {
  const proposalId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  if (!env?.DB) return proposalId;

  const workspaceId = trim(opts.workspaceId);
  const userId = trim(opts.userId);
  if (!workspaceId || !userId) throw new Error('approval_scope_required');
  const now = Math.floor(Date.now() / 1000);
  const agentRunId = trim(opts.agentRunId ?? opts.agent_run_id) || null;
  const conversationId =
    trim(opts.conversationId ?? opts.conversation_id ?? opts.sessionId) || null;
  const args = typeof opts.toolArgs === 'string'
    ? opts.toolArgs
    : JSON.stringify(opts.toolArgs || {});
  const inputJson = JSON.stringify({
    filled_template: args.slice(0, 10000),
    tool: trim(opts.toolName),
    command_source: 'agent_generated',
  });

  await env.DB.prepare(
    `INSERT INTO agentsam_approval_queue
      (id, tenant_id, workspace_id, user_id, session_id, tool_name,
       action_summary, risk_level, input_json, expires_at, status,
       approval_type, created_at, agent_run_id, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'tool', ?, ?, ?)`,
  ).bind(
    proposalId,
    trim(opts.tenantId) || null,
    workspaceId,
    userId,
    trim(opts.sessionId) || null,
    trim(opts.toolName) || 'spawn_lane_extension',
    trim(opts.rationale) || 'Multitask lane budget extension requires approval.',
    trim(opts.riskLevel) || 'low',
    inputJson,
    now + 3600,
    now,
    agentRunId,
    conversationId,
  ).run();
  return proposalId;
}
