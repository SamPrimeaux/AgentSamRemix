/**
 * Quickstart card first-turn intake → plan_questions_batch.
 */

import { reportAgentControllerWarning } from './agent-controller-report.js';

/**
 * Quickstart seed messages are meta-instructions to the MODEL ("Ask the user what they
 * need before doing anything. Wait for answers before generating."), not task
 * descriptions. Strip ask/wait sentences for intake + fallthrough.
 * @param {string} text
 */
export function stripQuickstartAskInstructions(text) {
  const raw = String(text || '').trim();
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\b(ask|wait for (the )?answers?)\b/i.test(s));
  const cleaned = sentences.join(' ').trim();
  return cleaned || raw;
}

/**
 * @returns {Promise<{ handled: boolean, chatMessages: any[] }>}
 */
export async function tryQuickstartIntake(env, emit, args) {
  const {
    quickstartBatch,
    chatMessages,
    threadSlashAction,
    createSubagentFlow,
    message,
    userId,
    workspaceId,
    sessionId,
    tenantId,
    body,
    profile,
    subagentProfileRow,
    chatMessagesHaveVisionUpload,
    planIntake,
  } = args;

  if (
    !quickstartBatch ||
    chatMessages.length > 1 ||
    threadSlashAction ||
    createSubagentFlow.active
  ) {
    return { handled: false, chatMessages };
  }

  let nextMessages = chatMessages;
  try {
    const {
      runPlanIntakeExplore,
      generatePlanIntakeQuestions,
      formatPlanIntakeQuestionsForUi,
      insertPlanIntakeBatch,
      newPlanIntakeBatchId,
      supersedePendingBatchesForSession,
    } = planIntake || {};
    if (
      typeof runPlanIntakeExplore !== 'function' ||
      typeof generatePlanIntakeQuestions !== 'function' ||
      typeof formatPlanIntakeQuestionsForUi !== 'function' ||
      typeof insertPlanIntakeBatch !== 'function' ||
      typeof newPlanIntakeBatchId !== 'function' ||
      typeof supersedePendingBatchesForSession !== 'function'
    ) {
      throw new Error('plan_intake_services_required');
    }

    const goalForIntake = stripQuickstartAskInstructions(message);

    if (userId && workspaceId && sessionId) {
      await supersedePendingBatchesForSession(env, { workspaceId, sessionId });
    }

    const explore = await runPlanIntakeExplore(env, {
      goal: goalForIntake,
      workspaceId: workspaceId || '',
      intent: 'mixed',
    });

    const intake = await generatePlanIntakeQuestions(env, {
      goal: goalForIntake,
      explore,
      phase: 'quickstart_intake',
      userId,
      workspaceId,
    });

    if (intake.needs_questions) {
      const batchId = newPlanIntakeBatchId();
      const questionsUi = formatPlanIntakeQuestionsForUi(intake.questions);

      await insertPlanIntakeBatch(env, {
        id: batchId,
        tenant_id: tenantId || env?.TENANT_ID || '',
        workspace_id: workspaceId || '',
        user_id: userId,
        session_id: sessionId,
        phase: 'quickstart_intake',
        status: 'pending',
        goal_text: goalForIntake,
        explore_summary_json: JSON.stringify({ ...explore, synthesis: intake.synthesis }),
        questions_json: JSON.stringify(intake.questions),
        roadblock_context_json: JSON.stringify({
          source: 'quickstart_intake',
          route_key:
            body.route_key ??
            body.routeKey ??
            profile.refined_route_key ??
            profile.mode,
          task_type:
            body.task_type ??
            body.taskType ??
            profile.routing_task_type ??
            null,
          quickstart_card: body.quickstart_card ?? body.quickstartCard ?? null,
          model_key: profile.model_key || null,
          subagent_slug: subagentProfileRow?.slug ?? null,
          requested_mode: 'agent',
        }),
      });

      emit('plan_questions_batch', {
        batch_id: batchId,
        phase: 'quickstart_intake',
        explore_summary: {
          synthesis: intake.synthesis || explore.synthesis,
          files_searched: explore.files_searched,
          searches: explore.searches,
        },
        questions: questionsUi,
        allow_skip: true,
      });
      emit('done', {});
      return { handled: true, chatMessages: nextMessages };
    }

    if (
      nextMessages.length === 1 &&
      nextMessages[0]?.role === 'user' &&
      !chatMessagesHaveVisionUpload(nextMessages)
    ) {
      nextMessages = [{ ...nextMessages[0], content: goalForIntake }];
    }
  } catch (e) {
    reportAgentControllerWarning(env, 'quickstart_intake', e, {
      workspaceId,
      tenantId,
      sessionId,
    });
  }
  return { handled: false, chatMessages: nextMessages };
}
