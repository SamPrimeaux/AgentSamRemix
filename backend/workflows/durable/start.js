import { fetchIamWorkflowsJson, hasIamWorkflowsBinding } from './service-client.js';
import { resolveWorkflowExecutionStrategy, parseWorkflowMetadata } from '../contracts/execution-strategy.js';
import { loadWorkflowGraph } from '../repository/graph.js';
import { resolveEntryNode } from '../runtime/entry-node.js';
import { createWorkflowRun, patchWorkflowRunMetadata } from '../runs/repository.js';

export function shouldUseDurableWorkflow(env, workflow, opts = {}) {
  if (!hasIamWorkflowsBinding(env)) return false;
  return resolveWorkflowExecutionStrategy(workflow, opts) === 'durable';
}

export async function startDurableWorkflow(env, opts) {
  const { workflow, input = {}, authUser = null, workspaceId = null, executionStrategyOverride = null } = opts || {};
  if (!env?.DB) return { ok: false, error: 'DB unavailable' };
  if (!hasIamWorkflowsBinding(env)) return { ok: false, error: 'IAM_WORKFLOWS binding not configured' };
  const tenantId = authUser?.tenant_id ?? null;
  const graph = await loadWorkflowGraph(env.DB, workflow?.id, tenantId, workspaceId);
  if (!graph?.nodes?.length) return { ok: false, error: 'no nodes found for workflow' };
  const strategy = resolveWorkflowExecutionStrategy(workflow, {
    override: executionStrategyOverride,
    nodeCount: graph.nodes.length,
  });
  if (strategy !== 'durable') return { ok: false, error: 'execution_strategy_not_durable', strategy };

  const workflowKey = String(workflow?.workflow_key || '');
  const entry = resolveEntryNode(workflow, graph.nodes, graph.edges);
  const metadata = {
    ...parseWorkflowMetadata(workflow?.metadata_json),
    execution_strategy: 'durable',
    source: 'iam_workflows',
  };
  const createdRun = await createWorkflowRun(env.DB, {
    workflowId: workflow.id,
    workflowKey,
    tenantId,
    workspaceId,
    userId: authUser?.id ?? null,
    userEmail: authUser?.email ?? null,
    triggerType: 'manual',
    input,
    stepsTotal: graph.nodes.length,
    currentNodeKey: entry?.node_key || graph.nodes[0]?.node_key || null,
    metadata,
  });

  const runContext = {
    runMeta: {
      tenantId,
      workspaceId,
      userId: authUser?.id ?? null,
      userEmail: authUser?.email ?? null,
    },
  };
  const orchestrator = await fetchIamWorkflowsJson(env, '/v1/runs', {
    payload: {
      run_id: createdRun.runId,
      workflow_key: workflowKey,
      workflow_id: workflow.id,
      input,
      nodes: graph.nodes,
      edges: graph.edges,
      workflow_metadata: parseWorkflowMetadata(workflow?.metadata_json),
      run_context: runContext,
    },
    metadata,
  });
  if (orchestrator.error) {
    await env.DB.prepare(
      `UPDATE agentsam_workflow_runs SET status='failed', kill_reason=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(String(orchestrator.error).slice(0,500), createdRun.runId).run().catch(() => null);
    return { ok: false, error: orchestrator.error, run_id: createdRun.runId };
  }

  const instanceId = orchestrator.instance_id ?? null;
  if (instanceId) await patchWorkflowRunMetadata(env.DB, createdRun.runId, { cf_workflow_instance_id: instanceId });
  return {
    ok: true,
    execution_strategy: 'durable',
    run_id: createdRun.runId,
    instance_id: instanceId,
    steps_total: graph.nodes.length,
  };
}
