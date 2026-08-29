import { ensureExecutionParent } from '../../telemetry/executions/ledger.js';
import { compactWorkflowStepEntry } from '../runs/journal.js';
import { loadWorkflowGraph } from '../repository/graph.js';
import { dispatchWorkflowNode } from '../runtime/node-dispatch.js';
import { buildEdgeMap, selectNextEdge } from '../runtime/edges.js';
import { buildApprovalContinuation, resumeApprovalContinuation } from '../runtime/state.js';
import { writeWorkflowContinuation, readWorkflowContinuation } from '../runs/continuation.js';
import {
  getWorkflowRun,
  parseWorkflowRunJson,
  persistWorkflowRunJournal,
  markWorkflowRunAwaitingApproval,
  finalizeWorkflowRunWithStatus,
} from '../runs/repository.js';
import {
  insertExecutionStep,
  completeExecutionStep,
  loadExecutionStepColumns,
} from '../runs/execution-steps.js';

export async function executeDurableWorkflowNode(env, body) {
  if (!env?.DB) return { ok: false, error: 'DB unavailable' };
  const runId = String(body?.run_id || '').trim();
  const workflowKey = String(body?.workflow_key || '').trim();
  const nodeKey = String(body?.node_key || '').trim();
  const node = body?.node && typeof body.node === 'object' ? body.node : null;
  const nodeInput = body?.input ?? {};
  const extra = body?.run_context && typeof body.run_context === 'object' ? body.run_context : {};
  if (!runId || !nodeKey || !node) return { ok: false, error: 'run_id, node_key, and node required' };

  const run = await getWorkflowRun(env.DB, runId);
  if (!run) return { ok: false, error: 'run_not_found' };
  const workflow = await env.DB.prepare(
    `SELECT * FROM agentsam_workflows WHERE id=? AND COALESCE(is_active,1)=1 LIMIT 1`,
  ).bind(run.workflow_id).first().catch(() => null);
  const executionId = await ensureExecutionParent(env, {
    executionType: 'workflow', runId,
    executionKey: workflowKey || run.workflow_key,
    tenantId: run.tenant_id, workspaceId: run.workspace_id, userId: run.user_id,
    status: 'running',
  });
  if (!executionId) return { ok: false, error: 'execution_parent_unavailable' };

  const columns = await loadExecutionStepColumns(env.DB);
  const stepId = `estep_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`;
  const startedAt = Date.now();
  await insertExecutionStep(env.DB, columns, { stepId, executionId, workflowRunId: runId, node, input: nodeInput });

  const runtimeResults = Array.isArray(extra.runtimeResults) ? extra.runtimeResults : [];
  const runContext = {
    ...extra,
    runId,
    workflowRunId: runId,
    workflowId: run.workflow_id,
    workflowKey: workflowKey || run.workflow_key,
    workflowMeta: workflow,
    canonicalUserId: run.user_id,
    runMeta: {
      tenantId: run.tenant_id,
      workspaceId: run.workspace_id,
      userId: run.user_id,
      ...(extra.runMeta || {}),
    },
    executionStepId: stepId,
    initialInput: parseWorkflowRunJson(run.input_json, {}),
    runtimeResults,
    stepResults: runtimeResults,
  };

  const nodeOutput = await dispatchWorkflowNode(env, node, nodeInput, runContext).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  await completeExecutionStep(env.DB, columns, { stepId, startedAt, nodeOutput });

  let journal = parseWorkflowRunJson(run.step_results_json, []);
  if (!Array.isArray(journal)) journal = [];
  journal.push(compactWorkflowStepEntry({
    node_key: nodeKey,
    node_type: node.node_type,
    handler_key: node.handler_key,
    ok: !!nodeOutput?.ok,
    output: nodeOutput?.output ?? null,
    error: nodeOutput?.error ?? null,
  }));
  await persistWorkflowRunJournal(env.DB, runId, journal);

  if (!nodeOutput?.ok) {
    return { ok: false, error: nodeOutput?.error || 'node_failed', journal_steps: journal, handler_key: node.handler_key };
  }

  if ((node.node_type === 'approval_gate' || nodeOutput?.output?.awaiting_approval) && nodeOutput?.output?.status === 'pending') {
    await writeWorkflowContinuation(env.DB, runId, buildApprovalContinuation({
      gateNodeKey: nodeKey,
      nodeInput,
      gateOutput: nodeOutput.output,
      approvalId: nodeOutput.output.approval_id,
    }));
    await markWorkflowRunAwaitingApproval(env.DB, runId, {
      inputTokens: Number(run.input_tokens) || 0,
      outputTokens: Number(run.output_tokens) || 0,
      costUsd: Number(run.cost_usd) || 0,
    }, run.model_used || null, nodeOutput.output.approval_id);
    return {
      ok: true,
      awaiting_approval: true,
      approval_id: nodeOutput.output.approval_id,
      output: nodeOutput.output,
      journal_steps: journal,
      handler_key: node.handler_key,
    };
  }

  return {
    ok: true,
    output: nodeOutput?.output ?? null,
    runtime_result: {
      node_key: nodeKey,
      node_type: node.node_type,
      handler_key: node.handler_key,
      ok: true,
      output: nodeOutput?.output ?? null,
    },
    journal_steps: journal,
    handler_key: node.handler_key,
  };
}

export async function computeNextNodeAfterWorkflowApproval(env, runId, decision = 'approved') {
  if (!env?.DB) return { ok: false, error: 'DB unavailable' };
  const run = await getWorkflowRun(env.DB, runId);
  if (!run) return { ok: false, error: 'run_not_found' };
  if (decision !== 'approved') return { ok: true, next_node_key: null, denied: true };
  const continuation = readWorkflowContinuation(run);
  if (!continuation) return { ok: false, error: 'resume_continuation_missing' };
  const resumed = resumeApprovalContinuation(continuation, 'approved');
  const graph = await loadWorkflowGraph(env.DB, run.workflow_id, run.tenant_id, run.workspace_id);
  if (!graph?.nodes?.length) return { ok: false, error: 'graph_not_found' };
  const chosen = selectNextEdge(buildEdgeMap(graph.edges), resumed.gateNodeKey, resumed.edgeOutput);
  if (!chosen) return { ok: false, error: 'resume_no_outgoing_edge' };
  return {
    ok: true,
    gate_node_key: resumed.gateNodeKey,
    next_node_key: chosen.to_node_key,
    continuation_value: resumed.value,
  };
}

export async function finalizeDurableWorkflowRun(env, body) {
  if (!env?.DB) return { ok: false, error: 'DB unavailable' };
  const runId = String(body?.run_id || '').trim();
  if (!runId) return { ok: false, error: 'run_id required' };
  const run = await getWorkflowRun(env.DB, runId);
  if (!run) return { ok: false, error: 'run_not_found' };
  const status = String(body?.status || 'completed').toLowerCase();
  const journal = body?.journal_steps ?? body?.step_results ?? parseWorkflowRunJson(run.step_results_json, []);
  await finalizeWorkflowRunWithStatus(env.DB, {
    runId,
    status,
    output: body?.output ?? parseWorkflowRunJson(run.output_json, {}),
    journalSteps: Array.isArray(journal) ? journal : [],
    killReason: body?.kill_reason != null ? String(body.kill_reason) : null,
  });
  return { ok: true, run_id: runId, status };
}
