/**
 * Post-usage spend alert trigger — delegates to workspace spend guard.
 * Ownership stays with billing/spend-guard until that domain peels; telemetry only schedules it.
 */

/**
 * @param {any} env
 * @param {any} executionCtx
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId?: string|null,
 *   sessionId?: string|null,
 * }} ctx
 */
export async function scheduleSpendAlerts(env, executionCtx, ctx) {
  if (!executionCtx || !ctx?.workspaceId || !ctx?.tenantId) return;
  try {
    const { processWorkspaceSpendAlertsAfterUsage } = await import(
      '../identity/policy/workspace-spend.js'
    );
    void processWorkspaceSpendAlertsAfterUsage(env, executionCtx, {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId != null ? String(ctx.userId).trim() : null,
      sessionId: ctx.sessionId ?? null,
      isPlatformOperator: false,
    });
  } catch (alertErr) {
    console.warn('[telemetry/spend-alerts]', alertErr?.message ?? alertErr);
  }
}
