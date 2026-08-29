import { resolveCanonicalUserId } from '../api/auth.js';
import { scheduleRecordMcpToolExecution } from './mcp-tool-execution.js';
import { scheduleAgentsamToolCallLog } from './agent-prompt-builder.js';
import { formatToolApprovalPreview } from './agent-tool-validator.js';
import { writeUsageEventFromChat } from '../../backend/telemetry/usage-events.js';
import { shouldRequireToolApproval } from './agent-approval-policy.js';

export function needsApproval(validationResult, modeConfig, userPolicy) {
  return shouldRequireToolApproval(validationResult, modeConfig, userPolicy);
}

export async function createApprovalRequest(env, ctx, opts) {
  const {
    tenantId,
    sessionId,
    userId,
    workspaceId,
    personUuid,
    toolName,
    toolArgs,
    toolCallId,
    riskLevel,
    rationale,
    ledgerExtras,
    agentRunId,
    agent_run_id,
    conversationId,
    conversation_id,
    grantOnApproval,
  } = opts;
  const approvalSpine = {
    agent_run_id:
      (agent_run_id ?? agentRunId) != null ? String(agent_run_id ?? agentRunId).trim() : null,
    conversation_id:
      (conversation_id ?? conversationId ?? sessionId) != null
        ? String(conversation_id ?? conversationId ?? sessionId).trim()
        : null,
  };
  const proposalId  = 'prop_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now         = Math.floor(Date.now() / 1000);
  const expiresAt   = now + 3600;
  if (!env.DB) return proposalId;
  const argsStr = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs || {});
  if (!workspaceId) {
    throw new Error('WORKSPACE_CONTEXT_MISSING');
  }
  try {
    let uidResolved = userId != null && String(userId).trim() !== '' ? String(userId).trim() : null;
    if (uidResolved) {
      uidResolved = await resolveCanonicalUserId(uidResolved, env);
    }
    const uid = uidResolved ?? 'iam_agent';
    const summary = rationale || `Tool call requires approval: ${toolName}`;
    const previewCommand = formatToolApprovalPreview(toolName, toolArgs);
    const inputJson = JSON.stringify({
      command_text: `${toolName}(${argsStr.slice(0, 500)})`,
      command: previewCommand || null,
      filled_template: argsStr,
      command_source: 'agent_generated',
      tool: toolName,
      grant_on_approval: grantOnApproval === true,
    });
    await env.DB.prepare(
      `INSERT INTO agentsam_approval_queue
       (id, tenant_id, workspace_id, user_id, session_id, tool_name, action_summary,
        risk_level, input_json, expires_at, status, approval_type, created_at,
        agent_run_id, conversation_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      proposalId,
      tenantId,
      workspaceId,
      uid,
      sessionId || null,
      toolName,
      summary,
      riskLevel || 'medium',
      inputJson,
      expiresAt,
      'pending',
      'tool',
      now,
      approvalSpine.agent_run_id,
      approvalSpine.conversation_id,
    ).run();
    scheduleRecordMcpToolExecution(env, ctx, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: uidResolved ?? userId,
      person_uuid: personUuid,
      session_id: sessionId,
      tool_name: toolName,
      input_json: argsStr.slice(0, 10000),
      output_json: '',
      // Finding #3: awaiting approval is non-terminal — never success:false → ledger error.
      status: 'awaiting_approval',
      requires_approval: 1,
      error_message: null,
      // Phase B: scheduleAgentsamToolCallLog below owns agentsam_tool_call_log.
      skip_tool_call_log: true,
      ...approvalSpine,
    });
    scheduleAgentsamToolCallLog(env, ctx, {
      tenantId,
      sessionId,
      toolName,
      status: 'pending',
      durationMs: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      userId,
      workspaceId,
      errorMessage: null,
      inputSummary: argsStr.slice(0, 200),
      ...approvalSpine,
      ...(ledgerExtras && typeof ledgerExtras === 'object' ? ledgerExtras : {}),
    });
    try {
      const { enqueueImessageApprovalForQueue } = await import('../../backend/integrations/imessage-relay.js');
      await enqueueImessageApprovalForQueue(env, {
        approvalQueueId: proposalId,
        tenantId,
        workspaceId,
        userId: uid,
        promptText: summary,
        agentRunId: approvalSpine.agent_run_id,
        conversationId: approvalSpine.conversation_id,
      });
    } catch (imErr) {
      console.warn('[agent] imessage enqueue:', imErr?.message ?? imErr);
    }
  } catch (e) { console.warn('[agent] createApprovalRequest:', e?.message); }
  return proposalId;
}

/** Poll agentsam_approval_queue until approved, denied/expired, or timeout. */
export async function pollApprovalQueue(env, approvalId, maxSeconds = 180) {
  if (!env?.DB || !approvalId) return false;
  const deadline = Date.now() + Math.max(1, Number(maxSeconds) || 180) * 1000;
  while (Date.now() < deadline) {
    const row = await env.DB.prepare(
      `SELECT status, expires_at FROM agentsam_approval_queue WHERE id = ? LIMIT 1`,
    )
      .bind(approvalId)
      .first()
      .catch(() => null);
    if (!row) return false;
    const st = String(row.status || '').toLowerCase();
    if (st === 'approved') return true;
    if (st === 'denied' || st === 'expired') return false;
    const exp = Number(row.expires_at);
    if (Number.isFinite(exp) && exp > 0 && exp <= Math.floor(Date.now() / 1000)) return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** Pending row in agentsam_approval_queue blocks duplicate execution until approved/denied. */
export async function checkApprovalGate(env, userId, toolName) {
  if (!env?.DB || !userId || !toolName) return null;
  return env.DB.prepare(
    `SELECT id, status, expires_at FROM agentsam_approval_queue
     WHERE user_id = ? AND tool_name = ? AND status = 'pending'
       AND expires_at > unixepoch()
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId, toolName)
    .first()
    .catch(() => null);
}

