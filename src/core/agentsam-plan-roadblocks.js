/** Plan roadblock question generation; not workflow transport. */

/**
 * Emit a roadblock question batch mid-plan (called from executor when blocked).
 * @param {any} env
 * @param {any} ctx
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {{
 *   planId: string,
 *   workflowRunId?: string|null,
 *   tenantId: string,
 *   workspaceId: string,
 *   userId?: string|null,
 *   sessionId?: string|null,
 *   goal: string,
 *   roadblock: Record<string, unknown>,
 * }} opts
 */
export async function emitPlanRoadblockQuestions(env, ctx, emit, opts) {
  const {
    generatePlanIntakeQuestions,
    formatPlanIntakeQuestionsForUi,
    insertPlanIntakeBatch,
    runPlanIntakeExplore,
    supersedePendingBatchesForSession,
  } = await import('./agentsam-plan-intake.js');

  await supersedePendingBatchesForSession(env, {
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
  });

  const explore = await runPlanIntakeExplore(env, {
    goal: opts.goal,
    workspaceId: opts.workspaceId,
    intent: 'mixed',
  });

  const intake = await generatePlanIntakeQuestions(env, {
    goal: opts.goal,
    explore,
    phase: 'roadblock',
    roadblock: opts.roadblock,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
  });

  if (!intake.needs_questions) return { emitted: false };

  const questionsUi = formatPlanIntakeQuestionsForUi(intake.questions);
  const batchId = (await import('./agentsam-plan-intake.js')).newPlanIntakeBatchId();

  await insertPlanIntakeBatch(env, {
    id: batchId,
    tenant_id: opts.tenantId,
    workspace_id: opts.workspaceId,
    user_id: opts.userId,
    session_id: opts.sessionId,
    phase: 'roadblock',
    status: 'pending',
    goal_text: opts.goal,
    plan_id: opts.planId,
    workflow_run_id: opts.workflowRunId,
    explore_summary_json: JSON.stringify({ ...explore, synthesis: intake.synthesis }),
    questions_json: JSON.stringify(intake.questions),
    roadblock_context_json: JSON.stringify(opts.roadblock),
  });

  emit('plan_questions_batch', {
    batch_id: batchId,
    phase: 'roadblock',
    plan_id: opts.planId,
    explore_summary: {
      synthesis: intake.synthesis || explore.synthesis,
      files_searched: explore.files_searched,
      searches: explore.searches,
    },
    questions: questionsUi,
    allow_skip: true,
  });

  return { emitted: true, batch_id: batchId };
}
