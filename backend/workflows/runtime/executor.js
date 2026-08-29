import { resolveCanonicalUserId } from '../../identity/users/index.js';
import { ensureExecutionParent, finishExecutionParent } from '../../telemetry/executions/ledger.js';
import { recordArmOutcome } from '../../../src/core/agent-model-resolver.js';
import { compactWorkflowStepEntry } from '../runs/journal.js';
import { emitWorkflowEvent } from '../contracts/events.js';
import { normalizeWorkflowTriggerType } from '../contracts/trigger-type.js';
import { resolveWorkflowRow } from '../repository/workflows.js';
import { loadWorkflowGraph } from '../repository/graph.js';
import { resolveEntryNode } from './entry-node.js';
import { buildEdgeMap, selectNextEdge } from './edges.js';
import { dispatchWorkflowNode } from './node-dispatch.js';
import { nextWorkflowRuntimeValue, buildApprovalContinuation, resumeApprovalContinuation } from './state.js';
import {
  createWorkflowRun,
  finalizeWorkflowRun,
  getWorkflowRun,
  hasPendingWorkflowApproval,
  markWorkflowRunAwaitingApproval,
  markWorkflowRunNode,
  markWorkflowRunRunning,
  parseWorkflowRunJson,
  persistWorkflowRunJournal,
} from '../runs/repository.js';
import { clearWorkflowContinuation, readWorkflowContinuation, writeWorkflowContinuation } from '../runs/continuation.js';
import {
  completeExecutionStep,
  insertExecutionStep,
  loadExecutionStepColumns,
  recordExecutionStepEdge,
} from '../runs/execution-steps.js';

function usageFromNodeOutput(nodeOutput) {
  const usage = nodeOutput?.output?.usage ?? nodeOutput?.output?.tokens ?? nodeOutput?.tokens ?? nodeOutput?.usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0,
    outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0,
    costUsd: Number(usage.cost_usd ?? usage.cost ?? 0) || 0,
  };
}

function addUsage(total, delta) {
  total.inputTokens += delta.inputTokens;
  total.outputTokens += delta.outputTokens;
  total.costUsd += delta.costUsd;
}

/**
 * Canonical in-Worker workflow graph executor.
 * Runtime values are full in-memory values; journalSteps are compact persistence summaries only.
 */
