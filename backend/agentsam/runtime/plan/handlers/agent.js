/**
 * Generic Agent Sam plan-task handler.
 *
 * Prompt policy belongs to the runtime profile/prompt composer. This handler
 * never invents a mode prompt; callers may provide a prepared prompt when a
 * task explicitly requires one.
 */

/**
 * @param {{
 *   env: any,
 *   ctx?: any,
 *   task: Record<string, unknown>,
 *   workspaceId: string,
 *   dispatchComplete: Function,
 *   resolveTaskExecutorModelKey: Function,
 *   recordArmOutcome?: Function,
 *   systemPrompt?: string|null,
 *   reasoningEffort?: string,
 *   verbosity?: string,
 * }} input
 */
export async function executeAgentPlanTask(input) {
  const {
    env,
    ctx,
    task,
    workspaceId,
    dispatchComplete,
    resolveTaskExecutorModelKey,
    recordArmOutcome,
    systemPrompt = null,
    reasoningEffort = 'low',
    verbosity,
  } = input;
  const resolved = await resolveTaskExecutorModelKey(env, workspaceId);
  const params = {
    modelKey: resolved.model_key,
    taskType: 'agent',
    messages: [{ role: 'user', content: task.description || task.title }],
    options: {
      reasoningEffort,
      ...(verbosity ? { verbosity } : {}),
    },
  };
  if (systemPrompt != null && String(systemPrompt).trim()) {
    params.systemPrompt = String(systemPrompt);
  }
  const result = await dispatchComplete(env, params);
  try {
    if (resolved?.routing_arm_id && typeof recordArmOutcome === 'function') {
      await recordArmOutcome(
        env,
        ctx,
        resolved.routing_arm_id,
        result?.ok ?? true,
        { model_key: resolved.model_key },
      );
    }
  } catch {
    /* Outcome recording must not change task execution. */
  }
  return {
    ok: result?.ok !== false,
    output: result?.text || result?.output_text || '',
  };
}
