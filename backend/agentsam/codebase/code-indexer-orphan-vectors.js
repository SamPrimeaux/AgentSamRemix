/**
 * Purge PG chunk/symbol rows whose file_path is not in the keep set
 * (active job manifest / job_file inventory). Stops unbounded orphan growth
 * when jobs never finish activate or removed_paths is incomplete.
 */

import { runCodeIndexPgQuery, runCodeIndexPgSession } from './code-index-write-pipe.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
} from './code-index-lane-resolve.js';

const DELETE_CHUNK = 80;

/**
 * Load keep paths for a job from agentsam_code_index_job_file (preferred) or opts.paths.
 * @param {any} env
 * @param {{ jobId: string, paths?: string[] }} opts
 * @returns {Promise<string[]>}
 */
export async function loadCodeIndexKeepFilePaths(env, opts = {}) {
  const explicit = Array.isArray(opts.paths)
    ? opts.paths.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  const jobId = opts.jobId != null ? String(opts.jobId).trim() : '';
  let fromJob = [];
  if (env?.DB && jobId) {
    const { results } = await env.DB.prepare(
      `SELECT path FROM agentsam_code_index_job_file
        WHERE index_job_id = ?
          AND TRIM(COALESCE(path, '')) <> ''`,
    )
      .bind(jobId)
      .all()
      .catch(() => ({ results: [] }));
    fromJob = (results || [])
      .map((r) => (r?.path != null ? String(r.path).trim() : ''))
      .filter(Boolean);
  }
  return [...new Set([...fromJob, ...explicit])];
}

/**
 * Delete agentsam chunk + symbol rows for workspace/repo where file_path ∉ keepPaths.
 * Fail loud if keepPaths is empty (never wipe the whole repo by accident).
 *
 * @param {any} env
 * @param {{
 *   workspaceUuid: string,
 *   repoFullName: string,
 *   keepPaths: string[],
 *   jobId?: string|null,
 * }} opts
 */
export async function purgeOrphanCodeIndexVectorsByKeepPaths(env, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const workspaceUuid = opts.workspaceUuid != null ? String(opts.workspaceUuid).trim() : '';
  const repoFullName = opts.repoFullName != null ? String(opts.repoFullName).trim() : '';
  const keepPaths = [
    ...new Set(
      (Array.isArray(opts.keepPaths) ? opts.keepPaths : [])
        .map((p) => String(p || '').trim())
        .filter(Boolean),
    ),
  ];
  const jobId = opts.jobId != null ? String(opts.jobId).trim() : null;

  if (!workspaceUuid || !repoFullName) {
    return { ok: false, error: 'workspace_or_repo_required', deleted_paths: 0 };
  }
  if (!keepPaths.length) {
    return { ok: false, error: 'keep_paths_empty', deleted_paths: 0 };
  }

  const listed = await runCodeIndexPgQuery(
    env,
    `SELECT DISTINCT file_path AS file_path
       FROM agentsam.${chunksTable}
      WHERE workspace_id = $1::uuid
        AND COALESCE(metadata->>'repo_full_name', '') = $2
        AND TRIM(COALESCE(file_path, '')) <> ''
     UNION
     SELECT DISTINCT file_path AS file_path
       FROM agentsam.${symbolsTable}
      WHERE workspace_id = $1::uuid
        AND repo_full_name = $2
        AND TRIM(COALESCE(file_path, '')) <> ''`,
    [workspaceUuid, repoFullName],
  );
  if (!listed.ok) {
    return {
      ok: false,
      error: listed.error || 'list_distinct_paths_failed',
      deleted_paths: 0,
    };
  }

  const keep = new Set(keepPaths);
  const orphans = (listed.rows || [])
    .map((r) => (r?.file_path != null ? String(r.file_path).trim() : ''))
    .filter((p) => p && !keep.has(p));

  if (!orphans.length) {
    return {
      ok: true,
      deleted_paths: 0,
      orphan_path_count: 0,
      keep_path_count: keepPaths.length,
      chunks_deleted: 0,
      symbols_deleted: 0,
      job_id: jobId,
    };
  }

  let chunksDeleted = 0;
  let symbolsDeleted = 0;
  const session = await runCodeIndexPgSession(env, async (client) => {
    for (let i = 0; i < orphans.length; i += DELETE_CHUNK) {
      const slice = orphans.slice(i, i + DELETE_CHUNK);
      const c = await client.query(
        `DELETE FROM agentsam.${chunksTable}
          WHERE workspace_id = $1::uuid
            AND COALESCE(metadata->>'repo_full_name', '') = $2
            AND file_path = ANY($3::text[])`,
        [workspaceUuid, repoFullName, slice],
      );
      chunksDeleted += Number(c?.rowCount) || 0;
      const s = await client.query(
        `DELETE FROM agentsam.${symbolsTable}
          WHERE workspace_id = $1::uuid
            AND repo_full_name = $2
            AND file_path = ANY($3::text[])`,
        [workspaceUuid, repoFullName, slice],
      );
      symbolsDeleted += Number(s?.rowCount) || 0;
    }
    return { rows: [] };
  });

  if (!session.ok) {
    return {
      ok: false,
      error: session.error || 'orphan_vector_delete_failed',
      deleted_paths: 0,
      orphan_path_count: orphans.length,
      keep_path_count: keepPaths.length,
    };
  }

  console.info('[code-indexer] orphan_vector_purge', {
    job_id: jobId,
    repo: repoFullName,
    keep_path_count: keepPaths.length,
    orphan_path_count: orphans.length,
    chunks_deleted: chunksDeleted,
    symbols_deleted: symbolsDeleted,
    sample: orphans.slice(0, 12),
  });

  return {
    ok: true,
    deleted_paths: orphans.length,
    orphan_path_count: orphans.length,
    keep_path_count: keepPaths.length,
    chunks_deleted: chunksDeleted,
    symbols_deleted: symbolsDeleted,
    orphan_paths_sample: orphans.slice(0, 40),
    job_id: jobId,
  };
}
