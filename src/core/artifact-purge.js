/**
 * Purge agentsam_artifacts for a workspace — D1 rows + optional R2 objects.
 * Used for library reset / clean-slate UX testing (superadmin or internal automation).
 */
import { inferLegacyArtifactBucket, resolveArtifactR2Binding } from './artifact-key.js';
import { r2DeleteManyViaBindingOrS3 } from './r2.js';
import { deleteMirrorArtifact } from './dashboard-mirror-sync.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';

const PURGE_CONFIRM = 'PURGE_WORKSPACE_ARTIFACTS';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {string} key */
function isPurgeableR2Key(key) {
  const k = trim(key);
  if (!k) return false;
  if (k.includes('missing-r2-key')) return false;
  if (k.startsWith('artifacts/rebuilt/')) return false;
  return true;
}

/**
 * @param {any} env
 * @param {{
 *   isSa: boolean,
 *   userId: string | null,
 *   workspaceId: string | null,
 *   tenantId: string | null,
 * }} scope
 * @param {{
 *   workspaceId?: string | null,
 *   dryRun?: boolean,
 *   deleteR2?: boolean,
 * }} opts
 */
export async function purgeWorkspaceArtifacts(env, scope, opts = {}) {
  const dryRun = !!opts.dryRun;
  const deleteR2 = opts.deleteR2 !== false;
  const targetWorkspaceId = trim(opts.workspaceId) || trim(scope.workspaceId);

  if (!targetWorkspaceId) {
    return { ok: false, error: 'workspace_id_required' };
  }

  const where = ['workspace_id = ?'];
  const binds = [targetWorkspaceId];

  if (!scope.isSa) {
    if (!scope.userId) return { ok: false, error: 'user_scope_required' };
    where.push('user_id = ?');
    binds.push(scope.userId);
    if (scope.tenantId) {
      where.push('tenant_id = ?');
      binds.push(scope.tenantId);
    }
  } else if (scope.tenantId) {
    where.push('tenant_id = ?');
    binds.push(scope.tenantId);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_artifacts');
  const selectCols = ['id', 'r2_key', 'preview_r2_key', 'thumbnail_r2_key'];
  if (cols.has('r2_bucket')) selectCols.push('r2_bucket');

  const { results: rows } = await env.DB.prepare(
    `SELECT ${selectCols.join(', ')} FROM agentsam_artifacts ${whereSql}`,
  )
    .bind(...binds)
    .all();

  const artifactIds = (rows || []).map((r) => trim(r.id)).filter(Boolean);
  const keysByBucket = new Map();

  for (const row of rows || []) {
    const defaultBucket = cols.has('r2_bucket') ? trim(row.r2_bucket) : '';
    for (const field of ['r2_key', 'preview_r2_key', 'thumbnail_r2_key']) {
      const key = trim(row[field]);
      if (!isPurgeableR2Key(key)) continue;
      const bucket = defaultBucket || inferLegacyArtifactBucket(key);
      if (!keysByBucket.has(bucket)) keysByBucket.set(bucket, new Set());
      keysByBucket.get(bucket).add(key);
    }
  }

  const r2Plan = [...keysByBucket.entries()].map(([bucket, keySet]) => ({
    bucket,
    keys: [...keySet],
  }));
  const r2KeyCount = r2Plan.reduce((n, p) => n + p.keys.length, 0);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      workspace_id: targetWorkspaceId,
      d1_rows: artifactIds.length,
      r2_keys_planned: r2KeyCount,
      r2_buckets: r2Plan.map((p) => ({ bucket: p.bucket, keys: p.keys.length })),
    };
  }

  let r2Deleted = 0;
  const r2Errors = [];

  if (deleteR2) {
    for (const { bucket, keys } of r2Plan) {
      const binding = resolveArtifactR2Binding(env, bucket);
      const chunkSize = 500;
      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        const result = await r2DeleteManyViaBindingOrS3(env, binding, bucket, chunk);
        r2Deleted += Number(result?.deleted ?? 0) || 0;
        for (const err of result?.errors || []) {
          r2Errors.push({ bucket, ...err });
        }
      }
    }
  }

  if (artifactIds.length) {
    const placeholders = artifactIds.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM agentsam_artifact_skills WHERE artifact_id IN (${placeholders})`)
      .bind(...artifactIds)
      .run()
      .catch(() => {});
    await env.DB.prepare(`DELETE FROM agentsam_artifacts ${whereSql}`)
      .bind(...binds)
      .run();
  }

  const mirrorResults = await Promise.allSettled(
    artifactIds.map((id) => deleteMirrorArtifact(env, id)),
  );
  const mirrorDeleted = mirrorResults.filter((r) => r.status === 'fulfilled' && r.value?.ok).length;

  return {
    ok: true,
    dry_run: false,
    workspace_id: targetWorkspaceId,
    d1_rows_deleted: artifactIds.length,
    r2_keys_deleted: r2Deleted,
    r2_errors: r2Errors.slice(0, 20),
    mirror_deleted: mirrorDeleted,
    confirm_token: PURGE_CONFIRM,
  };
}

export { PURGE_CONFIRM };
