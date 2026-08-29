/** Canonical workflow registry helpers. */

export const AGENTSAM_WORKFLOWS_TABLE = 'agentsam_workflows';
export const AGENTSAM_WORKFLOW_RUNS_TABLE = 'agentsam_workflow_runs';

export async function maxAgentsamWorkflowTimeoutSeconds(db, fallback, tenantId) {
  const fallbackSeconds = Math.max(1, Number(fallback) || 1);
  const tenant = tenantId != null ? String(tenantId).trim() : '';
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(timeout_ms) / 1000, ?) AS timeout_seconds
       FROM agentsam_workflows
       WHERE COALESCE(is_active, 1) = 1
         AND (tenant_id = ? OR (tenant_id IS NULL AND COALESCE(is_platform_global, 0) = 1))`,
    )
    .bind(fallbackSeconds, tenant)
    .first();
  return Math.max(fallbackSeconds, Number(row?.timeout_seconds) || fallbackSeconds);
}
