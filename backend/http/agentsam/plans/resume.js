/** POST /api/agent/plan-task/resume — execute one approved task. */

import { getApprovalQueueRow } from '../../../agentsam/approvals/queue.js';
import { startPlanExecuteSseResponse } from '../plan-execute-stream.js';
import { jsonResponse } from '../shared.js';
import { loadOwnedPlan, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanTaskResumeRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan-task/resume') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const planId = String(body.plan_id ?? body.planId ?? '').trim();
  const taskId = String(body.task_id ?? body.taskId ?? '').trim();
  const commandRunId = String(body.command_run_id ?? body.commandRunId ?? '').trim();
  const approvalId = String(body.approval_id ?? body.approvalId ?? '').trim();
  if (!planId || !taskId || !approvalId) {
    return jsonResponse({ error: 'plan_id, task_id, and approval_id required' }, 400);
  }
  const owned = await loadOwnedPlan(env, planId, scope);
  if (owned.response) return owned.response;
  const approval = await getApprovalQueueRow(env, approvalId);
  if (
    approval &&
    (String(approval.tenant_id || '') !== String(scope.tenantId || '') ||
      (approval.workspace_id && String(approval.workspace_id).trim() !== scope.workspaceId))
  ) {
    return jsonResponse({ error: 'approval_scope_mismatch' }, 403);
  }
  if (
    !approval ||
    String(approval.status || '').toLowerCase() !== 'approved' ||
    (approval.expires_at != null && Number(approval.expires_at) <= Math.floor(Date.now() / 1000))
  ) {
    return jsonResponse({ error: 'approval_not_verified', message: 'Approve this task first (Allow).' }, 403);
  }
  const queueCommandRunId = String(approval.command_run_id || '').trim();
  if (commandRunId && queueCommandRunId && commandRunId !== queueCommandRunId) {
    return jsonResponse({ error: 'command_run_mismatch' }, 400);
  }
  const effectiveCommandRunId = commandRunId || queueCommandRunId;
  if (!effectiveCommandRunId) return jsonResponse({ error: 'command_run_id missing' }, 400);
  const task = await env.DB
    .prepare(
      `SELECT id, plan_id, workspace_id, command_run_id, execution_step_id
         FROM agentsam_plan_tasks
        WHERE id = ? AND plan_id = ?
        LIMIT 1`,
    )
    .bind(taskId, planId)
    .first()
    .catch(() => null);
  if (!task?.id) return jsonResponse({ error: 'task_not_found' }, 404);
  if (String(task.workspace_id || '').trim() && String(task.workspace_id).trim() !== scope.workspaceId) {
    return jsonResponse({ error: 'workspace_mismatch' }, 403);
  }
  const taskCommandRunId = String(task.command_run_id || '').trim();
  if (taskCommandRunId && taskCommandRunId !== effectiveCommandRunId) {
    return jsonResponse({ error: 'task_command_run_mismatch' }, 400);
  }
  const queueStep = String(approval.execution_step_id || '').trim();
  const taskStep = String(task.execution_step_id || '').trim();
  if (queueStep && taskStep && queueStep !== taskStep) {
    return jsonResponse({ error: 'execution_step_mismatch' }, 400);
  }
  const approvalUser = String(approval.user_id || '').trim();
  if (approvalUser && approvalUser !== scope.userId && approvalUser !== String(scope.authUser?.email || '').trim()) {
    return jsonResponse({ error: 'approval_user_mismatch' }, 403);
  }
  if (typeof services?.executePlan !== 'function') return jsonResponse({ error: 'plan_executor_unavailable' }, 503);
  const plan = await env.DB.prepare('SELECT workflow_run_id FROM agentsam_plans WHERE id = ? LIMIT 1')
    .bind(planId).first().catch(() => null);
  return startPlanExecuteSseResponse(env, ctx, {
    planId,
    executePlan: services.executePlan,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    onlyTaskId: taskId,
    sessionId: body.sessionId ?? body.session_id ?? scope.sessionId,
    skipPlanAggregate: true,
    workflowRunId: plan?.workflow_run_id ?? null,
    request,
  });
}
