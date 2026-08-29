import { executeWorkflow, getWorkflowRun } from '../../workflows/index.js';

function makeSender(controller) {
  const encoder = new TextEncoder();
  return (data) => {
    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
  };
}

function legacyWireAdapter(send) {
  return (event) => {
    switch (event?.type) {
      case 'run_started':
        send({
          type: 'workflow_start',
          workflow_key: event.workflow_key,
          run_id: event.run_id,
          steps_total: event.steps_total ?? null,
          ...(event.resumed ? { resumed: true } : {}),
        });
        break;
      case 'node_completed':
      case 'node_failed':
        send({
          type: 'workflow_step',
          run_id: event.run_id,
          workflow_key: event.workflow_key,
          node_key: event.node_key,
          current_node_key: event.node_key,
          steps_completed: event.steps_completed,
          steps_total: event.steps_total,
          input_tokens: event.input_tokens,
          output_tokens: event.output_tokens,
          cost_usd: event.cost_usd,
          ok: event.type === 'node_completed',
        });
        break;
      case 'approval_required':
        send({
          type: 'workflow_approval_required',
          run_id: event.run_id,
          approval_id: event.approval_id,
          message: 'This workflow requires approval before continuing.',
        });
        break;
      case 'run_completed':
        send({
          type: 'workflow_complete',
          status: event.status,
          run_id: event.run_id,
          message: `Workflow ${event.workflow_key} completed (${event.steps_completed} steps).`,
        });
        break;
      case 'run_failed':
        send({
          type: 'workflow_error',
          status: event.status,
          run_id: event.run_id,
          message: `Workflow failed: ${event.kill_reason || 'unknown error'}`,
        });
        break;
      default:
        break;
    }
  };
}

export async function streamWorkflowSse(env, workflowKey, inputOrMessage, authUser, workspaceId, controller, opts = {}) {
  const send = makeSender(controller);
  const input = typeof inputOrMessage === 'string'
    ? { message: inputOrMessage }
    : inputOrMessage && typeof inputOrMessage === 'object'
      ? inputOrMessage
      : { message: String(inputOrMessage || '') };
  const result = await executeWorkflow(env, {
    workflowKey,
    input,
    tenantId: authUser?.tenant_id ?? null,
    workspaceId,
    userId: authUser?.id ?? null,
    userEmail: authUser?.email ?? null,
    onEvent: legacyWireAdapter(send),
    ctx: opts.ctx ?? null,
  }).catch((e) => ({ ok: false, status: 'error', run_id: null, kill_reason: e?.message || String(e) }));
  if (!result?.run_id) send({ type: 'workflow_error', message: result?.kill_reason || result?.error || 'workflow_failed' });
  send({ type: 'done' });
  try { controller.close(); } catch {}
  return result;
}

export async function streamWorkflowResumeSse(env, runId, authUser, workspaceId, controller, opts = {}) {
  const send = makeSender(controller);
  const run = await getWorkflowRun(env, runId);
  if (!run) {
    send({ type: 'workflow_error', message: 'run not found' });
    send({ type: 'done' });
    try { controller.close(); } catch {}
    return { ok: false, error: 'run_not_found' };
  }
  const result = await executeWorkflow(env, {
    workflowKey: run.workflow_key,
    input: {},
    tenantId: authUser?.tenant_id ?? run.tenant_id ?? null,
    workspaceId: workspaceId ?? run.workspace_id ?? null,
    userId: authUser?.id ?? run.user_id ?? null,
    userEmail: authUser?.email ?? run.user_email ?? null,
    resumeRunId: runId,
    onEvent: legacyWireAdapter(send),
    ctx: opts.ctx ?? null,
  }).catch((e) => ({ ok: false, status: 'error', run_id: runId, kill_reason: e?.message || String(e) }));
  if (!result?.run_id) send({ type: 'workflow_error', message: result?.kill_reason || result?.error || 'workflow_resume_failed' });
  send({ type: 'done' });
  try { controller.close(); } catch {}
  return result;
}
