/**
 * Code indexer — claim job row and dispatch product full-index / file-smoke.
 * Legacy chunk-only + CF Vectorize path is retired (no split pipelines).
 * Bulk PG writes prefer Hyperdrive (session-pooler origin); SUPABASE_DB_URL fallback.
 * Tables/model: resolveCodeIndexLaneConfig once here (D1 registry → arm → catalog).
 */
import { isProductCodeIndexSourceType, isFileSmokeCodeIndexSourceType } from './codebase-full-index.js';
import {
  isCodeIndexWritePipeUsable,
  assertCodeIndexBulkWriteHost,
} from './code-index-write-pipe.js';
import { nowUnix } from './code-indexer-shared.js';
import { loadJobColumns, patchJob } from './code-indexer-job-state.js';
import { runFullCodeIndexJob } from './code-indexer-full-run.js';
import {
  resolveCodeIndexLaneConfig,
  assertCodeIndexLaneConfigMatchesReceipt,
} from './code-index-lane-resolve.js';

export async function runCodeIndexJob(env, jobId, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };

  const cols = await loadJobColumns(env);
  const failBeforeClaim = async (error, hint = null) => {
    const id = jobId != null ? String(jobId).trim() : '';
    const err = String(error || 'code_index_preflight_failed').slice(0, 500);
    if (id && env?.DB) {
      await patchJob(
        env,
        id,
        {
          status: 'failed',
          last_error: err,
          ...(cols.has('finished_at') ? { finished_at: nowUnix() } : {}),
        },
        cols,
      ).catch(() => null);
    }
    return { ok: false, error: err, ...(hint ? { hint } : {}), run_id: id || null, job_id: id || null };
  };

  try {
    assertCodeIndexBulkWriteHost(env);
  } catch (e) {
    return failBeforeClaim(
      e?.code || e?.message || 'code_index_supabase_db_url_required',
      'Worker Build: bulk writes prefer env.HYPERDRIVE (origin = session pooler :5432). Fallback SUPABASE_DB_URL session pooler. Never paste Hyperdrive URLs into SUPABASE_DB_URL; never :6543.',
    );
  }

  if (!isCodeIndexWritePipeUsable(env)) {
    return failBeforeClaim('code_index_supabase_db_url_required');
  }

  let laneConfig;
  try {
    laneConfig = await resolveCodeIndexLaneConfig(env);
  } catch (e) {
    return failBeforeClaim(
      e?.code || e?.message || 'code_index_lane_resolve_failed',
      'D1 agentsam_pgvector_lane_registry + code_index_embed arm must be active and aligned',
    );
  }

  const selectCols = ['id', 'workspace_id', 'status'];
  for (const c of [
    'user_id',
    'repo_full_name',
    'source_path',
    'branch',
    'file_count',
    'indexed_file_count',
    'chunk_count',
    'triggered_by',
    'source_type',
    'file_manifest',
    'symbol_summary',
    'dependency_summary',
    'languages',
    'failed_file_count',
    'total_size_bytes',
    'ast_node_count',
    'ast_file_count',
    'ast_last_indexed_at',
    'vector_backend',
  ]) {
    if (cols.has(c)) selectCols.push(c);
  }

  const job =
    jobId != null
      ? await env.DB.prepare(
          `SELECT ${selectCols.join(', ')} FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
        )
          .bind(String(jobId))
          .first()
      : await env.DB.prepare(
          `SELECT ${selectCols.join(', ')} FROM agentsam_code_index_job
           WHERE status = 'idle'
             AND COALESCE(source_type, '') NOT IN ('ast_rag', 'ast_symbol_reembed')
           ORDER BY rowid
           LIMIT 1`,
        ).first();

  if (!job?.id) return { ok: true, skipped: true, reason: 'no_idle_job' };

  if (job.vector_backend) {
    try {
      assertCodeIndexLaneConfigMatchesReceipt(laneConfig, job.vector_backend);
    } catch (e) {
      return failBeforeClaim(
        e?.code || e?.message || 'code_index_lane_config_drift',
        'Job vector_backend does not match live D1 lane registry — enqueue a new run after registry cutover',
      );
    }
  }

  if (isProductCodeIndexSourceType(job.source_type) || isFileSmokeCodeIndexSourceType(job.source_type)) {
    return runFullCodeIndexJob(env, job, { ...opts, laneConfig }, cols);
  }

  // Split-pipeline chunk-only path retired — it wrote CF Vectorize and skipped same-rev AST birth.
  await patchJob(
    env,
    job.id,
    {
      status: 'failed',
      last_error: 'legacy_chunk_only_path_retired:use_codebase_full_product_source_type',
      ...(cols.has('finished_at') ? { finished_at: nowUnix() } : {}),
    },
    cols,
  );
  return {
    ok: false,
    error: 'legacy_chunk_only_path_retired',
    job_id: job.id,
    hint: 'Enqueue codebase_full / incremental_refresh via queueFullCodeIndexRun',
  };
}
