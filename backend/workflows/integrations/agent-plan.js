import { resolveCanonicalUserId } from '../../identity/users/index.js';
import { ensureExecutionParent } from '../../telemetry/executions/ledger.js';
import { resolveWorkflowTemplate } from '../repository/workflows.js';
import { createWorkflowRun, finalizePlanBackedWorkflowRun, setWorkflowRunStepsTotal } from '../runs/repository.js';

export async function startAgentChatPlanWorkflowRun(env, p = {}) {
  if (!env?.DB) throw new Error('DB not available');
  const tenantId = String(p.tenantId || env?.TENANT_ID || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  if (!workspaceId) throw new Error('workspaceId required for workflow run');

  const workflow = await resolveWorkflowTemplate(env.DB, {
    tenantId: tenantId || null,
    triggerType: p.triggerType || 'agent',
    defaultTaskType: p.defaultTaskType || 'planning',
  });
  const workflowKey = String(workflow?.workflow_key || '').trim();
  if (!workflow?.id || !workflowKey) throw new Error('Missing active planning workflow template');

  const userId = p.userId != null && String(p.userId).trim()
    ? await resolveCanonicalUserId(String(p.userId).trim(), env)
    : null;
  const created = await createWorkflowRun(env.DB, {
    workflowId: String(workflow.id),
    workflowKey,
    tenantId: tenantId || null,
    workspaceId,
    userId,
    userEmail: p.userEmail ?? null,
    triggerType: 'agent',
    input: { goal: String(p.goal || '').slice(0, 8000) },
    metadata: { source: 'agent_plan' },
    stepsTotal: 0,
    currentNodeKey: 'plan_bootstrap',
  });

  const executionParentId = await ensureExecutionParent(env, {
    executionType: 'workflow',
    runId: created.runId,
    executionKey: workflowKey,
    tenantId: tenantId || null,
    workspaceId,
    userId,
    status: 'running',
  });

  return {
    workflowRunId: created.runId,
    workflowTemplateId: String(workflow.id),
    executionParentId,
  };
}

export async function setAgentChatPlanWorkflowTaskCount(env, runId, taskCount) {
  if (!runId) return false;
  return setWorkflowRunStepsTotal(env?.DB, runId, taskCount);
}


export async function finalizeAgentChatPlanWorkflowRun(env, _ctx, summary = {}) {
  const runId = String(summary.runId || '').trim();
  if (!env?.DB || !runId) return false;
  const ok = await finalizePlanBackedWorkflowRun(env.DB, {
    runId,
    planId: summary.planId ?? null,
    completed: summary.completed ?? 0,
    failed: summary.failed ?? 0,
    skipped: summary.skipped ?? 0,
    durationMs: summary.durationMs ?? 0,
  });
  return ok;
}
