/**
 * Private managed memory maintenance — report only; no silent deletion of decisions.
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../../services/database/hyperdrive.js';
import { buildMemorySyncKey } from './private-memory.js';

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId?: string,
 * }} scope
 */
export async function runAgentsamMemoryMaintenance(env, scope) {
  const tenantId = String(scope.tenantId ?? '').trim();
  const workspaceId = String(scope.workspaceId ?? '').trim();
  const userId = scope.userId != null ? String(scope.userId).trim() : '';

  const report = {
    ok: true,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    duplicate_sync_keys: [],
    stale_state_rows: [],
    old_unresolved_errors: [],
    d1_missing_private_mirror: [],
    private_missing_d1_cache: [],
    proposals: [],
  };

  if (!tenantId || !workspaceId) {
    report.ok = false;
    report.error = 'missing_scope';
    return report;
  }

  if (env?.DB) {
    const userClause = userId ? ' AND user_id = ?' : '';
    const d1Binds = userId ? [tenantId, workspaceId, userId] : [tenantId, workspaceId];
    const { results: d1Rows } = await env.DB.prepare(
      `SELECT id, user_id, key, memory_type, sync_key, updated_at, is_archived, value
       FROM agentsam_memory
       WHERE tenant_id = ?
         AND (workspace_id = ? OR workspace_id IS NULL)
         ${userClause}
         AND (expires_at IS NULL OR expires_at > unixepoch())
         AND COALESCE(is_archived, 0) = 0`,
    )
      .bind(...d1Binds)
      .all();

    if (isHyperdriveUsable(env)) {
      const pgSql = userId
        ? `SELECT memory_key, sync_key, d1_id FROM agentsam.agentsam_memory
           WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND is_archived = false`
        : `SELECT memory_key, sync_key, d1_id FROM agentsam.agentsam_memory
           WHERE tenant_id = $1 AND workspace_id = $2 AND is_archived = false`;
      const pgBinds = userId ? [tenantId, workspaceId, userId] : [tenantId, workspaceId];
      const pg = await runHyperdriveQuery(env, pgSql, pgBinds);
      const pgBySync = new Map((pg.rows ?? []).map((r) => [String(r.sync_key), r]));

      for (const row of d1Rows ?? []) {
        const sk =
          row.sync_key ||
          buildMemorySyncKey(tenantId, String(row.user_id), String(row.key));
        if (!pgBySync.has(sk)) {
          report.d1_missing_private_mirror.push({
            d1_id: row.id,
            key: row.key,
            memory_type: row.memory_type,
            sync_key: sk,
          });
        }
      }

      const d1BySync = new Map(
        (d1Rows ?? []).map((r) => [
          r.sync_key ||
            buildMemorySyncKey(tenantId, String(r.user_id), String(r.key)),
          r,
        ]),
      );
      for (const pr of pg.rows ?? []) {
        const sk = String(pr.sync_key);
        if (!d1BySync.has(sk)) {
          report.private_missing_d1_cache.push({
            memory_key: pr.memory_key,
            sync_key: sk,
            d1_id: pr.d1_id,
          });
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    for (const row of d1Rows ?? []) {
      if (String(row.memory_type) === 'state') {
        const ageH = (now - Number(row.updated_at || 0)) / 3600;
        if (ageH > 48) {
          report.stale_state_rows.push({
            key: row.key,
            updated_at: row.updated_at,
            age_hours: Math.round(ageH),
          });
        }
      }
      if (String(row.memory_type) === 'error' && String(row.key).startsWith('error:')) {
        const ageD = (now - Number(row.updated_at || 0)) / 86400;
        if (ageD > 30) {
          report.old_unresolved_errors.push({
            key: row.key,
            age_days: Math.round(ageD),
          });
        }
      }
    }
  }

  if (isHyperdriveUsable(env)) {
    const dup = await runHyperdriveQuery(
      env,
      `SELECT sync_key, COUNT(*)::int AS c
       FROM agentsam.agentsam_memory
       WHERE tenant_id = $1 AND workspace_id = $2 AND is_archived = false
       GROUP BY sync_key HAVING COUNT(*) > 1`,
      [tenantId, workspaceId],
    );
    if (dup.ok && dup.rows?.length) {
      report.duplicate_sync_keys = dup.rows;
    }
  }

  if (report.stale_state_rows.length) {
    report.proposals.push({
      action: 'refresh_state',
      keys: report.stale_state_rows.map((r) => r.key),
      note: 'state:* rows older than 48h — update via deploy_hook or state:production upsert',
    });
  }
  if (report.d1_missing_private_mirror.length) {
    report.proposals.push({
      action: 'run_backfill',
      count: report.d1_missing_private_mirror.length,
      script: 'scripts/backfill-agentsam-memory-private-pg.mjs',
    });
  }
  if (report.old_unresolved_errors.length) {
    report.proposals.push({
      action: 'review_errors',
      keys: report.old_unresolved_errors.map((r) => r.key),
      note: 'Archive or supersede only after human review — never auto-delete decisions',
    });
  }

  return report;
}