export async function auditToolDecision(env, opts) {
  if (!env.DB) return;
  const tid = opts.tenantId != null && String(opts.tenantId).trim() !== '' ? String(opts.tenantId).trim() : '';
  const wid =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : '';
  const uid =
    opts.userId != null && String(opts.userId).trim() !== '' ? String(opts.userId).trim() : '';
  if (!tid || !wid || !uid) return;
  try {
    const hook = await env.DB.prepare(
      `SELECT id FROM agentsam_hook
       WHERE is_active = 1 AND trigger IN ('tool_audit','agent_tool_audit')
         AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
         AND (workspace_id IS NULL OR workspace_id = '' OR workspace_id = ?)
       ORDER BY CASE WHEN workspace_id IS NOT NULL AND workspace_id != '' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
      .bind(tid, wid)
      .first()
      .catch(() => null);
    if (!hook?.id) return;
    const execId = `hexec_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const blocked = String(opts.eventType || '').includes('blocked');
    await env.DB.prepare(
      `INSERT INTO agentsam_hook_execution (
         id, hook_id, tenant_id, workspace_id, user_id,
         event_type, status, payload_json, metadata_json, ran_at
       ) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
    )
      .bind(
        execId,
        String(hook.id),
        tid,
        wid,
        uid,
        String(opts.eventType || 'tool_audit'),
        blocked ? 'blocked' : 'success',
        JSON.stringify({
          message: opts.message ?? null,
          tool: opts.toolName ?? null,
        }),
        JSON.stringify({ reason: opts.reason ?? null, risk: opts.riskLevel ?? null }),
      )
      .run();
  } catch (_) {}
}

/** Dedup key pairs with UNIQUE(ref_table, ref_id) on agentsam_usage_events. */
export function scheduleAgentsamUsageEventFromChat(env, ctx, opts) {
  writeUsageEventFromChat(env, ctx, {
    tenantId: opts.tenantId,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    conversationId: opts.conversationId,
    resolvedProvider: opts.resolvedProvider,
    modelKey: opts.modelKey,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costUsd: opts.costUsd,
    streamFailed: opts.streamFailed,
    refId: opts.refId,
    routingArmId: opts.routingArmId,
    taskType: opts.taskType,
    mode: opts.mode,
  });
}

// ─── OpenAI streaming (chat.completions): accumulate tool_calls + text ───────

/** Concatenated `function.arguments` from OpenAI chat.completions stream; repairable failures keep raw. */