export async function executeWorkflow(env, opts) {
  const {
    workflowKey,
    input = {},
    tenantId = null,
    workspaceId = null,
    userId = null,
    userEmail = null,
    triggerType: triggerTypeRaw = 'agent',
    resumeRunId = null,
    onEvent = null,
    ctx = null,
  } = opts || {};

  if (!env?.DB) return { ok: false, error: 'DB not available' };
  if (!workflowKey) return { ok: false, error: 'workflow_key_required' };

  const workflow = await resolveWorkflowRow(env.DB, workflowKey, tenantId, workspaceId);
  if (!workflow) return { ok: false, error: `workflow not found: ${workflowKey}` };
  const graph = await loadWorkflowGraph(env.DB, workflow.id, tenantId, workspaceId);
  if (!graph?.nodes?.length) return { ok: false, error: 'no nodes found for workflow' };

  const nodes = graph.nodes;
  const edges = graph.edges || [];
  const nodeMap = Object.fromEntries(nodes.map((node) => [node.node_key, node]));
  const edgeMap = buildEdgeMap(edges);
  const triggerType = normalizeWorkflowTriggerType(triggerTypeRaw);

  let runId = resumeRunId ? String(resumeRunId).trim() : '';
  let journalSteps = [];
  let runtimeResults = [];
  let runtimeValue = input;
  let currentNodeKey = null;
  let runStartedAt = Date.now();
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let modelUsed = null;

  if (runId) {
    const existing = await getWorkflowRun(env.DB, runId);
    if (!existing) return { ok: false, error: 'run_not_found', run_id: runId };
    if (String(existing.workflow_key || '') !== String(workflowKey)) {
      return { ok: false, error: 'workflow_key_mismatch', run_id: runId };
    }
    if (await hasPendingWorkflowApproval(env.DB, runId)) {
      return { ok: false, error: 'approval_pending', run_id: runId };
    }
    const status = String(existing.status || '').toLowerCase();
    if (!['running', 'awaiting_approval'].includes(status)) {
      return { ok: false, error: `run_not_resumable:${status}`, run_id: runId };
    }

    journalSteps = parseWorkflowRunJson(existing.step_results_json, []);
    if (!Array.isArray(journalSteps)) journalSteps = [];
    totals.inputTokens = Number(existing.input_tokens) || 0;
    totals.outputTokens = Number(existing.output_tokens) || 0;
    totals.costUsd = Number(existing.cost_usd) || 0;
    modelUsed = existing.model_used || null;
    runStartedAt = Number(existing.started_at) * 1000 || Date.now();

    const continuation = readWorkflowContinuation(existing);
    let resumed;
    if (continuation) {
      resumed = resumeApprovalContinuation(continuation, 'approved');
    } else {
      // Compatibility for runs paused before explicit continuation state existed.
      const gateNodeKey = String(existing.current_node_key || journalSteps[journalSteps.length - 1]?.node_key || '').trim();
      resumed = {
        gateNodeKey,
        value: parseWorkflowRunJson(existing.input_json, input),
        edgeOutput: { ok: true, output: { status: 'approved' } },
      };
    }
    if (!resumed.gateNodeKey) return { ok: false, error: 'resume_missing_gate_node', run_id: runId };
    const chosen = selectNextEdge(edgeMap, resumed.gateNodeKey, resumed.edgeOutput);
    if (!chosen) return { ok: false, error: 'resume_no_outgoing_edge', run_id: runId };
    currentNodeKey = chosen.to_node_key;
    runtimeValue = resumed.value;
    await clearWorkflowContinuation(env.DB, runId);
    await markWorkflowRunRunning(env.DB, runId, currentNodeKey);
    emitWorkflowEvent(onEvent, 'edge_selected', {
      run_id: runId,
      workflow_key: workflowKey,
      from_node_key: resumed.gateNodeKey,
      to_node_key: currentNodeKey,
      resumed: true,
    });
    emitWorkflowEvent(onEvent, 'run_started', {
      run_id: runId,
      workflow_key: workflowKey,
      steps_total: nodes.length,
      steps_completed: journalSteps.length,
      resumed: true,
    });
  } else {
    const entry = resolveEntryNode(workflow, nodes, edges);
    currentNodeKey = entry?.node_key || nodes[0]?.node_key || null;
    const created = await createWorkflowRun(env.DB, {
      workflowId: workflow.id,
      workflowKey,
      tenantId,
      workspaceId,
      userId,
      userEmail,
      triggerType,
      input,
      stepsTotal: nodes.length,
      currentNodeKey,
      runGroupId: opts?.run_group_id ?? null,
    });
    runId = created.runId;
    emitWorkflowEvent(onEvent, 'run_started', {
      run_id: runId,
      workflow_key: workflowKey,
      steps_total: nodes.length,
      steps_completed: 0,
    });
  }

  const canonicalUserId = userId ? await resolveCanonicalUserId(userId, env) : null;
  const workflowExecutionId = await ensureExecutionParent(env, {
    executionType: 'workflow',
    runId,
    executionKey: workflowKey,
    tenantId,
    workspaceId,
    userId: canonicalUserId,
    status: 'running',
  });
  const stepColumns = await loadExecutionStepColumns(env.DB);
  const runContext = {
    runId,
    workflowRunId: runId,
    workflowId: workflow.id,
    workflowKey,
    workflowMeta: workflow,
    canonicalUserId,
    runMeta: { tenantId, workspaceId, userId: canonicalUserId },
    initialInput: input,
    workflowExecutionId,
  };

  let ok = true;
  let killReason = null;
  const visited = new Set();

  while (currentNodeKey) {
    if (visited.has(currentNodeKey)) { ok = false; killReason = 'cycle_detected'; break; }
    if (runtimeResults.length > nodes.length + 5) { ok = false; killReason = 'max_steps_exceeded'; break; }
    visited.add(currentNodeKey);
    const node = nodeMap[currentNodeKey];
    if (!node) { ok = false; killReason = `node_not_found:${currentNodeKey}`; break; }

    await markWorkflowRunNode(env.DB, runId, currentNodeKey);
    const nodeInput = runtimeValue;
    const stepId = `estep_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`;
    const startedAt = Date.now();
    await insertExecutionStep(env.DB, stepColumns, {
      stepId,
      executionId: workflowExecutionId,
      workflowRunId: runId,
      node,
      input: nodeInput,
    });

    emitWorkflowEvent(onEvent, 'node_started', {
      run_id: runId,
      workflow_key: workflowKey,
      node_key: currentNodeKey,
      steps_completed: journalSteps.length,
      steps_total: nodes.length,
    });

    let nodeOutput = await dispatchWorkflowNode(env, node, nodeInput, {
      ...runContext,
      node,
      executionStepId: stepId,
      // Full in-memory results only. Never the compact D1 journal.
      stepResults: runtimeResults,
      runtimeResults,
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));

    await completeExecutionStep(env.DB, stepColumns, { stepId, startedAt, nodeOutput });
    const delta = usageFromNodeOutput(nodeOutput);
    addUsage(totals, delta);
    modelUsed = nodeOutput?.output?.model ?? nodeOutput?.model ?? modelUsed;
    try {
      const armId = nodeOutput?.resolvedArm?.routing_arm_id ?? null;
      if (armId) await recordArmOutcome(env, ctx, armId, !!nodeOutput?.ok, { model_key: nodeOutput?.resolvedArm?.model_key });
    } catch {}

    runtimeResults.push({
      node_key: currentNodeKey,
      node_type: node.node_type,
      handler_key: node.handler_key,
      ok: !!nodeOutput?.ok,
      output: nodeOutput?.output ?? null,
      error: nodeOutput?.error ?? null,
    });
    journalSteps.push(compactWorkflowStepEntry(runtimeResults[runtimeResults.length - 1]));
    await persistWorkflowRunJournal(env.DB, runId, journalSteps);

    emitWorkflowEvent(onEvent, nodeOutput?.ok ? 'node_completed' : 'node_failed', {
      run_id: runId,
      workflow_key: workflowKey,
      node_key: currentNodeKey,
      steps_completed: journalSteps.length,
      steps_total: nodes.length,
      input_tokens: totals.inputTokens,
      output_tokens: totals.outputTokens,
      cost_usd: totals.costUsd,
      ok: !!nodeOutput?.ok,
      output: nodeOutput?.output ?? null,
      error: nodeOutput?.error ?? null,
    });

    if (!nodeOutput?.ok) { ok = false; killReason = nodeOutput?.error || 'node_failed'; break; }

    if ((node.node_type === 'approval_gate' || nodeOutput?.output?.awaiting_approval) && nodeOutput?.output?.status === 'pending') {
      const continuation = buildApprovalContinuation({
        gateNodeKey: currentNodeKey,
        nodeInput,
        gateOutput: nodeOutput.output,
        approvalId: nodeOutput.output.approval_id,
      });
      await writeWorkflowContinuation(env.DB, runId, continuation);
      await markWorkflowRunAwaitingApproval(env.DB, runId, totals, modelUsed, nodeOutput.output.approval_id);
      emitWorkflowEvent(onEvent, 'approval_required', {
        run_id: runId,
        workflow_key: workflowKey,
        node_key: currentNodeKey,
        approval_id: nodeOutput.output.approval_id,
        steps_completed: journalSteps.length,
        steps_total: nodes.length,
      });
      return {
        ok: true,
        status: 'awaiting_approval',
        run_id: runId,
        approval_id: nodeOutput.output.approval_id,
        steps_completed: journalSteps.length,
        journal_steps: journalSteps,
      };
    }

    runtimeValue = nextWorkflowRuntimeValue(nodeOutput, runtimeValue);
    const chosen = selectNextEdge(edgeMap, currentNodeKey, nodeOutput);
    if (chosen) {
      await recordExecutionStepEdge(env.DB, stepColumns, stepId, chosen);
      emitWorkflowEvent(onEvent, 'edge_selected', {
        run_id: runId,
        workflow_key: workflowKey,
        from_node_key: currentNodeKey,
        to_node_key: chosen.to_node_key,
      });
    }
    currentNodeKey = chosen?.to_node_key ?? null;
  }

  const durationMs = Math.max(0, Date.now() - runStartedAt);
  const status = await finalizeWorkflowRun(env.DB, {
    runId,
    ok,
    output: runtimeValue,
    journalSteps,
    usage: totals,
    modelUsed,
    durationMs,
    killReason,
  });
  await clearWorkflowContinuation(env.DB, runId);
  await finishExecutionParent(env, { executionId: workflowExecutionId, status, durationMs });

  emitWorkflowEvent(onEvent, ok ? 'run_completed' : 'run_failed', {
    run_id: runId,
    workflow_key: workflowKey,
    status,
    steps_completed: journalSteps.length,
    steps_total: nodes.length,
    kill_reason: killReason,
  });

  return {
    ok,
    status,
    run_id: runId,
    steps_completed: journalSteps.length,
    journal_steps: journalSteps,
    output: runtimeValue,
    kill_reason: killReason,
  };
}
