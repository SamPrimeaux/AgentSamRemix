/**
 * POST /api/agent/plan/intake/submit — resume planning after Questions card Continue/Skip.
 */

import { planningRunLifecycle, startPlanningRun } from '../../agentsam/runtime/plan/turn.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {{ plan_title?: string, tasks?: Array<{ title?: string }>, goal?: string }} plan
 * @param {string} goal
 */
function buildPlanSummaryText(plan, goal) {
  const title = String(plan?.plan_title || '').trim();
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const taskHint = tasks
    .slice(0, 3)
    .map((t) => String(t?.title || '').trim())
    .filter(Boolean)
    .join('; ');
  if (title && taskHint) return `${title} — ${taskHint}${tasks.length > 3 ? '…' : ''}`;
  if (title) return title;
  return String(goal || 'Plan').slice(0, 240);
}
/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   batchId: string,
 *   selections?: Record<string, string>,
 *   optionalDetails?: string,
 *   skip?: boolean,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   sessionId?: string|null,
 * }} input
 */
export async function startPlanIntakeSubmitSseResponse(env, ctx, input, services = {}) {
  const intake = services.intake || {};
  const buildEnrichedGoalFromIntakeBatch = intake.buildEnrichedGoalFromIntakeBatch;
  const getPlanIntakeBatch = intake.getPlanIntakeBatch;
  const submitPlanIntakeBatch = intake.submitPlanIntakeBatch;
  if (
    typeof buildEnrichedGoalFromIntakeBatch !== 'function' ||
    typeof getPlanIntakeBatch !== 'function' ||
    typeof submitPlanIntakeBatch !== 'function'
  ) {
    throw new Error('plan_intake_services_required');
  }
  const batchId = String(input.batchId || '').trim();
  const batchPreview = await getPlanIntakeBatch(env, batchId);

  // quickstart_intake batches (Quickstart-card first turn) don't produce a Plan — resume
  // the original agent/ask/debug turn with the enriched goal and stream that back directly.
  if (
    String(batchPreview?.phase || '') === 'quickstart_intake' &&
    String(batchPreview?.status || '') === 'pending'
  ) {
    const submitted = await submitPlanIntakeBatch(env, batchId, {
      selections: input.selections,
      optionalDetails: input.optionalDetails,
      skipped: input.skip === true,
    });
    if (typeof services.resumeQuickstartIntakeTurn !== 'function') {
      throw new Error('quickstart_intake_resume_unavailable');
    }
    return services.resumeQuickstartIntakeTurn(env, ctx, { batch: submitted.batch, input });
  }

  const planningRun = await startPlanningRun(env, {
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.sessionId ?? null,
  });
  input.planningRun = planningRunLifecycle(env, planningRun, input.request?.signal ?? null);
  let submitted;
  try {
    submitted = await submitPlanIntakeBatch(env, batchId, {
      selections: input.selections,
      optionalDetails: input.optionalDetails,
      skipped: input.skip === true,
    });
  } catch (error) {
    await input.planningRun.fail(error).catch(() => {});
    throw error;
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const emit = (type, payload) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
    } catch (_) {}
  };

  (async () => {
    try {
      if (!submitted.ok) {
        await input.planningRun?.fail(new Error(submitted.error || 'plan_intake_submit_failed')).catch(() => {});
        emit('text', { text: `**Plan intake error:** ${submitted.error}` });
        emit('done', {});
        return;
      }

      const batch = submitted.batch;
      const goal = buildEnrichedGoalFromIntakeBatch(batch);
      const tenantId = input.tenantId != null ? String(input.tenantId) : String(batch.tenant_id || '');
      const workspaceId =
        input.workspaceId != null ? String(input.workspaceId) : String(batch.workspace_id || '');
      const userId = input.userId != null ? String(input.userId) : String(batch.user_id || '');
      const sessionId = input.sessionId != null ? String(input.sessionId) : String(batch.session_id || '');

      emit('plan_thinking', { message: 'Creating plan from your answers…' });

      const createPlan = services.planner?.createPlan;
      const { startAgentChatPlanWorkflowRun, setAgentChatPlanWorkflowTaskCount } = services.workflow || {};
      if (
        typeof createPlan !== 'function' ||
        typeof startAgentChatPlanWorkflowRun !== 'function' ||
        typeof setAgentChatPlanWorkflowTaskCount !== 'function'
      ) {
        throw new Error('plan_creation_services_required');
      }
      const wfBoot = await startAgentChatPlanWorkflowRun(env, {
        tenantId,
        workspaceId,
        userId,
        sessionId,
        goal,
      });

      const plan = await createPlan(env, {
        goal,
        userId,
        workspaceId,
        tenantId,
        sessionId,
        workflowRunId: wfBoot.workflowRunId,
        workflowExecutionId: wfBoot.executionParentId,
        ctx,
        planningSkillMarkdown: '',
      });

      await setAgentChatPlanWorkflowTaskCount(env, wfBoot.workflowRunId, plan.tasks.length);

      const planId = plan.plan_id;
      const r2Url = plan.plan_markdown?.public_url ? String(plan.plan_markdown.public_url).trim() : '';
      const filename = `plan-${planId}.md`;

      if (r2Url) {
        emit('monaco_file_generated', {
          type: 'monaco_file_generated',
          surface: 'monaco',
          plan_id: planId,
          filename,
          path: services.planLocalRelPath(planId),
          language: 'markdown',
          r2_url: r2Url,
        });
      }

      const summary = buildPlanSummaryText(plan, goal);

      if (env?.DB && batchId) {
        await env.DB.prepare(`UPDATE agentsam_plan_intake_batches SET plan_id = ? WHERE id = ?`)
          .bind(planId, batchId)
          .run()
          .catch(() => {});
      }

      emit('plan_created', {
        plan_id: planId,
        plan_title: plan.plan_title,
        workflow_run_id: plan.workflow_run_id,
        task_count: plan.tasks.length,
        auto_execute: false,
        summary,
        plan_markdown: plan.plan_markdown ?? null,
      });

      emit('text', {
        text: `**${plan.plan_title || 'Plan'}** — ${summary}. Edit the plan in the editor, then use **Run plan** when ready.`,
      });
      await input.planningRun?.complete({ status: 'completed' });
      emit('done', {});
    } catch (e) {
      await input.planningRun?.fail(e).catch(() => {});
      emit('text', { text: `**Plan error:** ${e?.message ?? String(e)}` });
      emit('done', {});
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: SSE_HEADERS });
}
