/**
 * SSE stream for agentsam plan execution (full plan or single-task resume).
 */

import { withPlanningRun } from '../../agentsam/runtime/plan/turn.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} opts
 * @returns {Response}
 */
export function startPlanExecuteSseResponse(env, ctx, opts) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const emit = (event, data) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify({ type: event, ...data })}\n\n`));
    } catch (_) {}
  };

  (async () => {
    try {
      emit('plan_execute_start', {
        plan_id: opts.planId,
        only_task_id: opts.onlyTaskId ?? null,
      });
      if (typeof opts.executePlan !== 'function') {
        throw new Error('plan_executor_not_composed');
      }
      await withPlanningRun(
        env,
        {
          userId: opts.userId,
          tenantId: opts.tenantId,
          workspaceId: opts.workspaceId,
          conversationId: opts.sessionId ?? null,
        },
        async () => {
          const commandRuntime = await import('../../agentsam/commands/index.js');
          const summary = await opts.executePlan(env, {
            planId: opts.planId,
            userId: opts.userId,
            workspaceId: opts.workspaceId,
            tenantId: opts.tenantId,
            emit,
            ctx,
            onlyTaskId: opts.onlyTaskId ?? null,
            sessionId: opts.sessionId ?? null,
            skipPlanAggregate: Boolean(opts.skipPlanAggregate),
            workflowRunId: opts.workflowRunId ?? null,
            request: opts.request ?? null,
            commandRuntime,
          });
          if (!opts.skipPlanAggregate && opts.workflowRunId) {
            const { finalizeAgentChatPlanWorkflowRun } = await import('../../workflows/integrations/agent-plan.js');
            await finalizeAgentChatPlanWorkflowRun(env, ctx, {
              runId: opts.workflowRunId,
              planId: opts.planId,
              ...summary,
            });
            emit('workflow_complete', {
              workflow_run_id: opts.workflowRunId,
              plan_id: opts.planId,
              tasks_completed: summary.completed,
              tasks_failed: summary.failed,
              tasks_skipped: summary.skipped,
              status: summary.failed === 0 ? 'completed' : 'partial',
            });
          }
          return {
            planningRun: {
              status: summary.failed === 0 ? 'completed' : 'partial',
              success: summary.failed === 0,
            },
          };
        },
        { signal: opts.request?.signal ?? null },
      );
      emit('done', {});
    } catch (e) {
      emit('text', { text: `**Plan execute error:** ${e?.message ?? String(e)}` });
      emit('done', {});
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: SSE_HEADERS });
}
