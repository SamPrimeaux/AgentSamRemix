/** Canonical workflow-domain public surface. Keep this boring and narrow. */
import { isFeatureEnabled } from '../platform/feature-flags.js';
import { executeWorkflow } from './runtime/executor.js';
import { getWorkflowRun as readWorkflowRun } from './runs/repository.js';

export { executeWorkflow } from './runtime/executor.js';
export { loadWorkflowGraph } from './repository/graph.js';
export {
  resolveWorkflowRow,
  resolveWorkflowTemplate,
  getWorkflowById,
  listActiveWorkflowOptions,
  listWorkflowsForSubagentSlug,
} from './repository/workflows.js';
export {
  AGENTSAM_WORKFLOWS_TABLE,
  AGENTSAM_WORKFLOW_RUNS_TABLE,
  maxAgentsamWorkflowTimeoutSeconds,
} from './repository/registry-stats.js';
export {
  workflowIsolationTier,
  deterministicWorkflowId,
  assertAutomatedWorkflowKey,
  validateWorkflowRegistryWrite,
} from './repository/governance.js';
export { listHandlers as listWorkflowHandlers } from './repository/handlers.js';
export {
  resolveWorkflowExecutionStrategy,
  normalizeWorkflowExecutionStrategy,
  parseWorkflowMetadata,
} from './contracts/execution-strategy.js';
export { WORKFLOW_TRIGGER_TYPES, normalizeWorkflowTriggerType } from './contracts/trigger-type.js';
export { WORKFLOW_EVENT_TYPES } from './contracts/events.js';
export { startDurableWorkflow, shouldUseDurableWorkflow } from './durable/start.js';
export {
  executeDurableWorkflowNode,
  computeNextNodeAfterWorkflowApproval,
  finalizeDurableWorkflowRun,
} from './durable/execute-node.js';
export {
  loadWorkflowStudioModel,
  requireWorkflowGraphContext,
  saveWorkflowCanvasLayout,
  createWorkflowNode,
  updateWorkflowNode,
  deleteWorkflowNode,
  createWorkflowEdge,
  deleteWorkflowEdge,
  patchWorkflowRegistry,
  createWorkflowDefinition,
  listWorkflowStudioCatalog,
} from './studio/repository.js';
export { isWorkflowSignedOff, shouldEnforceWorkflowApproval } from './approvals/policy.js';
export {
  getWorkflowRunForScope,
  getLatestWorkflowRunForScope,
  loadWorkflowRunDetail,
  listRecentWorkflowRuns,
} from './runs/repository.js';
export { decideWorkflowApproval } from './approvals/repository.js';
export { transitionWorkflowApproval } from './approvals/service.js';

export async function getWorkflowRun(envOrDb, runId) {
  const db = envOrDb?.prepare ? envOrDb : envOrDb?.DB;
  return readWorkflowRun(db, runId);
}

export async function resumeWorkflow(env, options = {}) {
  const runId = String(options.runId || options.run_id || '').trim();
  if (!runId) return { ok: false, error: 'run_id_required' };
  const run = await readWorkflowRun(env?.DB, runId);
  if (!run) return { ok: false, error: 'run_not_found', run_id: runId };
  return executeWorkflow(env, {
    workflowKey: run.workflow_key,
    input: options.input ?? {},
    tenantId: options.tenantId ?? run.tenant_id ?? null,
    workspaceId: options.workspaceId ?? run.workspace_id ?? null,
    userId: options.userId ?? run.user_id ?? null,
    userEmail: options.userEmail ?? run.user_email ?? null,
    resumeRunId: runId,
    onEvent: options.onEvent ?? null,
    ctx: options.ctx ?? null,
  });
}

/** Compatibility-shaped public start entry, now owned by backend/workflows. */
export async function startWorkflow(env, _ctx, options = {}) {
  const {
    workflowKey,
    userId,
    userEmail = null,
    tenantId,
    workspaceId,
    inputJson = {},
    triggerType = 'agent',
    onEvent = null,
    ctx = null,
  } = options;
  if (!env?.DB) return { ok: false, error: 'no_db' };
  if (!workspaceId || String(workspaceId).trim() === '') return { ok: false, error: 'workspace_required' };
  const enabled = await isFeatureEnabled(env, 'multi_step_workflows', { userId, tenantId });
  if (!enabled) return { ok: false, error: 'feature_disabled' };
  return executeWorkflow(env, {
    workflowKey,
    input: inputJson ?? {},
    tenantId,
    workspaceId,
    userId,
    userEmail,
    triggerType,
    onEvent,
    ctx,
  });
}
