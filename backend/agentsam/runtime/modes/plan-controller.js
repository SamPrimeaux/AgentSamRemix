function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
import { runtimeContextPayload, legacyContextPayload } from './runtime-context.js';
import {
  planningRunLifecycle,
  startPlanningRun,
  withPlanningRun,
} from '../plan/turn.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

const PLAN_SKILL_ID = 'skill_plan_and_execute';

/**
 * @param {any} env
 */
async function loadPlanModeSkillMarkdown(env, services = {}) {
  if (!env?.DB) return { markdown: '', skill_ids: [] };
  try {
    const row = await env.DB.prepare(
      `SELECT id, name, content_markdown, retrieval_strategy, file_path, metadata_json
       FROM agentsam_skill WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(PLAN_SKILL_ID)
      .first();
    if (!row?.id) return { markdown: '', skill_ids: [] };
    const hydrated = typeof services.hydrateSkillRowFromR2 === 'function'
      ? await services.hydrateSkillRowFromR2(env, row)
      : row;
    const md = String(hydrated?.content_markdown || '').trim();
    return { markdown: md, skill_ids: [String(row.id)] };
  } catch (e) {
    console.warn('[plan-controller] skill_load_failed', e?.message ?? e);
    return { markdown: '', skill_ids: [] };
  }
}

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
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {{
 *   message: string,
 *   userId: string|null,
 *   tenantId: string|null,
 *   workspaceId: string|null,
 *   sessionId: string|null,
 *   planningSkillMarkdown: string,
 * }} input
 */
async function runPlanCreationPipeline(env, ctx, emit, input) {
  const services = input.services || {};
  const createPlan = services.planner?.createPlan;
  const { startAgentChatPlanWorkflowRun, setAgentChatPlanWorkflowTaskCount } = services.workflow || {};
  if (typeof createPlan !== 'function' || typeof startAgentChatPlanWorkflowRun !== 'function' ||
      typeof setAgentChatPlanWorkflowTaskCount !== 'function') {
    throw new Error('plan_creation_services_required');
  }

  const wfBoot = await startAgentChatPlanWorkflowRun(env, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    sessionId: input.sessionId,
    goal: input.message,
  });

  const plan = await createPlan(env, {
    goal: input.message,
    userId: input.userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    workflowRunId: wfBoot.workflowRunId,
    workflowExecutionId: wfBoot.executionParentId,
    ctx,
    planningSkillMarkdown: input.planningSkillMarkdown,
  });

  await setAgentChatPlanWorkflowTaskCount(env, wfBoot.workflowRunId, plan.tasks.length);

  const planId = plan.plan_id;
  const cmsSlugFromGoal = services.intake?.isCmsPlanGoal?.(input.message)
    ? services.intake.parseCmsSlugFromPlanGoal(input.message)
    : null;
  if (cmsSlugFromGoal && input.workspaceId && typeof services.linkCmsProjectPlan === 'function') {
    await services.linkCmsProjectPlan(env, input.workspaceId, cmsSlugFromGoal, planId);
  }
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

  const summary = buildPlanSummaryText(plan, input.message);

  emit('plan_created', {
    plan_id: planId,
    plan_title: plan.plan_title,
    workflow_run_id: plan.workflow_run_id,
    task_count: plan.tasks.length,
    auto_execute: false,
    summary,
    plan_markdown: plan.plan_markdown ?? null,
    cursor_parity: true,
    build_label: 'Build',
    save_to_workspace: true,
  });

  emit('text', {
    text: `**${plan.plan_title || 'Plan'}** — ${summary}. Review/edit the plan file, use **Save to workspace** to persist to ARTIFACTS, then **Build** when ready.`,
  });
}

/**
 * Plan controller
 * - explore → optional Questions batch → createPlan (via intake submit)
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{ request?: Request, message: string, profile: object, session?: any, modelOverride?: string|null, planServices?: object }} input
 */
export async function executePlanTurn(env, ctx, input) {
  const profile = input.profile;
  const services = input.planServices || {};
  const intake = services.intake || {};
  const body = /** @type {Record<string, unknown>} */ (input.body || {});
  const refinePlanId = String(body.plan_id ?? body.planId ?? '').trim();
  const isRefine = body.refine_plan === true || body.refinePlan === true;
  if (profile.mode !== 'plan') {
    return jsonResponse(
      { error: 'plan_controller_mode_mismatch', mode: profile.mode },
      400,
    );
  }
  const message = String(input.message || '');
  if (isRefine && refinePlanId && message) {
    const session = input.session || {};
    const userId = session.userId != null ? String(session.userId) : null;
    const tenantId = session.tenantId != null ? String(session.tenantId) : null;
    const workspaceId = session.workspaceId != null ? String(session.workspaceId) : null;
    const sessionId = session.sessionId != null ? String(session.sessionId) : null;
    const skillLoad = await loadPlanModeSkillMarkdown(env, services);
    const startPlanRefineSseResponse = services.startPlanRefineSseResponse;
    if (typeof startPlanRefineSseResponse !== 'function') {
      return jsonResponse({ error: 'plan_refine_unavailable' }, 503);
    }
    const planningRun = await startPlanningRun(env, {
      userId,
      tenantId,
      workspaceId,
      conversationId: sessionId,
    }, {
      modelKey: profile.model_key,
      routingArmId: profile.routing_arm_id,
      selectedBy: profile.routing_selected_by || (input.modelOverride ? 'requested' : 'thompson'),
    });
    return startPlanRefineSseResponse(env, ctx, {
      planId: refinePlanId,
      refinement: message,
      userId,
      tenantId,
      workspaceId,
      sessionId,
      planningSkillMarkdown: skillLoad.markdown,
      planningRun: planningRunLifecycle(env, planningRun, input.request?.signal ?? null),
    }, services);
  }

  const session = input.session || {};
  const userId = session.userId != null ? String(session.userId) : null;
  const tenantId = session.tenantId != null ? String(session.tenantId) : null;
  const workspaceId = session.workspaceId != null ? String(session.workspaceId) : null;
  const sessionId = session.sessionId != null ? String(session.sessionId) : null;

  const encoder = new TextEncoder();
  const { readable: planReadable, writable: planWritable } = new TransformStream();
  const planWriter = planWritable.getWriter();
  const reqSignal = input.request?.signal ?? null;
  const emit = (type, payload) => {
    if (reqSignal?.aborted) return;
    try {
      planWriter.write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
    } catch (_) {}
  };
  const throwIfAborted = () => {
    if (reqSignal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  emit('runtime_context', runtimeContextPayload(profile, { modelOverride: input.modelOverride ?? null }));
  emit('context', legacyContextPayload(profile, { toolsCount: 0, modelOverride: input.modelOverride ?? null }));

  (async () => {
    try {
      await withPlanningRun(
        env,
        { userId, tenantId, workspaceId, conversationId: sessionId },
        async ({ runId }) => {
          emit('status', {
            phase: 'plan_run_scheduled',
            conversation_id: sessionId || null,
            agent_run_id: runId,
          });
          throwIfAborted();
          const skillLoad = await loadPlanModeSkillMarkdown(env, services);
          throwIfAborted();
          if (skillLoad.skill_ids.length) {
            emit('skills_loaded', {
              skill_ids: skillLoad.skill_ids,
              route_key: 'plan',
              task_type: 'plan',
            });
          }

          emit('plan_explore_start', { message: 'Exploring codebase and context…' });
          emit('plan_thinking', { message: 'Exploring codebase and context…' });

          const explorePromise = intake.runPlanIntakeExplore(env, {
            goal: message,
            workspaceId: workspaceId || '',
            intent: 'mixed',
          });
          const explore = reqSignal
            ? await Promise.race([
                explorePromise,
                new Promise((_, reject) => {
                  const onAbort = () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                  };
                  if (reqSignal.aborted) onAbort();
                  else reqSignal.addEventListener('abort', onAbort, { once: true });
                }),
              ])
            : await explorePromise;
          throwIfAborted();

          for (const step of explore.steps || []) {
            emit('plan_explore_step', {
              kind: step.kind || 'file',
              label: step.label || '',
              lane: step.lane || null,
            });
          }

          emit('plan_explore_progress', {
            files_searched: explore.files_searched,
            searches: explore.searches,
            synthesis: explore.synthesis,
            message: explore.synthesis,
            findings: (explore.findings || []).slice(0, 8).map((f) => ({
              path: f.path,
              title: f.title,
              lane: f.lane,
            })),
          });

          throwIfAborted();

          const intakeResult = await intake.generatePlanIntakeQuestions(env, {
            goal: message,
            explore,
            phase: 'pre_plan',
            userId,
            workspaceId,
          });
          throwIfAborted();

          if (intakeResult.needs_questions) {
            await intake.supersedePendingBatchesForSession(env, { workspaceId, sessionId });
            const batchId = intake.newPlanIntakeBatchId();
            const questionsUi = intake.formatPlanIntakeQuestionsForUi(intakeResult.questions);

            const cmsSlug = intake.isCmsPlanGoal(message) ? intake.parseCmsSlugFromPlanGoal(message) : null;
            const cmsMeta = cmsSlug
              ? JSON.stringify({
                  source: 'cms_studio',
                  project_slug: cmsSlug,
                  page_id: body.page_id ?? body.pageId ?? null,
                  bootstrap_cache_key: body.bootstrap_cache_key ?? null,
                  collab_room: body.collab_room ?? (cmsSlug ? `cms:${body.page_id || ''}` : null),
                })
              : null;

            await intake.insertPlanIntakeBatch(env, {
              id: batchId,
              tenant_id: tenantId || env?.TENANT_ID || '',
              workspace_id: workspaceId || '',
              user_id: userId,
              session_id: sessionId,
              phase: 'pre_plan',
              status: 'pending',
              goal_text: message,
              explore_summary_json: JSON.stringify({ ...explore, synthesis: intakeResult.synthesis }),
              questions_json: JSON.stringify(intakeResult.questions),
              optional_details: cmsMeta,
            });

            emit('plan_questions_batch', {
              batch_id: batchId,
              phase: 'pre_plan',
              explore_summary: {
                synthesis: intakeResult.synthesis || explore.synthesis,
                files_searched: explore.files_searched,
                searches: explore.searches,
              },
              questions: questionsUi,
              allow_skip: true,
            });
            return { planningRun: { status: 'completed' }, pausedForQuestions: true };
          }

          emit('plan_thinking', { message: 'Creating plan…' });
          await runPlanCreationPipeline(env, ctx, emit, {
            message,
            userId,
            tenantId,
            workspaceId,
            sessionId,
            planningSkillMarkdown: skillLoad.markdown,
            services,
          });
          return { planningRun: { status: 'completed' } };
        },
        {
          signal: reqSignal,
          modelKey: profile.model_key,
          routingArmId: profile.routing_arm_id,
          selectedBy: profile.routing_selected_by || (input.modelOverride ? 'requested' : 'thompson'),
        },
      );
      emit('done', {});
    } catch (e) {
      const aborted = e?.name === 'AbortError' || reqSignal?.aborted;
      if (!aborted) {
        emit('text', { text: `**Plan error:** ${e?.message ?? String(e)}` });
      }
      emit('done', { reason: aborted ? 'aborted' : 'error' });
    } finally {
      planWriter.close().catch(() => {});
    }
  })();

  return new Response(planReadable, { headers: SSE_HEADERS });
}
