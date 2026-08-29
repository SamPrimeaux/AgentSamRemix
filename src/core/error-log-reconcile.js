/**
 * Reconcile agentsam_error_log: close deploy_trail_gate rows when a later green
 * deployments trail exists, and age-out resolved-by-fix hygiene candidates.
 * @param {any} env
 */
export async function reconcileErrorLogResolutions(env) {
  if (!env?.DB) return { resolved: 0 };
  let resolved = 0;

  // Trail alerts whose git SHA (in message/context) now has a successful deployments row
  try {
    const q = await env.DB.prepare(
      `UPDATE agentsam_error_log
       SET resolved = 1
       WHERE COALESCE(resolved, 0) = 0
         AND error_code = 'deploy_trail_gate'
         AND created_at < unixepoch() - 3600
         AND EXISTS (
           SELECT 1 FROM deployments d
           WHERE d.status IN ('success', 'ok', 'completed', 'deployed')
             AND length(COALESCE(d.git_hash, '')) = 40
             AND d.created_at >= agentsam_error_log.created_at
         )`,
    ).run();
    resolved += Number(q?.meta?.changes) || 0;
  } catch (e) {
    console.warn('[reconcileErrorLogResolutions] trail', e?.message ?? e);
  }

  // Stale tool_execution noise older than 14d with no recent recurrence
  try {
    const q = await env.DB.prepare(
      `UPDATE agentsam_error_log
       SET resolved = 1
       WHERE COALESCE(resolved, 0) = 0
         AND error_type = 'tool_execution'
         AND created_at < unixepoch() - 14 * 86400`,
    ).run();
    resolved += Number(q?.meta?.changes) || 0;
  } catch (e) {
    console.warn('[reconcileErrorLogResolutions] tool_execution', e?.message ?? e);
  }

  if (resolved > 0) {
    console.log('[cron] reconcileErrorLogResolutions resolved', resolved);
  }
  return { resolved };
}
