/**
 * Insert / finalize rows in agentsam_script_runs whenever a registered agentsam_scripts
 * entry is executed (Worker, CI callback, or manual API). Keeps audit trail aligned with registry.
 *
 * Optional: writes agentsam_hook_execution rows when agentsam_hook rows opt in via
 * metadata.agentsam_script_id (see agentsam-hook-script-bridge.js). Pass hookAudit: false to skip.
 *
 * CLI / deploy: use `scripts/run-with-agentsam-script-telemetry.mjs` (wraps shell commands with
 * INSERT/UPDATE on remote D1). Post-deploy: `npm run r2:prune` from deploy-full.sh.
 *
 * Worker terminal: POST /api/agent/terminal/run accepts optional `agentsam_script_id`,
 * `workspace_id`, `trigger_source` for the same audit trail.
 */

import { recordHookExecutionsForAgentsamScriptRun } from './agentsam-hook-script-bridge.js';

/**
 * @param {any} db
 * @param {{
 *   scriptId: string,
 *   workspaceId: string,
 *   triggeredBy?: string,
 *   triggerSource?: 'agent_sam'|'cursor'|'manual'|'github_push'|'scheduled'|'cicd',
 *   environment?: 'production'|'sandbox'|'staging'|'dev',
 *   cicdRunId?: string | null,
 *   gitCommitSha?: string | null,
 *   gitBranch?: string | null,
 *   tenantId?: string | null,
 *   userId?: string | null,
 *   hookAudit?: boolean,
 * }} row
 * @returns {Promise<{ id: string } | null>}
 */
export async function startAgentsamScriptRun(db, row) {
  if (!db || !row?.scriptId || !row?.workspaceId) return null;
  const triggerSource = row.triggerSource ?? 'agent_sam';
  const triggeredBy = row.triggeredBy ?? 'agent';
  const environment = row.environment ?? 'production';
  try {
    const inserted = await db
      .prepare(
        `INSERT INTO agentsam_script_runs (
           script_id, workspace_id, triggered_by, trigger_source,
           cicd_run_id, git_commit_sha, git_branch, environment,
           status, started_at
         ) VALUES (?,?,?,?,?,?,?,?, 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         RETURNING id`,
      )
      .bind(
        row.scriptId,
        row.workspaceId,
        triggeredBy,
        triggerSource,
        row.cicdRunId ?? null,
        row.gitCommitSha ?? null,
        row.gitBranch ?? 'main',
        environment,
      )
      .first();
    const id = inserted?.id;
    if (!id) return null;
    const rid = String(id);
    if (row.hookAudit !== false) {
      await recordHookExecutionsForAgentsamScriptRun(db, {
        phase: 'pre_deploy',
        scriptId: row.scriptId,
        scriptRunId: rid,
        workspaceId: row.workspaceId,
        tenantId: row.tenantId ?? null,
        userId: row.userId ?? null,
      });
    }
    return { id: rid };
  } catch (e) {
    console.warn('[agentsam_script_runs] start failed', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} db
 * @param {string} runId
 * @param {{
 *   status: 'passed'|'failed'|'skipped'|'cancelled',
 *   exitCode?: number | null,
 *   durationMs?: number | null,
 *   outputSummary?: string | null,
 *   errorMessage?: string | null,
 *   costUsd?: number | null,
 * }} fin
 * @param {{
 *   scriptId: string,
 *   workspaceId: string,
 *   tenantId?: string | null,
 *   userId?: string | null,
 *   hookAudit?: boolean,
 * } | null | undefined} hookCtx
 */
export async function finalizeAgentsamScriptRun(db, runId, fin, hookCtx) {
  if (!db || !runId || !fin?.status) return;
  try {
    await db
      .prepare(
        `UPDATE agentsam_script_runs SET
           status = ?,
           exit_code = ?,
           duration_ms = ?,
           output_summary = ?,
           error_message = ?,
           cost_usd = COALESCE(?, cost_usd),
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .bind(
        fin.status,
        fin.exitCode ?? null,
        fin.durationMs ?? null,
        fin.outputSummary ?? null,
        fin.errorMessage ?? null,
        fin.costUsd ?? null,
        runId,
      )
      .run();
    if (hookCtx && hookCtx.hookAudit !== false && hookCtx.scriptId && hookCtx.workspaceId) {
      await recordHookExecutionsForAgentsamScriptRun(db, {
        phase: 'post_deploy',
        scriptId: hookCtx.scriptId,
        scriptRunId: runId,
        workspaceId: hookCtx.workspaceId,
        tenantId: hookCtx.tenantId ?? null,
        userId: hookCtx.userId ?? null,
        scriptStatus: fin.status,
        durationMs: fin.durationMs ?? null,
        outputSummary: fin.outputSummary ?? null,
        errorMessage: fin.errorMessage ?? null,
      });
    }
  } catch (e) {
    console.warn('[agentsam_script_runs] finalize failed', e?.message ?? e);
  }
}
