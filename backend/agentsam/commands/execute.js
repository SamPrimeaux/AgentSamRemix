// guard-dup-allow: backend command peel; legacy command callers migrate separately.
/**
 * Command runtime.
 *
 * prepareCommandExecution authorizes and records the command without executing it.
 * executeCommand adds one injected dispatcher and executes exactly once.
 * Agent-run ids are correlation only; this domain never creates or finalizes agent runs.
 */
import {
  findActiveAgentSamCommandByShellOrSlug,
  getActiveAgentSamCommandById,
} from '../catalog/commands.js';
import { commandHandlerKind, commandHandlerRef, commandShellLine } from '../catalog/command-row.js';
import { isShellCommandTrusted } from '../terminal/command-trust.js';
import { resolveCanonicalUserId } from '../../identity/users/index.js';
import {
  createCommandRunId,
  finishCommandRun,
  markCommandRunApproval,
  startCommandRun,
} from '../../telemetry/commands/run.js';

function trim(value) { return value == null ? '' : String(value).trim(); }
function safeJson(value, max = 16000) {
  try {
    const text = JSON.stringify(value ?? {});
    return text.length <= max ? text : `${text.slice(0, max - 20)}…[truncated]`;
  } catch { return String(value ?? '').slice(0, max); }
}

async function resolveScope(env, o) {
  const sessionId = trim(o.sessionId ?? o.session_id);
  let workspaceId = trim(o.workspaceId ?? o.workspace_id);
  let tenantId = trim(o.tenantId ?? o.tenant_id);
  let agentRunId = trim(o.agentRunId ?? o.agent_run_id);
  let conversationId = trim(o.conversationId ?? o.conversation_id) || sessionId;
  let run = null;
  if ((!workspaceId || !tenantId || !agentRunId) && sessionId) {
    run = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, conversation_id
         FROM agentsam_agent_run WHERE id = ? OR conversation_id = ?
        ORDER BY created_at_unix DESC LIMIT 1`,
    ).bind(sessionId, sessionId).first().catch(() => null);
    workspaceId ||= trim(run?.workspace_id);
    tenantId ||= trim(run?.tenant_id);
    agentRunId ||= trim(run?.id);
    conversationId ||= trim(run?.conversation_id);
  }
  if (!workspaceId) return { ok: false, error: 'workspace_required' };
  if (!tenantId) {
    const workspace = await env.DB.prepare(
      `SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`,
    ).bind(workspaceId).first().catch(() => null);
    tenantId = trim(workspace?.tenant_id);
  }
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  return { ok: true, workspaceId, tenantId, agentRunId: agentRunId || null,
    conversationId: conversationId || null, sessionId: sessionId || null };
}

async function insertCommandApproval(env, p) {
  const approvalId = `appr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO agentsam_approval_queue
      (id, tenant_id, workspace_id, user_id, session_id, plan_id, todo_id, workflow_run_id,
       command_run_id, execution_step_id, tool_name, handler_key, action_summary,
       input_json, risk_level, approval_type, status, expires_at, agent_run_id, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tool', 'pending', unixepoch() + 300, ?, ?)`,
  ).bind(
    approvalId, p.tenantId, p.workspaceId, p.userId, p.sessionId, trim(p.planId) || null,
    trim(p.todoId) || null, trim(p.workflowRunId) || null, p.commandRunId,
    trim(p.executionStepId) || null, p.toolName, trim(p.handlerKey) || null,
    p.actionSummary, safeJson(p.args, 12000), p.riskLevel, p.agentRunId, p.conversationId,
  ).run();
  return approvalId;
}

export async function prepareCommandExecution(env, ctx, o = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const commandId = trim(o.commandId ?? o.command_id);
  if (!commandId) return { ok: false, error: 'command_id_required' };
  const scope = await resolveScope(env, o);
  if (!scope.ok) return scope;

  const rawUserId = trim(o.userId ?? o.user_id);
  if (!rawUserId) return { ok: false, error: 'user_id_required' };
  const userId = await resolveCanonicalUserId(rawUserId, env);
  if (!userId) return { ok: false, error: 'canonical_user_required' };

  const command = await getActiveAgentSamCommandById(env.DB, commandId);
  if (!command) return { ok: false, error: 'command_not_found' };
  const kind = commandHandlerKind(command);
  const shellLine = commandShellLine(command);
  if ((kind === 'shell' || kind === 'script') && shellLine) {
    const trusted = await isShellCommandTrusted(env, {
      userId, workspaceId: scope.workspaceId, command: shellLine,
    });
    if (!trusted) return { ok: false, error: 'command_not_allowlisted' };
  }

  const commandRunId = trim(o.commandRunId ?? o.command_run_id) || createCommandRunId();
  const riskLevel = trim(command.risk_level) || 'low';
  const requiresConfirmation = Number(command.requires_confirmation) === 1;
  const needsApproval = o.skipApprovalGate !== true && (requiresConfirmation || riskLevel === 'critical');
  const approvalStatus = needsApproval ? 'pending_approval' : o.skipApprovalGate === true ? 'approved' : 'not_required';
  const started = await startCommandRun(env, {
    commandRunId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    userId,
    sessionId: scope.sessionId,
    conversationId: scope.conversationId,
    agentRunId: scope.agentRunId,
    commandId,
    commandSlug: trim(command.slug),
    userInput: trim(command.display_name) || trim(command.slug) || 'command',
    intentCategory: trim(command.category) || null,
    riskLevel,
    requiresConfirmation,
    approvalStatus,
    execIdentity: o.execIdentity ?? o.exec_identity,
    commands: [{
      catalog_command_id: commandId,
      handler_kind: kind,
      handler_ref: commandHandlerRef(command) || null,
      shell_line: shellLine || null,
      args: o.args ?? {},
    }],
    executionContext: o.executionContext,
  });
  if (!started.ok) return { ok: false, error: started.reason || 'command_run_start_failed' };

  if (needsApproval) {
    const toolName = shellLine || trim(command.slug) || commandId;
    const approvalId = await insertCommandApproval(env, {
      tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId,
      sessionId: scope.sessionId, conversationId: scope.conversationId,
      agentRunId: scope.agentRunId, commandRunId, toolName,
      handlerKey: commandHandlerRef(command),
      actionSummary: `${trim(command.display_name) || trim(command.slug) || commandId}: ${safeJson(o.args ?? {}, 300)}`,
      riskLevel, args: o.args ?? {}, planId: o.planId, todoId: o.todoId,
      workflowRunId: o.workflowRunId, executionStepId: o.executionStepId,
    }).catch((error) => null);
    if (!approvalId) {
      await finishCommandRun(env, { commandRunId, success: false, errorMessage: 'approval_queue_insert_failed' });
      return { ok: false, error: 'approval_queue_insert_failed', command_run_id: commandRunId };
    }
    return {
      ok: true, status: 'pending_approval', approval_id: approvalId,
      command_run_id: commandRunId, agent_run_id: scope.agentRunId,
      command_preview: toolName.slice(0, 2000), risk_level: riskLevel,
    };
  }

  return {
    ok: true,
    status: 'ready',
    command,
    command_run_id: commandRunId,
    agent_run_id: scope.agentRunId,
    conversation_id: scope.conversationId,
    tenant_id: scope.tenantId,
    workspace_id: scope.workspaceId,
    user_id: userId,
  };
}

export async function completeCommand(env, _ctx, o = {}) {
  const commandRunId = trim(o.commandRunId ?? o.command_run_id);
  if (!commandRunId) return { ok: false, error: 'command_run_id_required' };
  const result = await finishCommandRun(env, {
    commandRunId,
    success: o.success === true,
    durationMs: o.durationMs,
    costUsd: o.costUsd,
    inputTokens: o.inputTokens,
    outputTokens: o.outputTokens,
    outputSummary: o.outputSummary,
    errorMessage: o.errorMessage,
    modelKey: o.modelKey ?? o.model_key,
    result: o.result,
  });
  return result.ok ? result : { ok: false, error: result.reason || 'command_run_finalize_failed' };
}

export async function executeCommand(env, ctx, o = {}, runtime = {}) {
  const prepared = await prepareCommandExecution(env, ctx, o);
  if (!prepared.ok || prepared.status === 'pending_approval') return prepared;
  const dispatchCommand = runtime.dispatchCommand || o.dispatchCommand;
  if (typeof dispatchCommand !== 'function') {
    await completeCommand(env, ctx, {
      commandRunId: prepared.command_run_id, success: false, errorMessage: 'command_dispatch_adapter_required',
    });
    return { ok: false, error: 'command_dispatch_adapter_required', command_run_id: prepared.command_run_id };
  }

  const startedAt = Date.now();
  let result = null;
  let error = null;
  try {
    result = await dispatchCommand(env, prepared.command, o.args ?? {}, {
      tenantId: prepared.tenant_id,
      workspaceId: prepared.workspace_id,
      userId: prepared.user_id,
      sessionId: trim(o.sessionId ?? o.session_id) || null,
      conversationId: prepared.conversation_id,
      commandRunId: prepared.command_run_id,
      agentRunId: prepared.agent_run_id,
    });
    if (result?.ok === false) error = trim(result.error) || 'command_dispatch_failed';
  } catch (dispatchError) {
    error = dispatchError?.message ?? String(dispatchError);
  }
  const durationMs = Math.max(0, Date.now() - startedAt);
  const success = error == null;
  await completeCommand(env, ctx, {
    commandRunId: prepared.command_run_id,
    success,
    durationMs,
    outputSummary: success ? safeJson(result, 50000) : null,
    errorMessage: error,
    result,
  });
  return {
    ok: success,
    status: success ? 'completed' : 'failed',
    chain_id: null,
    command_run_id: prepared.command_run_id,
    agent_run_id: prepared.agent_run_id,
    model_key: null,
    provider: null,
    task_type: trim(o.taskType) || 'tool_use',
    result,
    error,
  };
}

export async function handleAgentApprovalDecision(env, ctx, opts = {}, runtime = {}) {
  const approvalId = trim(opts.approval_id ?? opts.approvalId);
  const decision = trim(opts.decision).toLowerCase();
  const approvedBy = trim(opts.userId ?? opts.user_id) || null;
  if (!env?.DB || !approvalId || !['approved', 'denied'].includes(decision)) {
    return { ok: false, error: 'invalid_params' };
  }
  const update = await env.DB.prepare(
    `UPDATE agentsam_approval_queue SET status = ?, approved_by = ?, decided_at = unixepoch()
      WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > unixepoch())`,
  ).bind(decision, approvedBy, approvalId).run().catch(() => null);
  const changes = Number(update?.meta?.changes ?? update?.changes ?? 0) || 0;
  if (!changes) return { ok: false, error: 'not_found_or_not_pending' };

  const row = await env.DB.prepare(
    `SELECT * FROM agentsam_approval_queue WHERE id = ? LIMIT 1`,
  ).bind(approvalId).first().catch(() => null);
  if (row?.command_run_id) await markCommandRunApproval(env, row.command_run_id, decision);
  if (decision === 'denied') return { ok: true, decision };
  if (!row) return { ok: true, decision };

  const command = await findActiveAgentSamCommandByShellOrSlug(env.DB, row.tool_name);
  if (!command?.id) return { ok: true, decision, rerun: 'skipped_no_command' };
  let args = {};
  try { args = JSON.parse(row.input_json || '{}'); } catch { args = {}; }
  const execute = await executeCommand(env, ctx, {
    commandId: command.id,
    userId: row.user_id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    agentRunId: row.agent_run_id,
    commandRunId: row.command_run_id,
    planId: row.plan_id,
    todoId: row.todo_id,
    workflowRunId: row.workflow_run_id,
    executionStepId: row.execution_step_id,
    args,
    skipApprovalGate: true,
  }, runtime);
  return { ok: true, decision, execute };
}
