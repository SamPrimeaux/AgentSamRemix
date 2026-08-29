/**
 * In-app /plan slash — enables Plan mode without sending a chat turn.
 */

/**
 * @param {any} env
 * @param {any} ctx
 * @param {string} toolKey
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>} runContext
 */
export async function dispatchInAppPlanCommand(env, ctx, toolKey, args, runContext) {
  const key = String(toolKey || '').trim().toLowerCase();
  if (key !== 'plan.start' && !key.endsWith('.plan.start') && key !== 'plan') {
    return {
      ok: false,
      error: 'unknown_plan_command',
      user_message: `Unknown plan command: ${toolKey}`,
    };
  }

  const goal = String(args?.goal ?? args?.message ?? '').trim();
  return {
    ok: true,
    action: 'plan_start',
    plan_mode: true,
    force_plan_mode: true,
    user_message: goal
      ? `Plan mode — describe your goal after /plan, then send. (${goal.slice(0, 80)}…)`
      : 'Plan mode enabled. Describe what you want to build, then send — I will explore the codebase, ask clarifying questions if needed, and draft a plan in Monaco.',
  };
}
